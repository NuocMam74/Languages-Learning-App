"""Comptes (contrat parcours §4) : mot de passe oublié, vérification de l'e-mail, grâce du refresh, sécurité,
OAuth Google/Apple (fournisseurs simulés), export RGPD et suppression du compte."""

import json
import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import DEFAULT_JWT_SECRET, InsecureConfigurationError, Settings
from app.db import Base
from app.main import create_app
from app.models import AuthToken, Certificate, ProcessedEvent, RefreshToken, User
from app.services import auth as auth_service
from app.services.email import ConsoleEmailSender
from app.services.oauth import OAuthClient
from app.services.rate_limit import InMemorySlidingWindow, client_ip, parse_networks
from tests.conftest import PASSWORD, event, register
from tests.test_events import post, session_completed

COOKIE = "parlo_refresh"


def outbox(client: TestClient) -> ConsoleEmailSender:
    sender = client.app.state.email_sender  # type: ignore[attr-defined]
    assert isinstance(sender, ConsoleEmailSender)
    return sender


def token_from(text: str, path: str) -> str:
    match = re.search(rf"https://parlo\.test{re.escape(path)}\?token=([A-Za-z0-9_\-%]+)", text)
    assert match, text
    return match.group(1)


def login(client: TestClient, email: str, password: str = PASSWORD) -> httpx.Response:
    return client.post("/auth/login", json={"email": email, "password": password})


def bearer(res: httpx.Response) -> dict[str, str]:
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


# --- Mot de passe oublié -----------------------------------------------------------------------


def test_password_forgot_and_reset_flow(client: TestClient) -> None:
    register(client, "reset@example.com")
    old_refresh = client.cookies.get(COOKIE)
    mails = outbox(client)
    mails.outbox.clear()

    # Toujours 204, y compris pour une adresse inconnue (pas d'énumération).
    assert client.post("/auth/password/forgot", json={"email": "nobody@example.com"}).status_code == 204
    assert mails.outbox == []
    assert client.post("/auth/password/forgot", json={"email": "RESET@example.com"}).status_code == 204
    [mail] = mails.outbox
    assert mail.to == "reset@example.com"
    token = token_from(mail.text, "/compte/reinitialiser")

    assert (
        client.post("/auth/password/reset", json={"token": "x" * 20, "password": "new-password-123"}).status_code == 400
    )
    assert client.post("/auth/password/reset", json={"token": token, "password": "short"}).status_code == 422
    res = client.post("/auth/password/reset", json={"token": token, "password": "new-password-123"})
    assert res.status_code == 204
    # Usage unique.
    assert (
        client.post("/auth/password/reset", json={"token": token, "password": "other-password-123"}).status_code == 400
    )

    client.cookies.clear()
    assert login(client, "reset@example.com").status_code == 401
    ok = login(client, "reset@example.com", "new-password-123")
    assert ok.status_code == 200
    # Sessions révoquées : l'ancien refresh ne fonctionne plus.
    client.cookies.clear()
    client.cookies.set(COOKIE, old_refresh, domain="testserver.local", path="/auth")  # type: ignore[arg-type]
    assert client.post("/auth/refresh").status_code == 401
    # Le lien reçu prouve la possession de l'adresse.
    assert client.get("/me", headers=bearer(ok)).json()["user"]["emailVerified"] is True


def test_reset_token_expires_after_one_hour(client: TestClient) -> None:
    register(client, "late@example.com")
    outbox(client).outbox.clear()
    client.post("/auth/password/forgot", json={"email": "late@example.com"})
    token = token_from(outbox(client).outbox[-1].text, "/compte/reinitialiser")
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.scalar(select(AuthToken).where(AuthToken.token_hash == auth_service.hash_token(token)))
        assert row is not None
        assert row.expires_at - row.created_at == timedelta(hours=1)
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert client.post("/auth/password/reset", json={"token": token, "password": "new-password-123"}).status_code == 400


