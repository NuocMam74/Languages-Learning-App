"""`/auth/*` : inscription, connexion, rotation du refresh, déconnexion."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.deps import DbDep, PacksDep, SettingsDep, auth_rate_limit
from app.models import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.services import auth as auth_service
from app.services.learner import create_learner

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(auth_rate_limit)])

COOKIE_PATH = "/auth"


def _set_refresh_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        max_age=settings.refresh_token_ttl_days * 86_400,
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )


def _tokens(response: Response, settings: Settings, user_id: str, refresh: str) -> TokenResponse:
    _set_refresh_cookie(response, settings, refresh)
    return TokenResponse(
        access_token=auth_service.create_access_token(settings, user_id),
        expires_in=settings.access_token_ttl_seconds,
    )


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=TokenResponse)
def register(
    body: RegisterRequest, response: Response, db: DbDep, settings: SettingsDep, packs: PacksDep
) -> TokenResponse:
    email = body.email.lower()
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Un compte existe déjà avec cet email")
    user = User(
        email=email,
        password_hash=auth_service.hash_password(body.password),
        display_name=body.display_name.strip(),
        locale=body.locale,
        is_guest=False,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:  # inscription concurrente avec le même email
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Un compte existe déjà avec cet email"
        ) from exc
    create_learner(db, user, packs.get(settings.default_course))
    refresh = auth_service.issue_refresh_token(db, settings, user.id)
    db.commit()
    return _tokens(response, settings, user.id, refresh)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, response: Response, db: DbDep, settings: SettingsDep) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not auth_service.verify_password(user.password_hash if user else None, body.password) or user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou mot de passe incorrect")
    refresh = auth_service.issue_refresh_token(db, settings, user.id)
    db.commit()
    return _tokens(response, settings, user.id, refresh)


def _refresh_cookie(request: Request, settings: Settings) -> str | None:
    return request.cookies.get(settings.refresh_cookie_name)


@router.post("/refresh", response_model=TokenResponse)
def refresh(request: Request, response: Response, db: DbDep, settings: SettingsDep) -> TokenResponse | JSONResponse:
    token = _refresh_cookie(request, settings)
    rotated = auth_service.rotate_refresh_token(db, settings, token) if token else None
    db.commit()  # persiste aussi une révocation globale en cas de réutilisation
    if rotated is None:
        denied = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": "Session expirée, reconnecte-toi"}
        )
        denied.delete_cookie(settings.refresh_cookie_name, path=COOKIE_PATH)
        return denied
    user_id, new_token = rotated
    return _tokens(response, settings, user_id, new_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: DbDep, settings: SettingsDep) -> Response:
    token = _refresh_cookie(request, settings)
    if token:
        auth_service.revoke_refresh_token(db, token)
        db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        settings.refresh_cookie_name, path=COOKIE_PATH, httponly=True, secure=settings.cookie_secure, samesite="lax"
    )
    return response


@router.api_route("/oauth/{provider}", methods=["GET", "POST"])
def oauth(provider: str) -> None:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"Connexion OAuth ({provider}) prévue en Phase 1 : utilise l'email et le mot de passe.",
    )
