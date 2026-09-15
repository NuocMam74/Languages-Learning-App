"""`/auth/*` : inscription, connexion, rotation du refresh, déconnexion, mot de passe oublié, vérification de
l'e-mail, OAuth Google/Apple (contrat parcours §4)."""

from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.deps import CurrentUser, DbDep, EmailDep, OAuthDep, PacksDep, SettingsDep, auth_rate_limit
from app.models import User
from app.schemas.auth import (
    EmailVerifyRequest,
    LoginRequest,
    OAuthProviderOut,
    PasswordForgotRequest,
    PasswordResetRequest,
    RegisterRequest,
    TokenResponse,
)
from app.services import auth as auth_service
from app.services import email as email_service
from app.services import oauth as oauth_service
from app.services.email import EmailSender
from app.services.learner import create_learner

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(auth_rate_limit)])


def cookie_path(settings: Settings) -> str:
    """Chemin vu par le navigateur : préfixe du proxy (ROOT_PATH) + /auth."""
    return f"{settings.normalized_root_path}/auth"


def _set_refresh_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        max_age=settings.refresh_token_ttl_days * 86_400,
        path=cookie_path(settings),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )


def clear_refresh_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.refresh_cookie_name,
        path=cookie_path(settings),
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


def _web_link(settings: Settings, path: str, token: str) -> str:
    return f"{settings.public_web_url.rstrip('/')}{path}?{urlencode({'token': token})}"


def send_verification(db: DbDep, settings: Settings, sender: EmailSender, user: User) -> None:
    if not user.email:
        return
    token = auth_service.issue_auth_token(
        db, user.id, auth_service.EMAIL_VERIFY, timedelta(hours=settings.email_verify_ttl_hours)
    )
    link = _web_link(settings, "/compte/verifier", token)
    email_service.send_safely(sender, email_service.verify_email_message(user.email, user.locale, link))


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=TokenResponse)
def register(
    body: RegisterRequest,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
    packs: PacksDep,
    sender: EmailDep,
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
    send_verification(db, settings, sender, user)
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
        denied.delete_cookie(settings.refresh_cookie_name, path=cookie_path(settings))
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
    clear_refresh_cookie(response, settings)
    return response


# --- Mot de passe oublié, vérification de l'e-mail ------------------------------------------------


@router.post("/password/forgot", status_code=status.HTTP_204_NO_CONTENT)
def password_forgot(body: PasswordForgotRequest, db: DbDep, settings: SettingsDep, sender: EmailDep) -> Response:
    """Toujours 204 : la réponse ne révèle pas si un compte existe."""
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user is not None and user.email:
        token = auth_service.issue_auth_token(
            db, user.id, auth_service.PASSWORD_RESET, timedelta(minutes=settings.password_reset_ttl_minutes)
        )
        db.commit()
        link = _web_link(settings, "/compte/reinitialiser", token)
        email_service.send_safely(
            sender,
            email_service.password_reset_message(user.email, user.locale, link, settings.password_reset_ttl_minutes),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
def password_reset(body: PasswordResetRequest, db: DbDep, settings: SettingsDep) -> Response:
    row = auth_service.consume_auth_token(db, body.token, auth_service.PASSWORD_RESET)
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid_token")
    user.password_hash = auth_service.hash_password(body.password)
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)  # le lien reçu prouve la possession de l'adresse
    auth_service.revoke_all(db, user.id)  # toutes les sessions sont fermées
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response, settings)
    return response


@router.post("/email/verify", status_code=status.HTTP_204_NO_CONTENT)
def email_verify(body: EmailVerifyRequest, db: DbDep) -> Response:
    row = auth_service.consume_auth_token(db, body.token, auth_service.EMAIL_VERIFY)
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid_token")
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/email/resend", status_code=status.HTTP_204_NO_CONTENT)
def email_resend(user: CurrentUser, db: DbDep, settings: SettingsDep, sender: EmailDep) -> Response:
    if user.email and user.email_verified_at is None:
        send_verification(db, settings, sender, user)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- OAuth ------------------------------------------------------------------------------------------