def test_email_verification_and_resend(client: TestClient) -> None:
    mails = outbox(client)
    mails.outbox.clear()
    headers = register(client, "verify@example.com")
    [welcome] = mails.outbox
    assert client.get("/me", headers=headers).json()["user"]["emailVerified"] is False

    assert client.post("/auth/email/resend").status_code == 401
    assert client.post("/auth/email/resend", headers=headers).status_code == 204
    assert len(mails.outbox) == 2
    # Le renvoi invalide le lien précédent.
    first = token_from(welcome.text, "/compte/verifier")
    assert client.post("/auth/email/verify", json={"token": first}).status_code == 400
    second = token_from(mails.outbox[-1].text, "/compte/verifier")
    assert client.post("/auth/email/verify", json={"token": second}).status_code == 204
    assert client.get("/me", headers=headers).json()["user"]["emailVerified"] is True
    # Déjà vérifié : pas de nouvel e-mail.
    assert client.post("/auth/email/resend", headers=headers).status_code == 204
    assert len(mails.outbox) == 2


# --- Refresh : fenêtre de grâce ---------------------------------------------------------------


def _set_refresh(client: TestClient, token: str) -> None:
    client.cookies.clear()
    client.cookies.set(COOKIE, token, domain="testserver.local", path="/auth")


def test_refresh_grace_window_returns_same_token(client: TestClient) -> None:
    register(client)
    first = client.cookies.get(COOKIE)
    assert first
    rotated = client.post("/auth/refresh")
    assert rotated.status_code == 200
    second = client.cookies.get(COOKIE)

    # Deux onglets : l'ancien jeton rejoué dans les 30 s renvoie le même nouveau jeton, sans révocation.
    _set_refresh(client, first)
    replay = client.post("/auth/refresh")
    assert replay.status_code == 200
    assert client.cookies.get(COOKIE) == second
    _set_refresh(client, second)
    third = client.post("/auth/refresh")
    assert third.status_code == 200


def test_refresh_reuse_after_grace_revokes_family(client: TestClient) -> None:
    register(client)
    first = client.cookies.get(COOKIE)
    assert client.post("/auth/refresh").status_code == 200
    second = client.cookies.get(COOKIE)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == auth_service.hash_token(first)))  # type: ignore[arg-type]
        assert row is not None and row.revoked_at is not None and row.replaced_by_id is not None
        row.revoked_at -= timedelta(seconds=31)
        db.commit()
    _set_refresh(client, first)  # type: ignore[arg-type]
    assert client.post("/auth/refresh").status_code == 401
    _set_refresh(client, second)  # type: ignore[arg-type]
    assert client.post("/auth/refresh").status_code == 401


# --- Sécurité : secret JWT de production, IP réelle derrière proxy -------------------------------


def test_production_refuses_default_or_short_jwt_secret(settings: Settings) -> None:
    for secret in (DEFAULT_JWT_SECRET, "short-secret"):
        with pytest.raises(InsecureConfigurationError):
            create_app(settings.model_copy(update={"env": "production", "jwt_secret": secret}))
    app = create_app(settings.model_copy(update={"env": "production", "jwt_secret": "p" * 40}))
    app.state.engine.dispose()
    # Hors production, le secret de développement reste accepté.
    create_app(settings.model_copy(update={"jwt_secret": DEFAULT_JWT_SECRET})).state.engine.dispose()


def test_client_ip_from_trusted_proxy_only() -> None:
    trusted = parse_networks(["10.0.0.0/8", "127.0.0.1", "not-an-ip"])
    assert client_ip("10.1.2.3", "203.0.113.9, 10.0.0.7", trusted) == "203.0.113.9"
    assert client_ip("198.51.100.1", "203.0.113.9", trusted) == "198.51.100.1"  # proxy non fiable : ignoré
    assert client_ip("10.1.2.3", None, trusted) == "10.1.2.3"
    assert client_ip("10.1.2.3", "spoofed, 203.0.113.9", trusted) == "203.0.113.9"
    assert client_ip("10.1.2.3", "203.0.113.9", []) == "10.1.2.3"


def test_rate_limit_per_real_client_ip_behind_proxy(settings: Settings) -> None:
    app = create_app(settings.model_copy(update={"auth_rate_limit": 2, "trusted_proxies": "10.0.0.0/8"}))
    Base.metadata.create_all(app.state.engine)
    body = {"email": "x@example.com", "password": "whatever"}
    # Connexion directe depuis le proxy de confiance 10.0.0.5.
    with TestClient(app, base_url="https://testserver", client=("10.0.0.5", 50000)) as c:
        a = [c.post("/auth/login", json=body, headers={"X-Forwarded-For": "203.0.113.1"}).status_code for _ in range(3)]
        b = c.post("/auth/login", json=body, headers={"X-Forwarded-For": "203.0.113.2"}).status_code
    app.state.engine.dispose()
    assert a == [401, 401, 429]
    assert b == 401  # autre client réel derrière le même proxy : non bloqué


