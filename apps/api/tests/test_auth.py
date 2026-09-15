"""Inscription, connexion, rotation du refresh, déconnexion, limitation de débit."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.db import Base
from app.main import create_app
from app.models import RefreshToken
from app.services.auth import hash_token
from tests.conftest import PASSWORD, register

COOKIE = "parlo_refresh"


def test_register_returns_access_token_and_secure_refresh_cookie(client: TestClient) -> None:
    res = client.post(
        "/auth/register",
        json={"email": "Lan@Example.com", "password": PASSWORD, "displayName": "Lan", "locale": "en"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["tokenType"] == "bearer"
    assert body["expiresIn"] == 900
    set_cookie = res.headers["set-cookie"]
    assert f"{COOKIE}=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "samesite=lax" in set_cookie.lower()
    assert "Path=/auth" in set_cookie

    me = client.get("/me", headers={"Authorization": f"Bearer {body['accessToken']}"}).json()
    assert me["user"]["email"] == "lan@example.com"
    assert me["user"]["locale"] == "en"


def test_register_validation_and_duplicate(client: TestClient) -> None:
    short = client.post(
        "/auth/register", json={"email": "a@example.com", "password": "short", "displayName": "A", "locale": "fr"}
    )
    assert short.status_code == 422
    bad_locale = client.post(
        "/auth/register", json={"email": "a@example.com", "password": PASSWORD, "displayName": "A", "locale": "de"}
    )
    assert bad_locale.status_code == 422
    register(client, "dup@example.com")
    dup = client.post(
        "/auth/register", json={"email": "DUP@example.com", "password": PASSWORD, "displayName": "B", "locale": "fr"}
    )
    assert dup.status_code == 409


def test_login(client: TestClient) -> None:
    register(client, "login@example.com")
    client.cookies.clear()
    wrong = client.post("/auth/login", json={"email": "login@example.com", "password": "wrong-password"})
    assert wrong.status_code == 401
    unknown = client.post("/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})
    assert unknown.status_code == 401
    ok = client.post("/auth/login", json={"email": "login@example.com", "password": PASSWORD})
    assert ok.status_code == 200
    assert ok.json()["accessToken"]
    assert client.cookies.get(COOKIE)


def test_refresh_rotates_and_detects_reuse(client: TestClient) -> None:
    register(client)
    first = client.cookies.get(COOKIE)
    assert first

    res = client.post("/auth/refresh")
    assert res.status_code == 200
    second = client.cookies.get(COOKIE)
    assert second and second != first
    assert client.get("/me", headers={"Authorization": f"Bearer {res.json()['accessToken']}"}).status_code == 200

    # Rejouer l'ancien jeton hors de la fenêtre de grâce : refusé, toute la famille de jetons est révoquée.
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(first)))
        assert row is not None and row.revoked_at is not None
        row.revoked_at -= timedelta(minutes=5)
        db.commit()
    client.cookies.clear()
    client.cookies.set(COOKIE, first, domain="testserver.local", path="/auth")
    assert client.post("/auth/refresh").status_code == 401
    client.cookies.clear()
    client.cookies.set(COOKIE, second, domain="testserver.local", path="/auth")
    assert client.post("/auth/refresh").status_code == 401


def test_refresh_without_cookie(client: TestClient) -> None:
    assert client.post("/auth/refresh").status_code == 401


def test_logout_revokes_refresh_token(client: TestClient) -> None:
    register(client)
    token = client.cookies.get(COOKIE)
    assert token
    res = client.post("/auth/logout")
    assert res.status_code == 204
    assert not client.cookies.get(COOKIE)
    client.cookies.set(COOKIE, token, domain="testserver.local", path="/auth")
    assert client.post("/auth/refresh").status_code == 401


def test_oauth_unconfigured_providers_are_hidden(client: TestClient) -> None:
    assert client.get("/auth/oauth/providers").json() == []
    assert client.get("/auth/oauth/google/start", follow_redirects=False).status_code == 404
    assert client.get("/auth/oauth/apple/callback", follow_redirects=False).status_code == 404


def test_me_requires_auth(client: TestClient) -> None:
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401
    assert client.post("/me/events", json={"events": []}).status_code == 401
    assert client.get("/me/session/next").status_code == 401
    assert client.get("/me/srs/due").status_code == 401
    assert client.patch("/me/profile", json={}).status_code == 401


def test_auth_rate_limit(settings: Settings) -> None:
    app = create_app(settings.model_copy(update={"auth_rate_limit": 3}))
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, base_url="https://testserver") as c:
        codes = [
            c.post("/auth/login", json={"email": "x@example.com", "password": "whatever"}).status_code for _ in range(4)
        ]
    app.state.engine.dispose()
    assert codes == [401, 401, 401, 429]


def test_refresh_cookie_path_behind_root_path(settings: Settings) -> None:
    """Derrière un proxy `/api` (ROOT_PATH=/api), le cookie est posé sur /api/auth et renvoyé par le navigateur."""
    settings.root_path = "/api"
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, base_url="https://testserver/api") as c:
        res = c.post(
            "/auth/register",
            json={"email": "proxy@example.com", "password": PASSWORD, "displayName": "Lan", "locale": "fr"},
        )
        assert res.status_code == 201
        set_cookie = res.headers["set-cookie"]
        assert "Path=/api/auth" in set_cookie
        assert "HttpOnly" in set_cookie
        refreshed = c.post("/auth/refresh")  # https://testserver/api/auth/refresh : cookie envoyé
        assert refreshed.status_code == 200
        assert c.get("/me", headers={"Authorization": f"Bearer {refreshed.json()['accessToken']}"}).status_code == 200
        assert c.post("/auth/logout").status_code == 204
    app.state.engine.dispose()
