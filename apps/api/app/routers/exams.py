"""`/exams/*`, `/certificates/*` (JWT) et `/verify/{code}` (public) — contrat Phase 2 §2."""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbDep, ExamsDep, PacksDep, PdfRendererDep, SettingsDep, StorageDep
from app.models import Certificate, Exam, ExamAttempt, User
from app.schemas.phase2 import (
    CertificateOut,
    CertificateRef,
    ExamItemRef,
    ExamOut,
    ExamResultOut,
    ExamScores,
    ExamStartOut,
    ExamSubmit,
    GapOut,
    LastAttemptOut,
    VerifyOut,
)
from app.services import certificates, exams, learner
from app.services.content import Pack
from app.services.engine import ContentError
from app.services.exams import ExamSpec
from app.services.media import media_index

router = APIRouter(tags=["exams"])


def _now() -> datetime:
    return datetime.now(UTC)


def _user_pack(db: Session, user: User, packs: dict[str, Pack], default_course: str) -> Pack | None:
    enrollment = learner.primary_enrollment(db, user.id)
    code = enrollment.course_id if enrollment else default_course
    return packs.get(code)


def _scores(raw: dict[str, Any] | None) -> ExamScores:
    """Score null : compétence sans item noté (médias manquants, contrat parcours §1)."""
    raw = raw or {}
    values: dict[str, float | None] = {}
    for skill in exams.SKILLS:
        value = raw.get(skill, 0.0)
        values[skill] = None if value is None else float(value)
    return ExamScores(**values)


def _find_exam(
    all_exams: dict[str, dict[str, ExamSpec]], packs: dict[str, Pack], exam_id: str
) -> tuple[Pack, ExamSpec]:
    for code, pack_exams in all_exams.items():
        if exam_id in pack_exams and code in packs:
            return packs[code], pack_exams[exam_id]
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="exam_not_found")


@router.get("/exams", response_model=list[ExamOut])
def list_exams(
    user: CurrentUser, db: DbDep, packs: PacksDep, all_exams: ExamsDep, settings: SettingsDep
) -> list[ExamOut]:
    pack = _user_pack(db, user, packs, settings.default_course)
    if pack is None:
        return []
    now = _now()
    index = media_index(pack, settings.studio_media_dir)
    out: list[ExamOut] = []
    for exam in all_exams.get(pack.code, {}).values():
        last = exams.last_submitted(db, user.id, exam.id)
        out.append(
            ExamOut(
                id=exam.id,
                level=exam.level,
                certificate=exam.certificate,
                requires_units=exam.requires_units,
                duration_minutes=exam.duration_minutes,
                unlocked=exams.is_unlocked(db, user.id, pack, exam),
                last_attempt=LastAttemptOut(
                    id=last.id,
                    submitted_at=last.submitted_at,
                    passed=bool(last.passed),
                    scores=_scores((last.score_json or {}).get("scores")),
                    global_=(last.score_json or {}).get("global"),
                )
                if last is not None and last.submitted_at is not None
                else None,
                next_attempt_at=exams.next_attempt_at(exam, last, now),
                unavailable_reason=exams.unavailable_reason(pack, exam, index),
            )
        )
    return out


def _start_out(exam: ExamSpec, attempt: ExamAttempt) -> ExamStartOut:
    return ExamStartOut(
        attempt_id=attempt.id,
        seed=attempt.id,
        started_at=attempt.started_at,
        expires_at=attempt.expires_at or exams.expires_at(exam, attempt.started_at),
        items=[ExamItemRef(section=skill, index=index) for skill, index in exam.items()],  # type: ignore[arg-type]
    )


@router.post("/exams/{exam_id}/start", response_model=ExamStartOut, status_code=status.HTTP_201_CREATED)
def start_exam(
    exam_id: str, user: CurrentUser, db: DbDep, packs: PacksDep, all_exams: ExamsDep, settings: SettingsDep
) -> Any:
    pack, exam = _find_exam(all_exams, packs, exam_id)
    now = _now()
    if not exams.is_unlocked(db, user.id, pack, exam):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="locked_units")
    if exams.unavailable_reason(pack, exam, media_index(pack, settings.studio_media_dir)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=exams.MEDIA_MISSING)
    locked_until = exams.next_attempt_at(exam, exams.last_submitted(db, user.id, exam.id), now)
    if locked_until is not None:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "retry_locked", "nextAttemptAt": locked_until.isoformat().replace("+00:00", "Z")},
        )
    try:
        exams.build_items(pack, exam, "check")
    except ContentError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="exam_unavailable") from exc

    active = exams.active_attempt(db, user.id, exam.id, now)
    if active is not None:
        return _start_out(exam, active)

    row = db.get(Exam, exam.id)
    if row is None:
        row = Exam(id=exam.id, course_id=pack.code, level=exam.level, spec_json=exam.raw)
        db.add(row)
    else:
        row.spec_json = exam.raw
        row.level = exam.level
    attempt = ExamAttempt(user_id=user.id, exam_id=exam.id, started_at=now, expires_at=exams.expires_at(exam, now))
    db.add(attempt)
    db.commit()
    return _start_out(exam, attempt)