def test_rate_limiter_evicts_idle_keys() -> None:
    now = [0.0]
    limiter = InMemorySlidingWindow(5, 10, clock=lambda: now[0], max_keys=3)
    for key in "abc":
        assert limiter.hit(key)
    now[0] = 20.0
    assert limiter.hit("d")
    assert len(limiter) == 1


# --- OAuth (fournisseurs simulés) ------------------------------------------------------------------


class FakeProvider:
    """IdP OIDC simulé : découverte, jeton, JWKS ; id_token signé RS256 (Google) ou ES256 (Apple)."""

    def __init__(self, client_id: str, issuer: str, alg: str) -> None:
        self.client_id = client_id
        self.issuer = issuer
        self.alg = alg
        if alg == "RS256":
            self.key: Any = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            self.jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        else:
            self.key = ec.generate_private_key(ec.SECP256R1())
            self.jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(self.key.public_key()))
        self.jwk |= {"kid": "k1", "alg": alg, "use": "sig"}
        self.claims: dict[str, Any] = {}
        self.nonce = ""
        self.token_forms: list[dict[str, list[str]]] = []

    def id_token(self) -> str:
        now = datetime.now(UTC)
        claims = {
            "iss": self.issuer,
            "aud": self.client_id,
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "nonce": self.nonce,
        } | self.claims
        return jwt.encode(claims, self.key, algorithm=self.alg, headers={"kid": "k1"})


def make_transport(google: FakeProvider, apple: FakeProvider | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == "https://accounts.google.test/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    "issuer": google.issuer,
                    "authorization_endpoint": "https://accounts.google.test/o/oauth2/v2/auth",
                    "token_endpoint": "https://oauth2.google.test/token",
                    "jwks_uri": "https://www.google.test/oauth2/v3/certs",
                },
            )
        if url == "https://oauth2.google.test/token":
            google.token_forms.append(parse_qs(request.content.decode()))
            return httpx.Response(200, json={"id_token": google.id_token(), "access_token": "at"})
        if url == "https://www.google.test/oauth2/v3/certs":
            return httpx.Response(200, json={"keys": [google.jwk]})
        if apple is not None and url == "https://appleid.apple.com/auth/token":
            apple.token_forms.append(parse_qs(request.content.decode()))
            return httpx.Response(200, json={"id_token": apple.id_token()})
        if apple is not None and url == "https://appleid.apple.com/auth/keys":
            return httpx.Response(200, json={"keys": [apple.jwk]})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.fixture
def providers() -> tuple[FakeProvider, FakeProvider]:
    return (
        FakeProvider("google-client", "https://accounts.google.com", "RS256"),
        FakeProvider("app.parlo.web", "https://appleid.apple.com", "ES256"),
    )


@pytest.fixture
def oauth_client(settings: Settings, providers: tuple[FakeProvider, FakeProvider]) -> Iterator[TestClient]:
    apple_key = ec.generate_private_key(ec.SECP256R1())
    pem = apple_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    oauth_settings = settings.model_copy(
        update={
            "google_client_id": "google-client",
            "google_client_secret": "google-secret",
            "google_discovery_url": "https://accounts.google.test/.well-known/openid-configuration",
            "apple_client_id": "app.parlo.web",
            "apple_team_id": "TEAM123",
            "apple_key_id": "KEY123",
            "apple_private_key": pem.decode().replace("\n", "\\n"),
            "public_api_url": "https://api.parlo.test",
        }
    )
    app = create_app(oauth_settings)
    app.state.oauth_client = OAuthClient(oauth_settings, httpx.Client(transport=make_transport(*providers)))
    app.state.apple_public_key = apple_key.public_key()
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, base_url="https://testserver") as c:
        yield c
    app.state.engine.dispose()


def _start(client: TestClient, provider: str, next_path: str) -> dict[str, str]:
    res = client.get(f"/auth/oauth/{provider}/start", params={"next": next_path}, follow_redirects=False)
    assert res.status_code == 302, res.text
    query = parse_qs(urlparse(res.headers["location"]).query)
    return {k: v[0] for k, v in query.items()}


