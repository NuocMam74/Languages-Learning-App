"""Connexion Google / Apple (OpenID Connect, flux « authorization code ») — contrat parcours §4.

- Un fournisseur n'est proposé que s'il est configuré (Google : client id + secret ; Apple : client id, team id,
  key id et clé privée ES256).
- `start` : état signé (JWT, 10 min) portant fournisseur, `next` et nonce, lié à un cookie httpOnly aléatoire.
- `callback` : vérification de l'état et du cookie, échange du code (httpx), vérification de l'`id_token`
  (signature via le JWKS du fournisseur, `iss`, `aud`, `exp`, `nonce`), puis compte lié par `sub`, sinon par
  e-mail vérifié, sinon créé.
Les appels HTTP passent par un `httpx.Client` injectable (tests : transport simulé).
"""

import json
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User
from app.services.content import Pack
from app.services.learner import create_learner

STATE_TTL = timedelta(minutes=10)
STATE_COOKIE = "parlo_oauth"
_DISCOVERY_TTL_SECONDS = 3600
APPLE_AUTHORIZE = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN = "https://appleid.apple.com/auth/token"  # noqa: S105  (URL)
APPLE_JWKS = "https://appleid.apple.com/auth/keys"


class OAuthError(Exception):
    """Échec du flux (code d'erreur court, renvoyé au client dans la redirection)."""


@dataclass(frozen=True)
class Provider:
    id: str
    name: str


@dataclass(frozen=True)
class Endpoints:
    authorization: str
    token: str
    jwks: str
    issuer: str


@dataclass(frozen=True)
class Identity:
    provider: str
    subject: str
    email: str | None
    email_verified: bool
    name: str | None


def configured_providers(settings: Settings) -> list[Provider]:
    out = []
    if settings.google_client_id and settings.google_client_secret:
        out.append(Provider("google", "Google"))
    if settings.apple_client_id and settings.apple_team_id and settings.apple_key_id and settings.apple_private_key:
        out.append(Provider("apple", "Apple"))
    return out


def is_configured(settings: Settings, provider_id: str) -> bool:
    return any(p.id == provider_id for p in configured_providers(settings))


def redirect_uri(settings: Settings, provider_id: str) -> str:
    return f"{settings.public_api_url.rstrip('/')}{settings.normalized_root_path}/auth/oauth/{provider_id}/callback"