@router.post("/exams/attempts/{attempt_id}/submit", response_model=ExamResultOut)
def submit_exam(
    attempt_id: str,
    body: ExamSubmit,
    user: CurrentUser,
    db: DbDep,
    packs: PacksDep,
    settings: SettingsDep,
    renderer: PdfRendererDep,
    storage: StorageDep,
) -> ExamResultOut:
    attempt = db.get(ExamAttempt, attempt_id)
    if attempt is None or attempt.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="attempt_not_found")
    if attempt.submitted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="already_submitted")
    now = _now()
    if exams.is_expired(attempt, now):
        raise HTTPException(status.HTTP_410_GONE, detail="expired")

    row = db.get(Exam, attempt.exam_id)
    pack = packs.get(row.course_id) if row else None
    if row is None or pack is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="exam_unavailable")
    # Instantané du fichier pris au démarrage : les items notés sont ceux que le client a reçus.
    exam = exams.parse_exam(row.spec_json)

    answers = [a.model_dump(by_alias=True) for a in body.answers]
    try:
        result = exams.grade(pack, exam, attempt.id, answers, media_index(pack, settings.studio_media_dir))
    except ContentError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="exam_unavailable") from exc

    attempt.submitted_at = now
    attempt.passed = result.passed
    attempt.answers_json = answers
    attempt.score_json = {
        "global": result.global_score,
        "scores": result.scores,
        "gaps": result.gaps,
        "gradedItems": result.graded_items,
    }

    certificate_ref: CertificateRef | None = None
    if result.passed:
        certificate = certificates.issue_certificate(db, user, pack.code, exam, attempt, result.scores, now)
        if certificate.pdf_url is None:
            certificates.render_and_store(settings, renderer, storage, certificate, user.locale)
        certificate_ref = CertificateRef(id=certificate.id, verification_code=certificate.verification_code)
    db.commit()

    return ExamResultOut(
        passed=result.passed,
        global_=result.global_score,
        scores=_scores(result.scores),
        gaps=[GapOut(skill=g["skill"], concept_ids=g["conceptIds"]) for g in result.gaps],
        certificate=certificate_ref,
    )


@router.get("/exams/attempts/{attempt_id}", response_model=ExamResultOut)
def attempt_result(attempt_id: str, user: CurrentUser, db: DbDep) -> ExamResultOut:
    """Résultat d'une tentative déjà soumise (client qui a perdu la réponse de `submit`)."""
    attempt = db.get(ExamAttempt, attempt_id)
    if attempt is None or attempt.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="attempt_not_found")
    if attempt.submitted_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="not_submitted")
    score = attempt.score_json or {}
    certificate = db.scalar(select(Certificate).where(Certificate.attempt_id == attempt.id).limit(1))
    return ExamResultOut(
        passed=bool(attempt.passed),
        global_=float(score.get("global", 0.0)),
        scores=_scores(score.get("scores")),
        gaps=[GapOut(skill=g["skill"], concept_ids=g["conceptIds"]) for g in score.get("gaps", [])],
        certificate=CertificateRef(id=certificate.id, verification_code=certificate.verification_code)
        if certificate is not None
        else None,
    )


@router.get("/certificates", response_model=list[CertificateOut])
def list_certificates(user: CurrentUser, db: DbDep) -> list[CertificateOut]:
    rows = db.scalars(select(Certificate).where(Certificate.user_id == user.id).order_by(Certificate.issued_at))
    return [
        CertificateOut(
            id=c.id,
            level=c.level,
            issued_at=c.issued_at,
            verification_code=c.verification_code,
            pdf_url=f"/certificates/{c.id}.pdf",
            share_image_url=None,
        )
        for c in rows
    ]


@router.get("/certificates/{certificate_id}.pdf", response_class=Response)
def certificate_pdf(
    certificate_id: str,
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
    renderer: PdfRendererDep,
    storage: StorageDep,
) -> Response:
    certificate = db.get(Certificate, certificate_id)
    if certificate is None or certificate.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="certificate_not_found")
    data = certificates.certificate_pdf(settings, renderer, storage, certificate, user.locale)
    db.commit()
    filename = f"parlo-{certificate.level.lower()}-{certificate.verification_code}.pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"},
    )


@router.get("/verify/{code}", response_model=VerifyOut, responses={404: {"description": "{valid: false}"}})
def verify(code: str, db: DbDep) -> Any:
    certificate = db.scalar(
        select(Certificate).where(Certificate.verification_code == certificates.normalize_code(code))
    )
    if certificate is None:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"valid": False})
    return VerifyOut(
        valid=True,
        display_name=certificate.display_name or "",
        level=certificate.level,
        certificate=certificate.certificate_name or {},
        issued_at=certificate.issued_at,
        scores=_scores(certificate.scores_json),
    )