def test_oauth_providers_only_when_configured(client: TestClient, oauth_client: TestClient) -> None:
    assert client.get("/auth/oauth/providers").json() == []
    assert client.get("/auth/oauth/google/start", follow_redirects=False).status_code == 404
    assert oauth_client.get("/auth/oauth/providers").json() == [
        {"id": "google", "name": "Google"},
        {"id": "apple", "name": "Apple"},
    ]


def test_oauth_google_flow_creates_then_reuses_account(
    oauth_client: TestClient, providers: tuple[FakeProvider, FakeProvider]
) -> None:
    google, _ = providers
    params = _start(oauth_client, "google", "/lecon/vi-south.u01.l02")
    assert params["client_id"] == "google-client"
    assert params["redirect_uri"] == "https://api.parlo.test/auth/oauth/google/callback"
    assert params["scope"] == "openid email profile"
    google.nonce = params["nonce"]
    google.claims = {"sub": "g-123", "email": "Mai@Example.com", "email_verified": True, "name": "Mai Nguyễn"}

    res = oauth_client.get(
        "/auth/oauth/google/callback", params={"code": "code-1", "state": params["state"]}, follow_redirects=False
    )
    assert res.status_code == 302
    assert res.headers["location"] == "https://parlo.test/compte?oauth=ok&next=%2Flecon%2Fvi-south.u01.l02"
    assert google.token_forms[0]["code"] == ["code-1"]
    assert google.token_forms[0]["client_secret"] == ["google-secret"]
    refreshed = oauth_client.post("/auth/refresh")
    assert refreshed.status_code == 200
    me = oauth_client.get("/me", headers=bearer(refreshed)).json()
    assert (me["user"]["email"], me["user"]["displayName"], me["user"]["emailVerified"]) == (
        "mai@example.com",
        "Mai Nguyễn",
        True,
    )
    assert me["enrollment"]["courseCode"] == "vi-south"

    # Deuxième connexion : même compte (lié par `sub`).
    params = _start(oauth_client, "google", "/")
    google.nonce = params["nonce"]
    oauth_client.get(
        "/auth/oauth/google/callback", params={"code": "c2", "state": params["state"]}, follow_redirects=False
    )
    with oauth_client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        assert db.scalar(select(func.count()).select_from(User)) == 1


def test_oauth_links_existing_verified_email_and_rejects_bad_state(
    oauth_client: TestClient, providers: tuple[FakeProvider, FakeProvider]
) -> None:
    google, _ = providers
    register(oauth_client, "lan@example.com")
    oauth_client.cookies.clear()
    params = _start(oauth_client, "google", "//evil.example")
    google.nonce = params["nonce"]
    google.claims = {"sub": "g-lan", "email": "lan@example.com", "email_verified": True}
    res = oauth_client.get(
        "/auth/oauth/google/callback", params={"code": "c", "state": params["state"]}, follow_redirects=False
    )
    assert res.headers["location"] == "https://parlo.test/compte?oauth=ok&next=%2F"  # pas de redirection ouverte
    with oauth_client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        user = db.scalar(select(User).where(User.email == "lan@example.com"))
        assert user is not None and user.google_sub == "g-lan"

    # État falsifié, nonce faux, cookie de liaison absent : erreur, aucun cookie de session.
    params = _start(oauth_client, "google", "/")
    google.nonce = "wrong"
    bad_nonce = oauth_client.get(
        "/auth/oauth/google/callback", params={"code": "c", "state": params["state"]}, follow_redirects=False
    )
    assert "oauth=error" in bad_nonce.headers["location"] and "invalid_nonce" in bad_nonce.headers["location"]
    forged = oauth_client.get(
        "/auth/oauth/google/callback", params={"code": "c", "state": "forged"}, follow_redirects=False
    )
    assert "reason=invalid_state" in forged.headers["location"]
    params = _start(oauth_client, "google", "/")
    oauth_client.cookies.delete("parlo_oauth", domain="testserver.local", path="/auth/oauth")
    unbound = oauth_client.get(
        "/auth/oauth/google/callback", params={"code": "c", "state": params["state"]}, follow_redirects=False
    )
    assert "reason=invalid_state" in unbound.headers["location"]
    assert COOKIE not in unbound.headers.get("set-cookie", "")


