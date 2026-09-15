"""`/studio/*` : studio de contenu (contrat Phase 4 §1). Rôles reviewer, editor ou admin.

- Lecture, validation, brouillons, audio : reviewer | editor | admin.
- Publication : editor | admin. Verdict de relecture : reviewer | admin.
"""

import json
import re
import tempfile
from pathlib import Path
from typing import Annotated, Any, NoReturn

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.deps import DbDep, PacksDep, SettingsDep, require_roles
from app.models import User
from app.schemas.phase4 import (
    AudioFileOut,
    AudioUploadOut,
    DocumentKind,
    DocumentOut,
    DocumentPut,
    DocumentPutOut,
    DraftOut,
    PitchPathOut,
    PublishIn,
    PublishOut,
    ReviewIn,
    ReviewOut,
    ReviewQueueItemOut,
    StudioPackOut,
    StudioTreeOut,
    ValidationOut,
)
from app.services import audio as audio_service
from app.services import studio
from app.services.content import Pack, localized

router = APIRouter(prefix="/studio", tags=["studio"])

StudioUser = Annotated[User, Depends(require_roles("reviewer", "editor"))]
EditorUser = Annotated[User, Depends(require_roles("editor"))]
ReviewerUser = Annotated[User, Depends(require_roles("reviewer"))]

_MEDIA_TYPES = {".opus": "audio/ogg", ".m4a": "audio/mp4", ".json": "application/json"}
_AUDIO_PATH_RE = re.compile(r"^audio/[a-z0-9_\-]+(?:/[a-z0-9_\-]+)*$")
_VOICE_RE = re.compile(r"^[a-z0-9_]{1,64}$")


def _raise(exc: studio.StudioError | audio_service.AudioError) -> NoReturn:
    if isinstance(exc, audio_service.AudioError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "audio_failed", "message": str(exc)})
    detail: Any = {"code": exc.code, **exc.extra} if exc.extra else exc.code
    raise HTTPException(exc.status, detail=detail)


def _pack(packs: PacksDep, code: str) -> Pack:
    pack = packs.get(code)
    if pack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="pack_not_found")
    return pack


def _doc_id(pack: Pack, kind: str, doc_id: str) -> str:
    try:
        return studio.canonical_id(pack.code, kind, doc_id)
    except studio.StudioError as exc:
        _raise(exc)


def _validator(request: Request) -> studio.ContentValidator:
    validator: studio.ContentValidator = request.app.state.content_validator
    return validator


@router.get("/packs", response_model=list[StudioPackOut])
def list_packs(user: StudioUser, packs: PacksDep) -> list[StudioPackOut]:
    return [
        StudioPackOut(code=p.code, name=localized(p.raw.get("name"), "fr") or p.code, version=p.version)
        for p in packs.values()
    ]


@router.get("/packs/{code}/tree", response_model=StudioTreeOut)
def get_tree(code: str, user: StudioUser, db: DbDep, packs: PacksDep) -> dict[str, Any]:
    pack = _pack(packs, code)
    return studio.tree(pack, studio.scan_published(pack.directory, pack.code), studio.drafts_of(db, pack.code))


@router.get("/packs/{code}/documents/{kind}/{doc_id}", response_model=DocumentOut)
def get_document(
    code: str, kind: DocumentKind, doc_id: str, user: StudioUser, db: DbDep, packs: PacksDep
) -> DocumentOut:
    pack = _pack(packs, code)
    doc_id = _doc_id(pack, kind, doc_id)
    published = studio.scan_published(pack.directory, pack.code).get((kind, doc_id))
    draft = studio.get_draft(db, pack.code, kind, doc_id)
    return DocumentOut(
        kind=kind,
        id=doc_id,
        published=published.data if published else None,
        draft=DraftOut(
            data=draft.data, updated_at=draft.updated_at, updated_by=studio.display_name(db, draft.updated_by)
        )
        if draft
        else None,
    )


@router.put("/packs/{code}/documents/{kind}/{doc_id}", response_model=DocumentPutOut)
def put_document(
    code: str, kind: DocumentKind, doc_id: str, body: DocumentPut, user: StudioUser, db: DbDep, packs: PacksDep
) -> DocumentPutOut:
    pack = _pack(packs, code)
    doc_id = _doc_id(pack, kind, doc_id)
    try:
        studio.check_document(pack.code, kind, doc_id, body.data)
        draft = studio.save_draft(db, pack.code, kind, doc_id, body.data, user.id, body.base_updated_at)
    except studio.StudioError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return DocumentPutOut(updated_at=draft.updated_at)


