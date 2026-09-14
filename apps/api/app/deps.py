"""Dépendances FastAPI : configuration, session de base, utilisateur authentifié, packs, limitation."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User
from app.services.auth import decode_access_token
from app.services.content import Pack, load_packs
from app.services.rate_limit import RateLimiter


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


def get_packs(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, Pack]:
    return load_packs(settings.content_dir)


SettingsDep = Annotated[Settings, Depends(get_settings)]
DbDep = Annotated[Session, Depends(get_db)]
PacksDep = Annotated[dict[str, Pack], Depends(get_packs)]

_bearer = HTTPBearer(auto_error=False)


def current_user(
    db: DbDep,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentification requise",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized
    user_id = decode_access_token(settings, credentials.credentials)
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def auth_rate_limit(request: Request) -> None:
    limiter: RateLimiter = request.app.state.auth_rate_limiter
    client = request.client.host if request.client else "unknown"
    if not limiter.hit(f"{client}:{request.url.path}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Trop de tentatives, réessaie plus tard"
        )