def test_oauth_apple_form_post_flow(oauth_client: TestClient, providers: tuple[FakeProvider, FakeProvider]) -> None:
    _, apple = providers
    params = _start(oauth_client, "apple", "/")
    assert params["response_mode"] == "form_post"
    apple.nonce = params["nonce"]
    apple.claims = {"sub": "a-1", "email": "hidden@privaterelay.appleid.com", "email_verified": "true"}
    res = oauth_client.post(
        "/auth/oauth/apple/callback",
        data={
            "code": "apple-code",
            "state": params["state"],
            "user": json.dumps({"name": {"firstName": "Tuấn", "lastName": "Lê"}}),
        },
        follow_redirects=False,
    )
    assert res.headers["location"].startswith("https://parlo.test/compte?oauth=ok")
    # client_secret Apple : JWT ES256 signé avec la clé de l'équipe.
    secret = apple.token_forms[0]["client_secret"][0]
    claims = jwt.decode(
        secret,
        oauth_client.app.state.apple_public_key,  # type: ignore[attr-defined]
        algorithms=["ES256"],
        audience="https://appleid.apple.com",
    )
    assert (claims["iss"], claims["sub"]) == ("TEAM123", "app.parlo.web")
    assert jwt.get_unverified_header(secret)["kid"] == "KEY123"
    refreshed = oauth_client.post("/auth/refresh")
    me = oauth_client.get("/me", headers=bearer(refreshed)).json()
    assert me["user"]["displayName"] == "Tuấn Lê"


# --- RGPD ----------------------------------------------------------------------------------------


def test_export_contains_all_learning_data(client: TestClient, auth: dict[str, str]) -> None:
    today = datetime.now(UTC).date().isoformat()
    post(
        client,
        auth,
        [
            event("lesson_completed", {"sessionId": "s1", "lessonId": "vi-south.u01.l01", "score": 1, "durationMs": 1}),
            session_completed("s1", today),
        ],
    )
    res = client.get("/me/export", headers=auth)
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    data = res.json()
    assert data["user"]["email"].endswith("@example.com")
    assert "password_hash" not in json.dumps(data)
    for key in ("profile", "events", "lessonProgress", "srsCards", "conversations", "certificates", "sessions"):
        assert key in data
    assert [p["lesson_id"] for p in data["lessonProgress"]] == ["vi-south.u01.l01"]
    assert len(data["events"]) == 2


def test_delete_account_with_password(client: TestClient) -> None:
    headers = register(client, "bye@example.com")
    user_id = client.get("/me", headers=headers).json()["user"]["id"]
    post(client, headers, [session_completed("s1", datetime.now(UTC).date().isoformat())])
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        db.add(Certificate(user_id=user_id, level="A0", verification_code="ABCDEFGH12", course_id="vi-south"))
        db.commit()

    assert client.request("DELETE", "/me", headers=headers, json={"password": "wrong-password"}).status_code == 403
    assert client.request("DELETE", "/me", headers=headers, json={}).status_code == 403
    res = client.request("DELETE", "/me", headers=headers, json={"password": PASSWORD})
    assert res.status_code == 204
    assert f"{COOKIE}=" in res.headers["set-cookie"]
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        assert db.get(User, user_id) is None
        assert db.scalar(select(func.count()).select_from(ProcessedEvent)) == 0
        assert db.scalar(select(func.count()).select_from(Certificate)) == 0
        assert db.scalar(select(func.count()).select_from(RefreshToken)) == 0
    assert client.get("/me", headers=headers).status_code == 401
    assert login(client, "bye@example.com").status_code == 401


def test_delete_oauth_account_requires_confirmation(client: TestClient) -> None:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        user = User(email=None, password_hash=None, display_name="OAuth", google_sub=str(uuid.uuid4()))
        db.add(user)
        db.commit()
        user_id = user.id
    headers = {"Authorization": f"Bearer {auth_service.create_access_token(client.app.state.settings, user_id)}"}  # type: ignore[attr-defined]
    assert client.request("DELETE", "/me", headers=headers, json={"confirm": "oui"}).status_code == 422
    assert client.request("DELETE", "/me", headers=headers, json={"confirm": "SUPPRIMER"}).status_code == 204
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        assert db.get(User, user_id) is None