@router.delete("/packs/{code}/documents/{kind}/{doc_id}/draft", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(code: str, kind: DocumentKind, doc_id: str, user: StudioUser, db: DbDep, packs: PacksDep) -> Response:
    pack = _pack(packs, code)
    draft = studio.get_draft(db, pack.code, kind, _doc_id(pack, kind, doc_id))
    if draft is not None:
        db.delete(draft)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/packs/{code}/validate", response_model=ValidationOut)
def validate(
    code: str, request: Request, user: StudioUser, db: DbDep, packs: PacksDep, settings: SettingsDep
) -> ValidationOut:
    pack = _pack(packs, code)
    try:
        report = studio.validate_pack(
            settings,
            _validator(request),
            pack,
            studio.scan_published(pack.directory, pack.code),
            studio.drafts_of(db, pack.code).values(),
        )
    except studio.StudioError as exc:
        _raise(exc)
    return ValidationOut.model_validate({"errors": report.errors, "warnings": report.warnings})


@router.post("/packs/{code}/publish", response_model=PublishOut)
def publish(
    code: str, body: PublishIn, request: Request, user: EditorUser, db: DbDep, packs: PacksDep, settings: SettingsDep
) -> PublishOut:
    if not settings.studio_publish_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="publish_disabled")
    pack = _pack(packs, code)
    try:
        written, version = studio.publish(
            db, settings, _validator(request), user, pack, [(d.kind, d.id) for d in body.documents], body.message
        )
    except studio.StudioError as exc:
        db.rollback()
        _raise(exc)
    return PublishOut(written=written, pack_version=version)


@router.get("/packs/{code}/review-queue", response_model=list[ReviewQueueItemOut])
def review_queue(
    code: str,
    user: StudioUser,
    db: DbDep,
    packs: PacksDep,
    kind: DocumentKind | None = None,
    unit: str | None = None,
) -> list[dict[str, Any]]:
    pack = _pack(packs, code)
    return studio.review_queue(
        pack, studio.scan_published(pack.directory, pack.code), studio.drafts_of(db, pack.code), kind, unit or None
    )


@router.post("/packs/{code}/documents/{kind}/{doc_id}/review", response_model=ReviewOut)
def review_document(
    code: str, kind: DocumentKind, doc_id: str, body: ReviewIn, user: ReviewerUser, db: DbDep, packs: PacksDep
) -> ReviewOut:
    pack = _pack(packs, code)
    doc_id = _doc_id(pack, kind, doc_id)
    try:
        reviewed_at = studio.review(db, user, pack, kind, doc_id, body.verdict, body.comment)
    except studio.StudioError as exc:
        db.rollback()
        _raise(exc)
    return ReviewOut(reviewed_by=user.display_name, reviewed_at=reviewed_at)


# --- Audio ---------------------------------------------------------------------------------


def _voice(pack: Pack, raw: str) -> tuple[str, str]:
    """(id complet de pack.json, jeton de nom de fichier) : `mai_hcm_f` ou `mai` → (`mai_hcm_f`, `mai`)."""
    voices = [v["id"] for v in pack.raw.get("voices", []) if isinstance(v, dict) and isinstance(v.get("id"), str)]
    for voice_id in voices:
        token = voice_id.split("_")[0].lower()
        if raw in (voice_id, token):
            return voice_id, token
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="unknown_voice")


async def _save_upload(file: UploadFile, dest: Path, limit: int) -> bytes:
    size = 0
    head = b""
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="file_too_large")
            if len(head) < 16:
                head = (head + chunk)[:16]
            out.write(chunk)
    return head


