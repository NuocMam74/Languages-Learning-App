"""Dépendances FastAPI : configuration, session de base, utilisateur authentifié, packs, limitation."""

from collections.abc import Callable, Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User
from app.services.auth import decode_access_token
from app.services.content import Pack, load_packs
from app.services.exams import ExamSpec, load_exams
from app.services.pdf import PdfRenderer
from app.services.rate_limit import RateLimiter
from app.services.storage import FileStorage


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


def get_exams(packs: PacksDep) -> dict[str, dict[str, ExamSpec]]:
    """Examens par code de pack (relus à chaque requête : le contenu peut être publié sans redémarrage)."""
    return {code: load_exams(pack) for code, pack in packs.items()}


def get_pdf_renderer(request: Request) -> PdfRenderer:
    renderer: PdfRenderer = request.app.state.pdf_renderer
    return renderer


def get_storage(request: Request) -> FileStorage:
    storage: FileStorage = request.app.state.storage
    return storage


ExamsDep = Annotated[dict[str, dict[str, ExamSpec]], Depends(get_exams)]
PdfRendererDep = Annotated[PdfRenderer, Depends(get_pdf_renderer)]
StorageDep = Annotated[FileStorage, Depends(get_storage)]

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


# --- Rôles (contrat Phase 4 §0) ------------------------------------------------------------

ROLES = ("learner", "reviewer", "editor", "teacher", "admin")
GRANTABLE_ROLES = ("reviewer", "editor", "teacher", "admin")


def user_roles(user: User) -> list[str]:
    """Rôles effectifs : `learner` (implicite) puis les rôles attribués, dans l'ordre de ROLES."""
    granted = set(user.roles or [])
    return ["learner", *(r for r in GRANTABLE_ROLES if r in granted)]


def require_roles(*roles: str) -> Callable[[User], User]:
    """Dépendance : l'utilisateur doit avoir l'un des rôles (`admin` passe partout). 403 sinon."""
    unknown = set(roles) - set(ROLES)
    if unknown:
        raise ValueError(f"Rôles inconnus : {sorted(unknown)}")

    def dependency(user: CurrentUser) -> User:
        granted = set(user_roles(user))
        if "admin" in granted or granted & set(roles):
            return user
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="forbidden_role")

    return dependency