@router.get("/oauth/providers", response_model=list[OAuthProviderOut])
def oauth_providers(settings: SettingsDep) -> list[OAuthProviderOut]:
    return [OAuthProviderOut(id=p.id, name=p.name) for p in oauth_service.configured_providers(settings)]  # type: ignore[arg-type]


def _oauth_redirect(settings: Settings, outcome: str, next_path: str, reason: str | None = None) -> RedirectResponse:
    params = {"oauth": outcome, "next": next_path}
    if reason:
        params["reason"] = reason
    return RedirectResponse(
        f"{settings.public_web_url.rstrip('/')}/compte?{urlencode(params)}", status_code=status.HTTP_302_FOUND
    )


def _state_cookie_kwargs(settings: Settings) -> dict[str, object]:
    # Apple revient en POST inter-sites (form_post) : SameSite=None (donc Secure) quand c'est possible.
    return {
        "path": f"{cookie_path(settings)}/oauth",
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "none" if settings.cookie_secure else "lax",
    }


@router.get("/oauth/{provider}/start")
def oauth_start(
    provider: str,
    settings: SettingsDep,
    client: OAuthDep,
    next_path: Annotated[str | None, Query(alias="next", max_length=512)] = None,
) -> RedirectResponse:
    if not oauth_service.is_configured(settings, provider):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="oauth_provider_unavailable")
    target = oauth_service.safe_next(next_path)
    state, nonce, binding = oauth_service.new_state(settings, provider, target)
    try:
        url = client.authorization_url(provider, state, nonce)
    except oauth_service.OAuthError as exc:
        return _oauth_redirect(settings, "error", target, str(exc))
    response = RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        oauth_service.STATE_COOKIE,
        binding,
        max_age=int(oauth_service.STATE_TTL.total_seconds()),
        **_state_cookie_kwargs(settings),  # type: ignore[arg-type]
    )
    return response


def _oauth_finish(
    provider: str,
    code: str | None,
    state: str | None,
    error: str | None,
    user_json: str | None,
    request: Request,
    db: DbDep,
    settings: Settings,
    packs: PacksDep,
    client: oauth_service.OAuthClient,
) -> RedirectResponse:
    if not oauth_service.is_configured(settings, provider):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="oauth_provider_unavailable")
    next_path = "/"
    try:
        claims = oauth_service.read_state(
            settings, provider, state or "", request.cookies.get(oauth_service.STATE_COOKIE)
        )
        next_path = oauth_service.safe_next(claims.get("next"))
        if error or not code:
            raise oauth_service.OAuthError(error or "missing_code")
        identity = client.exchange(provider, code, str(claims.get("nonce", "")), user_json)
        user = oauth_service.find_or_create_user(db, identity, packs.get(settings.default_course))
        refresh_token = auth_service.issue_refresh_token(db, settings, user.id)
        db.commit()
    except oauth_service.OAuthError as exc:
        db.rollback()
        response = _oauth_redirect(settings, "error", next_path, str(exc))
    else:
        response = _oauth_redirect(settings, "ok", next_path)
        _set_refresh_cookie(response, settings, refresh_token)
    response.delete_cookie(oauth_service.STATE_COOKIE, **_state_cookie_kwargs(settings))  # type: ignore[arg-type]
    return response


@router.get("/oauth/{provider}/callback")
def oauth_callback_get(
    provider: str,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    packs: PacksDep,
    client: OAuthDep,
    code: Annotated[str | None, Query(max_length=4096)] = None,
    state: Annotated[str | None, Query(max_length=4096)] = None,
    error: Annotated[str | None, Query(max_length=128)] = None,
) -> RedirectResponse:
    return _oauth_finish(provider, code, state, error, None, request, db, settings, packs, client)


@router.post("/oauth/{provider}/callback")
def oauth_callback_post(
    provider: str,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    packs: PacksDep,
    client: OAuthDep,
    code: Annotated[str | None, Form(max_length=4096)] = None,
    state: Annotated[str | None, Form(max_length=4096)] = None,
    error: Annotated[str | None, Form(max_length=128)] = None,
    user: Annotated[str | None, Form(max_length=4096)] = None,
) -> RedirectResponse:
    return _oauth_finish(provider, code, state, error, user, request, db, settings, packs, client)