@router.post("/packs/{code}/audio", response_model=AudioUploadOut)
async def upload_audio(
    code: str,
    user: StudioUser,
    db: DbDep,
    packs: PacksDep,
    settings: SettingsDep,
    file: Annotated[UploadFile, File()],
    voice: Annotated[str, Form(max_length=64)],
    concept_id: Annotated[str | None, Form(alias="conceptId", max_length=128)] = None,
    path: Annotated[str | None, Form(max_length=200)] = None,
    pitch: Annotated[str | None, Form(max_length=2_000_000)] = None,
) -> AudioUploadOut:
    pack = _pack(packs, code)
    if bool(concept_id) == bool(path):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="concept_id_or_path_required")
    if not _VOICE_RE.fullmatch(voice):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="unknown_voice")
    voice_id, token = _voice(pack, voice)

    concept: dict[str, Any] | None = None
    if concept_id:
        concept_id = _doc_id(pack, "concept", concept_id)
        draft = studio.get_draft(db, pack.code, "concept", concept_id)
        published = studio.scan_published(pack.directory, pack.code).get(("concept", concept_id))
        concept = draft.data if draft else (published.data if published else None)
        if concept is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="concept_not_found")
        base = f"{concept_id}_{token}"
        out_rel_dir = ""
    else:
        stem = re.sub(r"\.(opus|m4a|wav|webm)$", "", path or "")
        if not _AUDIO_PATH_RE.fullmatch(stem):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid_path")
        # `audio/<sous-dossiers>/<nom>` : le pipeline écrit dans `<dossier>/audio/<nom>`.
        parent, _, base = stem[len("audio/") :].rpartition("/")
        out_rel_dir = parent

    pitch_ref: dict[str, Any] | None = None
    if pitch:
        if not concept_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="pitch_requires_concept")
        try:
            pitch_ref = audio_service.parse_pitch_reference(pitch)
        except audio_service.PitchReferenceError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "invalid_pitch", "message": str(exc)}
            ) from exc

    if not audio_service.ffmpeg_available():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="ffmpeg_unavailable")

    media_root = settings.studio_media_dir / pack.code
    with tempfile.TemporaryDirectory(prefix="parlo-upload-") as tmp:
        source = Path(tmp) / "upload.bin"
        head = await _save_upload(file, source, settings.studio_audio_max_bytes)
        if audio_service.detect_format(head) is None:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="wav_or_webm_expected")
        work = Path(tmp) / "out"
        try:
            result = await run_in_threadpool(audio_service.process_recording, source, work, base)
        except audio_service.AudioError as exc:
            _raise(exc)
        files: list[AudioFileOut] = []
        for rel, duration_ms in result.files:
            name = rel.split("/", 1)[1]
            final_rel = f"audio/{out_rel_dir}/{name}" if out_rel_dir else f"audio/{name}"
            target = media_root / final_rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((work / rel).read_bytes())
            files.append(AudioFileOut(path=final_rel, duration_ms=duration_ms))

    pitch_out: PitchPathOut | None = None
    if pitch_ref is not None and concept_id:
        pitch_rel = f"pitch/{concept_id}.json"
        target = media_root / pitch_rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(audio_service.serialize_pitch_reference(pitch_ref) + "\n", encoding="utf-8", newline="\n")
        pitch_out = PitchPathOut(path=pitch_rel)

    if concept is not None and concept_id:
        data = json.loads(json.dumps(concept))
        entries = [a for a in data.get("audio", []) if isinstance(a, dict)]
        entries = [a for a in entries if not (a.get("voice") == voice_id and a.get("speed") in ("natural", "slow"))]
        entries += [
            {"voice": voice_id, "src": f"audio/{base}.opus", "source": "native", "speed": "natural"},
            {"voice": voice_id, "src": f"audio/{base}_slow.opus", "source": "native", "speed": "slow"},
        ]
        data["audio"] = entries
        if pitch_out is not None:
            data["pitch"] = pitch_out.path
        studio.save_draft(db, pack.code, "concept", concept_id, data, user.id)
        db.commit()

    return AudioUploadOut(files=files, pitch=pitch_out)


@router.get("/packs/{code}/audio/{path:path}")
def get_audio(code: str, path: str, user: StudioUser, packs: PacksDep, settings: SettingsDep) -> FileResponse:
    """Aperçu : média du studio (brouillon), sinon média publié du pack. Seulement audio/ et pitch/."""
    pack = _pack(packs, code)
    if not re.fullmatch(r"(audio|pitch)/[A-Za-z0-9_\-/.]+", path) or ".." in path.split("/"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    for root in (settings.studio_media_dir / pack.code, pack.directory):
        base = root.resolve()
        candidate = (root / path).resolve()
        if candidate.is_relative_to(base) and candidate.is_file() and candidate.suffix in _MEDIA_TYPES:
            return FileResponse(candidate, media_type=_MEDIA_TYPES[candidate.suffix])
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
