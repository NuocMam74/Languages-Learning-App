"""Certificats : délivrance après un examen réussi, code de vérification, PDF (spec §5.5)."""

import logging
import secrets
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Certificate, ExamAttempt, User
from app.services.exams import ExamSpec
from app.services.pdf import CertificateDocument, PdfRenderer
from app.services.storage import FileStorage

logger = logging.getLogger(__name__)

# Crockford base32 : sans I, L, O, U (lisible, dictable).
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 10


def new_verification_code() -> str:
    return "".join(secrets.choice(CROCKFORD) for _ in range(CODE_LENGTH))


def normalize_code(raw: str) -> str:
    """Saisie tolérante : minuscules, tirets/espaces, I/L → 1, O → 0."""
    code = raw.strip().upper().replace("-", "").replace(" ", "")
    return code.translate(str.maketrans({"I": "1", "L": "1", "O": "0"}))


def verify_url(settings: Settings, code: str) -> str:
    return f"{settings.public_web_url.rstrip('/')}/verifier/{code}"


def pdf_key(certificate: Certificate) -> str:
    return f"certificates/{certificate.id}.pdf"


def document_for(settings: Settings, certificate: Certificate, locale: str) -> CertificateDocument:
    names = certificate.certificate_name or {}
    return CertificateDocument(
        display_name=certificate.display_name or "",
        level=certificate.level,
        certificate_name=names.get(locale) or names.get("fr") or certificate.level,
        issued_on=certificate.issued_at.date(),
        scores=dict(certificate.scores_json or {}),
        verification_code=certificate.verification_code,
        verify_url=verify_url(settings, certificate.verification_code),
        locale=locale if locale in ("fr", "en") else "fr",
    )


def issue_certificate(
    db: Session,
    user: User,
    course_id: str,
    exam: ExamSpec,
    attempt: ExamAttempt,
    scores: dict[str, float],
    now: datetime,
) -> Certificate:
    """Un certificat par niveau et par utilisateur : une nouvelle réussite renvoie le certificat existant."""
    existing = db.scalar(
        select(Certificate).where(Certificate.user_id == user.id, Certificate.level == exam.level).limit(1)
    )
    if existing is not None:
        return existing
    code = new_verification_code()
    while db.scalar(select(Certificate.id).where(Certificate.verification_code == code)) is not None:
        code = new_verification_code()
    certificate = Certificate(
        user_id=user.id,
        level=exam.level,
        issued_at=now,
        verification_code=code,
        course_id=course_id,
        attempt_id=attempt.id,
        display_name=user.display_name,
        certificate_name=dict(exam.certificate),
        scores_json=dict(scores),
    )
    db.add(certificate)
    db.flush()
    return certificate


def render_and_store(
    settings: Settings, renderer: PdfRenderer, storage: FileStorage, certificate: Certificate, locale: str
) -> bytes:
    data = renderer.render(document_for(settings, certificate, locale))
    key = pdf_key(certificate)
    try:
        storage.save(key, data, "application/pdf")
        certificate.pdf_url = key
    except Exception:  # stockage indisponible : le PDF reste régénérable à la demande
        logger.exception("Stockage du certificat %s impossible", certificate.id)
    return data


def certificate_pdf(
    settings: Settings, renderer: PdfRenderer, storage: FileStorage, certificate: Certificate, locale: str
) -> bytes:
    """PDF stocké, sinon régénéré (même contenu : les données du certificat sont figées)."""
    if certificate.pdf_url:
        try:
            stored = storage.load(certificate.pdf_url)
        except Exception:
            logger.exception("Lecture du certificat %s impossible", certificate.id)
            stored = None
        if stored:
            return stored
    return render_and_store(settings, renderer, storage, certificate, locale)