def safe_next(value: str | None) -> str:
    """Chemin relatif de la PWA seulement (pas de redirection ouverte)."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    return value[:512]


class OAuthClient:
    """Découverte OIDC mise en cache et appels HTTP des fournisseurs."""

    def __init__(self, settings: Settings, http: httpx.Client | None = None) -> None:
        self.settings = settings
        self.http = http or httpx.Client(timeout=settings.oauth_http_timeout_seconds)
        self._discovery: dict[str, tuple[float, Endpoints]] = {}
        self._jwks: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    # -- découverte --

    def endpoints(self, provider_id: str) -> Endpoints:
        if provider_id == "apple":
            return Endpoints(APPLE_AUTHORIZE, APPLE_TOKEN, APPLE_JWKS, self.settings.apple_issuer)
        with self._lock:
            cached = self._discovery.get(provider_id)
            if cached and cached[0] > time.monotonic():
                return cached[1]
        data = self._get_json(self.settings.google_discovery_url)
        try:
            endpoints = Endpoints(
                data["authorization_endpoint"], data["token_endpoint"], data["jwks_uri"], data["issuer"]
            )
        except KeyError as exc:
            raise OAuthError("discovery_failed") from exc
        with self._lock:
            self._discovery[provider_id] = (time.monotonic() + _DISCOVERY_TTL_SECONDS, endpoints)
        return endpoints

    def _get_json(self, url: str) -> dict[str, Any]:
        try:
            res = self.http.get(url)
            res.raise_for_status()
            data = res.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OAuthError("provider_unreachable") from exc
        if not isinstance(data, dict):
            raise OAuthError("provider_unreachable")
        return data

    def _signing_key(self, jwks_url: str, kid: str | None) -> jwt.PyJWK:
        for attempt in range(2):
            with self._lock:
                cached = self._jwks.get(jwks_url)
            if cached is None or cached[0] <= time.monotonic() or attempt == 1:
                data = self._get_json(jwks_url)
                with self._lock:
                    self._jwks[jwks_url] = (time.monotonic() + _DISCOVERY_TTL_SECONDS, data)
            else:
                data = cached[1]
            for key in data.get("keys", []):
                if isinstance(key, dict) and (kid is None or key.get("kid") == kid):
                    try:
                        return jwt.PyJWK(key)
                    except jwt.PyJWTError as exc:
                        raise OAuthError("invalid_jwks") from exc
        raise OAuthError("unknown_signing_key")

    # -- flux --

    def authorization_url(self, provider_id: str, state: str, nonce: str) -> str:
        endpoints = self.endpoints(provider_id)
        params = {
            "response_type": "code",
            "client_id": self._client_id(provider_id),
            "redirect_uri": redirect_uri(self.settings, provider_id),
            "scope": "openid email name" if provider_id == "apple" else "openid email profile",
            "state": state,
            "nonce": nonce,
        }
        if provider_id == "apple":
            params["response_mode"] = "form_post"  # Apple exige form_post dès qu'on demande nom ou e-mail
        else:
            params["prompt"] = "select_account"
        return f"{endpoints.authorization}?{urlencode(params)}"

    def exchange(self, provider_id: str, code: str, nonce: str, user_json: str | None = None) -> Identity:
        endpoints = self.endpoints(provider_id)
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri(self.settings, provider_id),
            "client_id": self._client_id(provider_id),
            "client_secret": self._client_secret(provider_id),
        }
        try:
            res = self.http.post(endpoints.token, data=form, headers={"Accept": "application/json"})
            res.raise_for_status()
            payload = res.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OAuthError("token_exchange_failed") from exc
        id_token = payload.get("id_token") if isinstance(payload, dict) else None
        if not isinstance(id_token, str):
            raise OAuthError("token_exchange_failed")
        claims = self.verify_id_token(provider_id, id_token, endpoints, nonce)
        email = claims.get("email") if isinstance(claims.get("email"), str) else None
        verified = claims.get("email_verified") in (True, "true")
        name = claims.get("name") if isinstance(claims.get("name"), str) else None
        if name is None and user_json:  # Apple : nom transmis une seule fois, hors id_token
            try:
                user = json.loads(user_json)
                parts = [user.get("name", {}).get("firstName"), user.get("name", {}).get("lastName")]
                name = " ".join(p for p in parts if isinstance(p, str) and p) or None
            except (ValueError, AttributeError):
                name = None
        return Identity(provider_id, str(claims["sub"]), email.lower() if email else None, verified, name)

    def verify_id_token(self, provider_id: str, token: str, endpoints: Endpoints, nonce: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise OAuthError("invalid_id_token") from exc
        key = self._signing_key(endpoints.jwks, header.get("kid"))
        issuers = [endpoints.issuer]
        if provider_id == "google":
            issuers.append("accounts.google.com")
        try:
            claims = jwt.decode(
                token,
                key=key,
                algorithms=["RS256", "ES256"],
                audience=self._client_id(provider_id),
                issuer=issuers,
                options={"require": ["exp", "iat", "sub", "iss", "aud"]},
                leeway=60,
            )
        except jwt.PyJWTError as exc:
            raise OAuthError("invalid_id_token") from exc
        if claims.get("nonce") != nonce:
            raise OAuthError("invalid_nonce")
        return claims

    def _client_id(self, provider_id: str) -> str:
        value = self.settings.apple_client_id if provider_id == "apple" else self.settings.google_client_id
        if not value:
            raise OAuthError("provider_not_configured")
        return value

    def _client_secret(self, provider_id: str) -> str:
        s = self.settings
        if provider_id == "google":
            if not s.google_client_secret:
                raise OAuthError("provider_not_configured")
            return s.google_client_secret
        if not (s.apple_team_id and s.apple_key_id and s.apple_private_key and s.apple_client_id):
            raise OAuthError("provider_not_configured")
        now = datetime.now(UTC)
        return jwt.encode(
            {
                "iss": s.apple_team_id,
                "iat": now,
                "exp": now + timedelta(minutes=5),
                "aud": s.apple_issuer,
                "sub": s.apple_client_id,
            },
            s.apple_private_key.replace("\\n", "\n"),
            algorithm="ES256",
            headers={"kid": s.apple_key_id},
        )


# --- État signé ----------------------------------------------------------------------------------


def new_state(settings: Settings, provider_id: str, next_path: str) -> tuple[str, str, str]:
    """(state JWT, nonce, valeur du cookie de liaison)."""
    nonce = secrets.token_urlsafe(24)
    binding = secrets.token_urlsafe(24)
    now = datetime.now(UTC)
    state = jwt.encode(
        {
            "type": "oauth_state",
            "provider": provider_id,
            "next": next_path,
            "nonce": nonce,
            "bind": binding,
            "iat": now,
            "exp": now + STATE_TTL,
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    return state, nonce, binding


def read_state(settings: Settings, provider_id: str, state: str, binding: str | None) -> dict[str, Any]:
    try:
        claims = jwt.decode(state, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp"]})
    except jwt.PyJWTError as exc:
        raise OAuthError("invalid_state") from exc
    if claims.get("type") != "oauth_state" or claims.get("provider") != provider_id:
        raise OAuthError("invalid_state")
    if not binding or not secrets.compare_digest(str(claims.get("bind", "")), binding):
        raise OAuthError("invalid_state")
    return claims


# --- Comptes -------------------------------------------------------------------------------------


def _display_name(identity: Identity) -> str:
    if identity.name and identity.name.strip():
        return identity.name.strip()[:80]
    if identity.email:
        return identity.email.split("@", 1)[0][:80] or "Parlo"
    return "Parlo"


def find_or_create_user(db: Session, identity: Identity, pack: Pack | None, locale: str = "fr") -> User:
    sub_column = User.apple_sub if identity.provider == "apple" else User.google_sub
    user = db.scalar(select(User).where(sub_column == identity.subject))
    if user is not None:
        return user
    now = datetime.now(UTC)
    if identity.email and identity.email_verified:
        user = db.scalar(select(User).where(User.email == identity.email))
        if user is not None:
            # Même adresse vérifiée par le fournisseur : le compte existant est lié.
            setattr(user, "apple_sub" if identity.provider == "apple" else "google_sub", identity.subject)
            if user.email_verified_at is None:
                user.email_verified_at = now
            return user
    elif identity.email and db.scalar(select(User.id).where(User.email == identity.email)) is not None:
        raise OAuthError("email_in_use")
    user = User(
        email=identity.email,
        password_hash=None,
        display_name=_display_name(identity),
        locale=locale,
        is_guest=False,
        email_verified_at=now if identity.email and identity.email_verified else None,
    )
    setattr(user, "apple_sub" if identity.provider == "apple" else "google_sub", identity.subject)
    db.add(user)
    db.flush()
    create_learner(db, user, pack)
    return user
