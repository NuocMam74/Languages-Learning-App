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
from app.services.email import EmailSender
from app.services.exams import ExamSpec, load_exams
from app.services.oauth import OAuthClient
from app.services.pdf import PdfRenderer
from app.services.rate_limit import RateLimiter, client_ip
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


def get_email_sender(request: Request) -> EmailSender:
    sender: EmailSender = request.app.state.email_sender
    return sender


def get_oauth_client(request: Request) -> OAuthClient:
    client: OAuthClient = request.app.state.oauth_client
    return client


EmailDep = Annotated[EmailSender, Depends(get_email_sender)]
OAuthDep = Annotated[OAuthClient, Depends(get_oauth_client)]
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


def request_client_ip(request: Request) -> str:
    """IP client réelle (X-Forwarded-For lu seulement derrière un proxy de TRUSTED_PROXIES)."""
    return client_ip(
        request.client.host if request.client else None,
        request.headers.get("x-forwarded-for"),
        request.app.state.trusted_networks,
    )


def auth_rate_limit(request: Request) -> None:
    limiter: RateLimiter = request.app.state.auth_rate_limiter
    route = request.scope.get("route")
    # Gabarit de route (et non chemin brut) : `/auth/oauth/<aléatoire>` ne crée pas une clé par requête.
    path = getattr(route, "path", None) or request.url.path
    if not limiter.hit(f"{request_client_ip(request)}:{path}"):
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
