"""`/content/{code}/…` : contenu servi par l'API (développement, ou sans CDN) — contrat parcours §1 et §6.

Contrairement à un montage statique figé au démarrage, ces routes lisent la version **publiée courante** :
après une publication du studio, `latest.json` et `bundle.json` reflètent la nouvelle version dans tous les workers.
- `latest.json` : `{code, version}` ;
- `v{version}/bundle.json` : tout le JSON du pack (+ examens, placement, jeux) et `mediaIndex` ;
- `v{version}/<chemin>` : fichiers du pack (médias).
"""

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse

from app.config import Settings
from app.deps import PacksDep, SettingsDep
from app.services.content import Pack, concept_documents, lesson_documents
from app.services.media import media_index

router = APIRouter(prefix="/content", tags=["content"], include_in_schema=False)

_NO_CACHE = {"Cache-Control": "no-cache"}


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_files(directory: Path) -> list[Any]:
    if not directory.is_dir():
        return []
    return [_read_json(p) for p in sorted(directory.rglob("*.json"))]


def build_bundle(pack: Pack, settings: Settings) -> dict[str, Any]:
    """Même forme que `toRaw` (scripts/lib/load-pack.ts) + examens, placement, jeux et index des médias."""
    root = pack.directory
    bundle: dict[str, Any] = {
        "pack": _read_json(root / "pack.json"),
        "curriculum": _read_json(root / "curriculum.json"),
        "lessons": list(lesson_documents(pack).values()),
        "concepts": list(concept_documents(pack).values()),
        "culture": _json_files(root / "culture"),
    }
    if (root / "lexical-variants.json").is_file():
        bundle["variants"] = _read_json(root / "lexical-variants.json")
    bundle["exams"] = _json_files(root / "exams")
    bundle["placement"] = _read_json(root / "placement.json") if (root / "placement.json").is_file() else None
    games_dir = root / "games"
    bundle["games"] = {p.stem: _read_json(p) for p in sorted(games_dir.glob("*.json"))} if games_dir.is_dir() else {}
    bundle["mediaIndex"] = sorted(media_index(pack, settings.studio_media_dir))
    return bundle


def _pack(packs: dict[str, Pack], code: str) -> Pack:
    pack = packs.get(code)
    if pack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="unknown_course")
    return pack


@router.get("/{code}/latest.json")
def latest(code: str, packs: PacksDep) -> JSONResponse:
    pack = _pack(packs, code)
    return JSONResponse({"code": pack.code, "version": pack.version}, headers=_NO_CACHE)


@router.get("/{code}/v{version}/bundle.json")
def bundle(code: str, version: int, packs: PacksDep, settings: SettingsDep) -> JSONResponse:
    pack = _pack(packs, code)
    if version != pack.version:
        # Une version périmée n'est plus construite : le client relit latest.json.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="stale_version")
    return JSONResponse(build_bundle(pack, settings), headers=_NO_CACHE)


@router.get("/{code}/v{version}/{path:path}")
def pack_file(code: str, version: int, path: str, packs: PacksDep) -> FileResponse:
    pack = _pack(packs, code)
    root = pack.directory.resolve()
    target = (root / path).resolve()
    parts = Path(path).parts
    if (
        not target.is_relative_to(root)
        or not target.is_file()
        or not parts
        or parts[0].startswith("_")
        or target.suffix.lower() == ".wav"
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    return FileResponse(target)
