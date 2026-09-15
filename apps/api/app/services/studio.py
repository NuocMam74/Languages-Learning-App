"""Studio de contenu (spec §15 Phase 4, contrat Phase 4 §1).

Le contenu reste des fichiers JSON (ADR 0002). Le studio garde des **brouillons** en base (`content_drafts`),
les valide avec le validateur de la CI (`scripts/validate-content.ts --root <copie> --json`) sur une copie
temporaire du pack où les brouillons sont superposés, puis les **publie** en écrivant les fichiers dans
CONTENT_DIR (NFC, indentation 2, LF) et en incrémentant `pack.version`.
"""

import copy
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import ContentDraft, ContentPublication, ContentReview, User
from app.services import content as content_service
from app.services.content import Pack, localized

logger = logging.getLogger(__name__)

KINDS = ("lesson", "concept", "culture", "curriculum", "lexical-variants", "exam", "pack")
SINGLETON_FILES = {"pack": "pack.json", "curriculum": "curriculum.json", "lexical-variants": "lexical-variants.json"}
REVIEWABLE_KINDS = ("lesson", "concept", "culture", "exam")
_GROUP_DIRS = {"lesson": "lessons", "concept": "concepts", "culture": "culture", "exam": "exams"}
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,127}$")
# Clés dont la valeur est un chemin de média relatif au pack (comme `collectMedia` du validateur).
MEDIA_KEYS = {"src", "audio", "image", "pitch", "pitchRef"}
MAX_DOCUMENT_BYTES = 2 * 1024 * 1024


