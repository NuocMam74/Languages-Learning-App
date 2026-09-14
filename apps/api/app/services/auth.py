"""Mots de passe (argon2), JWT d'accès court et jetons de rafraîchissement révocables."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import RefreshToken

_hasher = PasswordHasher()
# Hash factice : la vérification coûte le même temps que l'email existe ou non.
_DUMMY_HASH = _hasher.hash("parlo-dummy-password")
JWT_ALGORITHM = "HS256"


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


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_refresh_token(db: Session, settings: Settings, user_id: str) -> str:
    """Crée un jeton de rafraîchissement ; seul son hash est stocké."""
    token = secrets.token_urlsafe(48)
    now = datetime.now(UTC)
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=_hash_token(token),
            created_at=now,
            expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
        )
    )
    return token


def rotate_refresh_token(db: Session, settings: Settings, token: str) -> tuple[str, str] | None:
    """Consomme `token` et en émet un nouveau. Retourne (user_id, nouveau jeton) ou None.

    Réutilisation d'un jeton déjà révoqué = vol probable : tous les jetons de l'utilisateur sont révoqués.
    """
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(token)))
    now = datetime.now(UTC)
    if row is None:
        return None
    if row.revoked_at is not None:
        revoke_all(db, row.user_id)
        return None
    if row.expires_at <= now:
        return None
    row.revoked_at = now
    return row.user_id, issue_refresh_token(db, settings, row.user_id)


def revoke_refresh_token(db: Session, token: str) -> None:
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(token)))
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)


def revoke_all(db: Session, user_id: str) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
