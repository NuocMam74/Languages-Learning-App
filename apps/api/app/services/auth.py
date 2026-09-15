"""Mots de passe (argon2), JWT d'accès court, jetons de rafraîchissement révocables, jetons e-mail à usage unique.

Rotation du refresh avec fenêtre de grâce de 30 s (contrat parcours §4) : le successeur d'un jeton est dérivé de
façon déterministe (HMAC du secret et du jeton consommé), si bien que rejouer le jeton qui vient d'être tourné
— deux onglets, réponse perdue — renvoie **le même** nouveau jeton sans rien révoquer. Hors de la fenêtre, la
réutilisation d'un jeton révoqué reste traitée comme un vol : toute la famille de jetons est révoquée.
"""

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AuthToken, RefreshToken

_hasher = PasswordHasher()
# Hash factice : la vérification coûte le même temps que l'email existe ou non.
_DUMMY_HASH = _hasher.hash("parlo-dummy-password")
JWT_ALGORITHM = "HS256"
REFRESH_GRACE = timedelta(seconds=30)

PASSWORD_RESET = "password_reset"  # noqa: S105  (nom d'usage, pas un secret)
EMAIL_VERIFY = "email_verify"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(settings: Settings, user_id: str, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    claims = {
        "sub": user_id,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(seconds=settings.access_token_ttl_seconds),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(settings: Settings, token: str) -> str | None:
    """Id de l'utilisateur si le jeton est valide, sinon None."""
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError:
        return None
    if claims.get("type") != "access":
        return None
    sub = claims.get("sub")
    return sub if isinstance(sub, str) else None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _successor_token(settings: Settings, token: str) -> str:
    digest = hmac.new(settings.jwt_secret.encode(), b"refresh-successor:" + token.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _add_refresh_token(db: Session, settings: Settings, user_id: str, token: str, now: datetime) -> RefreshToken:
    row = RefreshToken(
        user_id=user_id,
        token_hash=hash_token(token),
        created_at=now,
        expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
    )
    db.add(row)
    db.flush()
    return row


def issue_refresh_token(db: Session, settings: Settings, user_id: str) -> str:
    """Crée un jeton de rafraîchissement ; seul son hash est stocké."""
    token = secrets.token_urlsafe(48)
    _add_refresh_token(db, settings, user_id, token, datetime.now(UTC))
    return token


def rotate_refresh_token(
    db: Session, settings: Settings, token: str, now: datetime | None = None
) -> tuple[str, str] | None:
    """Consomme `token` et en émet un nouveau. Retourne (user_id, nouveau jeton) ou None."""
    now = now or datetime.now(UTC)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(token)))
    if row is None:
        return None
    if row.revoked_at is not None:
        if row.replaced_by_id is not None and now - row.revoked_at <= REFRESH_GRACE:
            successor = db.get(RefreshToken, row.replaced_by_id)
            replay = _successor_token(settings, token)
            if (
                successor is not None
                and successor.revoked_at is None
                and successor.expires_at > now
                and hmac.compare_digest(successor.token_hash, hash_token(replay))
            ):
                return row.user_id, replay
            return None  # dans la fenêtre de grâce : refus sans révocation
        revoke_all(db, row.user_id)  # réutilisation hors fenêtre : vol probable
        return None
    if row.expires_at <= now:
        return None
    new_token = _successor_token(settings, token)
    successor = _add_refresh_token(db, settings, row.user_id, new_token, now)
    row.revoked_at = now
    row.replaced_by_id = successor.id
    return row.user_id, new_token


def revoke_refresh_token(db: Session, token: str) -> None:
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(token)))
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)


def revoke_all(db: Session, user_id: str) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


# --- Jetons e-mail à usage unique ------------------------------------------------------------


def issue_auth_token(db: Session, user_id: str, purpose: str, ttl: timedelta, now: datetime | None = None) -> str:
    """Nouveau jeton (les précédents du même usage deviennent inutilisables) ; seul son hash est stocké."""
    now = now or datetime.now(UTC)
    db.execute(
        update(AuthToken)
        .where(AuthToken.user_id == user_id, AuthToken.purpose == purpose, AuthToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = secrets.token_urlsafe(32)
    db.add(
        AuthToken(user_id=user_id, purpose=purpose, token_hash=hash_token(token), created_at=now, expires_at=now + ttl)
    )
    db.flush()
    return token


def consume_auth_token(db: Session, token: str, purpose: str, now: datetime | None = None) -> AuthToken | None:
    """Jeton valide (bon usage, non utilisé, non expiré) marqué utilisé ; None sinon."""
    now = now or datetime.now(UTC)
    row = db.scalar(select(AuthToken).where(AuthToken.token_hash == hash_token(token)))
    if row is None or row.purpose != purpose or row.used_at is not None or row.expires_at <= now:
        return None
    row.used_at = now
    return row