class StudioError(Exception):
    def __init__(self, code: str, status: int, extra: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.extra = extra or {}


@dataclass(frozen=True)
class PublishedDoc:
    kind: str
    id: str
    path: str  # relatif au dossier du pack, POSIX
    data: dict[str, Any]


@dataclass
class ValidationReport:
    errors: list[dict[str, str]] = field(default_factory=list)
    warnings: list[dict[str, str]] = field(default_factory=list)


ContentValidator = Callable[[Path], ValidationReport]
DocKey = tuple[str, str]


# --- Identifiants et chemins ---------------------------------------------------------------


def canonical_id(pack_code: str, kind: str, doc_id: str) -> str:
    """Les documents uniques (pack, curriculum, lexical-variants) ont pour id le code du pack."""
    if kind in SINGLETON_FILES:
        return pack_code
    if not _ID_RE.fullmatch(doc_id) or ".." in doc_id:
        raise StudioError("invalid_id", 422)
    return doc_id


def default_path(pack_code: str, kind: str, doc_id: str) -> str:
    if kind in SINGLETON_FILES:
        return SINGLETON_FILES[kind]
    if kind in ("concept", "culture"):
        return f"{_GROUP_DIRS[kind]}/{doc_id}.json"
    prefix = f"{pack_code}."
    rest = doc_id[len(prefix) :].split(".") if doc_id.startswith(prefix) else []
    if kind == "lesson" and len(rest) >= 2 and all(rest):
        return f"lessons/{rest[0]}/{'.'.join(rest[1:])}.json"
    if kind == "exam" and rest and rest[-1]:
        return f"exams/{rest[-1].lower()}.json"
    raise StudioError("invalid_id", 422)


def schema_ref(kind: str, path: str) -> str:
    return "../" * (path.count("/") + 1) + f"schema/{kind}.schema.json"


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def scan_published(pack_dir: Path, code: str | None = None) -> dict[DocKey, PublishedDoc]:
    """Documents publiés du pack indexés par (kind, id)."""
    docs: dict[DocKey, PublishedDoc] = {}
    code = code or pack_dir.name
    for kind, name in SINGLETON_FILES.items():
        file = pack_dir / name
        if file.is_file():
            try:
                data = _read_json(file)
            except ValueError:
                logger.warning("JSON illisible : %s", file)
                continue
            if isinstance(data, dict):
                docs[(kind, code)] = PublishedDoc(kind, code, name, data)
    for kind, sub in _GROUP_DIRS.items():
        folder = pack_dir / sub
        if not folder.is_dir():
            continue
        pattern = "*.json" if kind == "exam" else "**/*.json"
        for file in sorted(folder.glob(pattern)):
            try:
                data = _read_json(file)
            except ValueError:
                logger.warning("JSON illisible : %s", file)
                continue
            if isinstance(data, dict) and isinstance(data.get("id"), str):
                rel = file.relative_to(pack_dir).as_posix()
                docs[(kind, data["id"])] = PublishedDoc(kind, data["id"], rel, data)
    return docs


def document_path(published: dict[DocKey, PublishedDoc], pack_code: str, kind: str, doc_id: str) -> str:
    existing = published.get((kind, doc_id))
    return existing.path if existing else default_path(pack_code, kind, doc_id)


def serialize_document(kind: str, path: str, data: dict[str, Any]) -> bytes:
    """JSON du dépôt : `$schema` en tête, indentation 2, LF final, Unicode NFC."""
    out = dict(data)
    if "$schema" not in out:
        out = {"$schema": schema_ref(kind, path), **out}
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    return unicodedata.normalize("NFC", text).encode("utf-8")


# --- Brouillons ----------------------------------------------------------------------------


def _now_ms() -> datetime:
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def _same_instant(a: datetime, b: datetime) -> bool:
    a = a if a.tzinfo else a.replace(tzinfo=UTC)
    b = b if b.tzinfo else b.replace(tzinfo=UTC)
    return abs(a - b) < timedelta(milliseconds=1)


def drafts_of(db: Session, pack_code: str) -> dict[DocKey, ContentDraft]:
    rows = db.scalars(select(ContentDraft).where(ContentDraft.pack_code == pack_code))
    return {(r.kind, r.doc_id): r for r in rows}


def get_draft(db: Session, pack_code: str, kind: str, doc_id: str) -> ContentDraft | None:
    return db.scalar(
        select(ContentDraft).where(
            ContentDraft.pack_code == pack_code, ContentDraft.kind == kind, ContentDraft.doc_id == doc_id
        )
    )


def check_document(pack_code: str, kind: str, doc_id: str, data: dict[str, Any]) -> None:
    if len(json.dumps(data, ensure_ascii=False).encode("utf-8")) > MAX_DOCUMENT_BYTES:
        raise StudioError("document_too_large", 413)
    if kind == "pack":
        if data.get("code", pack_code) != pack_code:
            raise StudioError("id_mismatch", 422)
    elif kind == "curriculum":
        if data.get("pack", pack_code) != pack_code:
            raise StudioError("id_mismatch", 422)
    elif kind != "lexical-variants" and data.get("id", doc_id) != doc_id:
        raise StudioError("id_mismatch", 422)
    default_path(pack_code, kind, doc_id)  # id compatible avec un chemin de fichier


_UNCHECKED = object()


def save_draft(
    db: Session,
    pack_code: str,
    kind: str,
    doc_id: str,
    data: dict[str, Any],
    user_id: str,
    base_updated_at: object = _UNCHECKED,
) -> ContentDraft:
    """Crée ou remplace un brouillon. Avec `base_updated_at` : concurrence optimiste (409 si périmé)."""
    draft = get_draft(db, pack_code, kind, doc_id)
    if base_updated_at is not _UNCHECKED:
        if draft is None and base_updated_at is not None:
            raise StudioError("draft_conflict", 409)
        if draft is not None and (
            not isinstance(base_updated_at, datetime) or not _same_instant(draft.updated_at, base_updated_at)
        ):
            raise StudioError("draft_conflict", 409, {"updatedAt": draft.updated_at.isoformat()})
    now = _now_ms()
    if draft is None:
        draft = ContentDraft(pack_code=pack_code, kind=kind, doc_id=doc_id)
        db.add(draft)
    elif now <= draft.updated_at:
        now = draft.updated_at + timedelta(milliseconds=1)
    draft.data = copy.deepcopy(data)
    draft.updated_at = now
    draft.updated_by = user_id
    db.flush()
    return draft


def effective_documents(
    published: dict[DocKey, PublishedDoc], drafts: dict[DocKey, ContentDraft]
) -> dict[DocKey, dict[str, Any]]:
    docs = {key: doc.data for key, doc in published.items()}
    docs.update({key: d.data for key, d in drafts.items()})
    return docs


def display_name(db: Session, user_id: str | None) -> str | None:
    user = db.get(User, user_id) if user_id else None
    return user.display_name if user else None


# --- Arbre ---------------------------------------------------------------------------------


def _title(value: Any) -> str:
    return localized(value, "fr") or ""


def tree(pack: Pack, published: dict[DocKey, PublishedDoc], drafts: dict[DocKey, ContentDraft]) -> dict[str, Any]:
    docs = effective_documents(published, drafts)
    curriculum = docs.get(("curriculum", pack.code)) or {}
    lessons = {doc_id: data for (kind, doc_id), data in docs.items() if kind == "lesson"}

    def lesson_entry(lesson_id: str) -> dict[str, Any]:
        data = lessons.get(lesson_id, {})
        return {
            "id": lesson_id,
            "title": _title(data.get("title")),
            "kind": data.get("kind", "lesson"),
            "reviewed": data.get("reviewed") is True,
            "draft": ("lesson", lesson_id) in drafts,
        }

    units = []
    listed: set[str] = set()
    for unit in curriculum.get("units", []) if isinstance(curriculum.get("units"), list) else []:
        if not isinstance(unit, dict) or not isinstance(unit.get("id"), str):
            continue
        ids = [lid for lid in unit.get("lessons", []) if isinstance(lid, str)]
        # Leçon en brouillon pas encore inscrite au cursus : rattachée à son unité.
        ids += sorted(lid for lid, d in lessons.items() if d.get("unit") == unit["id"] and lid not in ids)
        listed.update(ids)
        units.append(
            {
                "id": unit["id"],
                "title": _title(unit.get("title")),
                "status": str(unit.get("status", "")),
                "lessons": [lesson_entry(lid) for lid in ids],
            }
        )
    concepts = [
        {
            "id": doc_id,
            "vi": str(data.get("vi", "")),
            "reviewed": data.get("reviewed") is True,
            "draft": ("concept", doc_id) in drafts,
        }
        for (kind, doc_id), data in sorted(docs.items())
        if kind == "concept"
    ]
    culture = [
        {"id": doc_id, "reviewed": data.get("reviewed") is True, "draft": ("culture", doc_id) in drafts}
        for (kind, doc_id), data in sorted(docs.items())
        if kind == "culture"
    ]
    return {"units": units, "concepts": concepts, "culture": culture}


# --- Validation ----------------------------------------------------------------------------


def collect_media(value: Any, out: set[str]) -> None:
    if isinstance(value, list):
        for v in value:
            collect_media(v, out)
    elif isinstance(value, dict):
        for k, v in value.items():
            if k in MEDIA_KEYS and isinstance(v, str):
                out.add(v)
            else:
                collect_media(v, out)


def build_overlay(
    settings: Settings,
    pack: Pack,
    published: dict[DocKey, PublishedDoc],
    drafts: Iterable[ContentDraft],
    dest: Path,
) -> Path:
    """Copie `schema/` + le pack dans `dest/content`, y superpose médias du studio et brouillons ; renvoie la racine."""
    root = dest / "content"
    shutil.copytree(settings.content_dir / "schema", root / "schema")
    pack_root = root / pack.code
    shutil.copytree(pack.directory, pack_root, ignore=shutil.ignore_patterns("*.wav", "_review"))
    media = settings.studio_media_dir / pack.code
    if media.is_dir():
        shutil.copytree(media, pack_root, dirs_exist_ok=True)
    for draft in drafts:
        path = document_path(published, pack.code, draft.kind, draft.doc_id)
        target = pack_root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(serialize_document(draft.kind, path, draft.data))
    return root


def _resolve_command(command: str) -> list[str]:
    args = shlex.split(command, posix=True)
    if not args:
        raise StudioError("validator_not_configured", 500)
    exe = shutil.which(args[0])
    return [exe or args[0], *args[1:]]


def make_validator(settings: Settings) -> ContentValidator:
    """Exécute STUDIO_VALIDATOR_CMD `--root <root> --json` et lit `{errors, warnings}` sur stdout."""

    def run(root: Path) -> ValidationReport:
        args = [*_resolve_command(settings.studio_validator_cmd), "--root", str(root), "--json"]
        try:
            proc = subprocess.run(  # noqa: S603  (commande de configuration, sans shell)
                args,
                cwd=settings.studio_validator_cwd,
                capture_output=True,
                timeout=settings.studio_validator_timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise StudioError("validator_timeout", 504) from exc
        except OSError as exc:
            logger.error("Validateur introuvable (%s) : %s", args[0], exc)
            raise StudioError("validator_unavailable", 503) from exc
        stdout = proc.stdout.decode("utf-8", errors="replace")
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                data = json.loads(line)
            except ValueError:
                continue
            if isinstance(data, dict) and isinstance(data.get("errors"), list):
                return ValidationReport(
                    errors=[_issue(i) for i in data["errors"]], warnings=[_issue(i) for i in data.get("warnings", [])]
                )
        stderr = proc.stderr.decode("utf-8", errors="replace")
        logger.error("Validateur : sortie illisible (code %s) : %s", proc.returncode, stderr[-2000:])
        raise StudioError("validator_failed", 502)

    return run


def _issue(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {"where": "", "message": str(value)}
    return {"where": str(value.get("where", "")), "message": str(value.get("message", ""))}


def validate_pack(
    settings: Settings,
    validator: ContentValidator,
    pack: Pack,
    published: dict[DocKey, PublishedDoc],
    drafts: Iterable[ContentDraft],
) -> ValidationReport:
    with tempfile.TemporaryDirectory(prefix="parlo-studio-") as tmp:
        root = build_overlay(settings, pack, published, drafts, Path(tmp))
        return validator(root)


# --- Publication ---------------------------------------------------------------------------


def _atomic_write(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _media_candidates(refs: Iterable[str]) -> set[str]:
    """Médias référencés + variantes m4a/opus (le concept ne référence que l'opus)."""
    out: set[str] = set()
    for ref in refs:
        if ".." in ref or ref.startswith("/"):
            continue
        out.add(ref)
        stem, dot, ext = ref.rpartition(".")
        if dot and ext in ("opus", "m4a"):
            out.update({f"{stem}.opus", f"{stem}.m4a"})
    return out


def clear_content_caches() -> None:
    """Hygiène mémoire du worker qui publie ; les autres workers voient la nouvelle version par signature."""
    content_service.clear_caches()


def publish(
    db: Session,
    settings: Settings,
    validator: ContentValidator,
    user: User,
    pack: Pack,
    refs: list[tuple[str, str]],
    message: str,
) -> tuple[list[str], int]:
    if not settings.studio_publish_enabled:
        raise StudioError("publish_disabled", 403)
    published = scan_published(pack.directory, pack.code)
    drafts = drafts_of(db, pack.code)
    selected: list[ContentDraft] = []
    for kind, raw_id in dict.fromkeys(refs):
        draft = drafts.get((kind, canonical_id(pack.code, kind, raw_id)))
        if draft is None:
            raise StudioError("draft_not_found", 422, {"kind": kind, "id": raw_id})
        if draft not in selected:
            selected.append(draft)

    report = validate_pack(settings, validator, pack, published, selected)
    if report.errors:
        raise StudioError("validation_failed", 422, {"errors": report.errors, "warnings": report.warnings})

    written: list[str] = []
    for draft in selected:
        path = document_path(published, pack.code, draft.kind, draft.doc_id)
        target = pack.directory / path
        data = serialize_document(draft.kind, path, draft.data)
        if not target.is_file() or target.read_bytes() != data:
            _atomic_write(target, data)
            written.append(f"{pack.code}/{path}")

    media_root = settings.studio_media_dir / pack.code
    refs_in_docs: set[str] = set()
    for draft in selected:
        collect_media(draft.data, refs_in_docs)
    for rel in sorted(_media_candidates(refs_in_docs)):
        source = media_root / rel
        if not source.is_file() or not source.resolve().is_relative_to(media_root.resolve()):
            continue
        target = pack.directory / rel
        payload = source.read_bytes()
        if not target.is_file() or target.read_bytes() != payload:
            _atomic_write(target, payload)
            written.append(f"{pack.code}/{rel}")

    # Chaque publication incrémente la version du pack (contrat parcours §4) : clients et caches serveur (indexés
    # par version, dans tous les workers) voient le changement.
    pack_file = pack.directory / "pack.json"
    pack_data = _read_json(pack_file)
    version = max(int(pack_data.get("version", pack.version)), pack.version) + 1
    pack_data["version"] = version
    _atomic_write(pack_file, serialize_document("pack", "pack.json", pack_data))
    if f"{pack.code}/pack.json" not in written:
        written.append(f"{pack.code}/pack.json")

    for draft in selected:
        db.delete(draft)
    db.add(
        ContentPublication(
            pack_code=pack.code,
            user_id=user.id,
            message=message,
            files=written,
            pack_version=version,
            created_at=datetime.now(UTC),
        )
    )
    db.commit()
    clear_content_caches()
    return written, version


# --- Relecture native ----------------------------------------------------------------------


def collect_vi(value: Any, out: list[str]) -> None:
    if isinstance(value, list):
        for v in value:
            collect_vi(v, out)
    elif isinstance(value, dict):
        for k, v in value.items():
            if k == "vi" and isinstance(v, str):
                if v not in out:
                    out.append(v)
            elif k == "vi" and isinstance(v, list) and all(isinstance(x, str) for x in v):
                out.extend(x for x in v if x not in out)
            else:
                collect_vi(v, out)


def load_doubts(pack: Pack) -> dict[str, list[str]]:
    file = pack.directory / "_review" / "doubts.json"
    if not file.is_file():
        return {}
    try:
        data = _read_json(file)
    except ValueError:
        logger.warning("doubts.json illisible : %s", file)
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: [str(x) for x in v] for k, v in data.items() if isinstance(v, list)}


def _culture_refs(lesson: dict[str, Any]) -> set[str]:
    steps = lesson.get("steps")
    if not isinstance(steps, list):
        return set()
    return {
        s["ref"]
        for s in steps
        if isinstance(s, dict) and s.get("type") == "culture_card" and isinstance(s.get("ref"), str)
    }


def review_queue(
    pack: Pack,
    published: dict[DocKey, PublishedDoc],
    drafts: dict[DocKey, ContentDraft],
    kind: str | None,
    unit: str | None,
) -> list[dict[str, Any]]:
    docs = effective_documents(published, drafts)
    doubts = load_doubts(pack)
    allowed: dict[str, set[str]] | None = None
    if unit:
        unit_lessons = {i: d for (k, i), d in docs.items() if k == "lesson" and d.get("unit") == unit}
        allowed = {
            "lesson": set(unit_lessons),
            "concept": {c for d in unit_lessons.values() for c in d.get("concepts", []) if isinstance(c, str)},
            "culture": {r for d in unit_lessons.values() for r in _culture_refs(d)},
            "exam": {i for (k, i), d in docs.items() if k == "exam" and unit in (d.get("requiresUnits") or [])},
        }
    items = []
    for (doc_kind, doc_id), data in docs.items():
        if doc_kind not in REVIEWABLE_KINDS or data.get("reviewed") is True:
            continue
        if kind and doc_kind != kind:
            continue
        if allowed is not None and doc_id not in allowed[doc_kind]:
            continue
        vi: list[str] = []
        collect_vi(data, vi)
        if doc_kind == "concept":
            title = str(data.get("vi", doc_id))
        elif doc_kind == "exam":
            title = _title(data.get("certificate")) or doc_id
        else:
            title = _title(data.get("title")) or doc_id
        items.append({"kind": doc_kind, "id": doc_id, "title": title, "vi": vi, "doubts": doubts.get(doc_id, [])})
    order = {k: i for i, k in enumerate(REVIEWABLE_KINDS)}
    items.sort(key=lambda it: (order[it["kind"]], it["id"]))
    return items + doubt_groups(docs, pack.code, doubts, kind, unit)


def doubt_groups(
    docs: dict[DocKey, dict[str, Any]], pack_code: str, doubts: dict[str, list[str]], kind: str | None, unit: str | None
) -> list[dict[str, Any]]:
    """Doutes qui ne visent pas un document : entrées en fin de file, quel que soit l'état `reviewed`.

    - clé = id d'unité (`vi-south.u03`) → `{kind: "curriculum", id: <unité>, title: <titre de l'unité>}` ;
    - id d'une entrée de lexical-variants.json (`lv_sick`) → `{kind: "lexical-variants", id: <entrée>}` ;
    - clé préfixée `_` (groupe général, ex. `_distractors`) ou inconnue → `{kind: "pack", id: <clé>}`.
    Les groupes hors unité n'apparaissent pas avec le filtre `unit`.
    """
    curriculum = docs.get(("curriculum", pack_code)) or {}
    raw_units = curriculum.get("units")
    units = {
        u["id"]: _title(u.get("title")) or u["id"]
        for u in (raw_units if isinstance(raw_units, list) else [])
        if isinstance(u, dict) and isinstance(u.get("id"), str)
    }
    unit_key = re.compile(rf"^{re.escape(pack_code)}\.u\d+$")
    doc_ids = {doc_id for (_, doc_id) in docs}
    raw_variants = (docs.get(("lexical-variants", pack_code)) or {}).get("entries")
    variant_ids = {
        e["id"] for e in (raw_variants if isinstance(raw_variants, list) else []) if isinstance(e, dict) and "id" in e
    }
    out: list[dict[str, Any]] = []
    for key in sorted(doubts):
        entries = doubts[key]
        is_unit = key in units or bool(unit_key.fullmatch(key))
        if not entries or (key in doc_ids and not is_unit):
            continue  # doutes d'un document : déjà rattachés à son entrée
        if is_unit:
            if kind not in (None, "curriculum") or (unit and unit != key):
                continue
            out.append({"kind": "curriculum", "id": key, "title": units.get(key, key), "vi": [], "doubts": entries})
        elif key in variant_ids:
            if kind not in (None, "lexical-variants") or unit:
                continue
            out.append({"kind": "lexical-variants", "id": key, "title": key, "vi": [], "doubts": entries})
        else:
            if kind not in (None, "pack") or unit:
                continue
            out.append({"kind": "pack", "id": key, "title": key.lstrip("_"), "vi": [], "doubts": entries})
    return out


def review(
    db: Session,
    user: User,
    pack: Pack,
    kind: str,
    doc_id: str,
    verdict: str,
    comment: str | None,
) -> datetime:
    if kind not in REVIEWABLE_KINDS:
        raise StudioError("kind_not_reviewable", 422)
    draft = get_draft(db, pack.code, kind, doc_id)
    published = scan_published(pack.directory, pack.code).get((kind, doc_id))
    if draft is None and published is None:
        raise StudioError("document_not_found", 404)
    now = datetime.now(UTC)
    if verdict == "approve":
        data = copy.deepcopy(draft.data if draft is not None else published.data)  # type: ignore[union-attr]
        data["reviewed"] = True
        save_draft(db, pack.code, kind, doc_id, data, user.id)
    db.add(
        ContentReview(
            pack_code=pack.code,
            kind=kind,
            doc_id=doc_id,
            reviewer_id=user.id,
            verdict=verdict,
            comment=comment,
            created_at=now,
        )
    )
    db.commit()
    return now
