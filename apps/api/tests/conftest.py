"""Fixtures : application sur une base SQLite temporaire, contenu réel du dépôt."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.db import Base
from app.main import create_app

PASSWORD = "correct-horse-battery"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        jwt_secret="test-secret-test-secret-test-secret-32b",
        content_dir=REPO_ROOT / "content",
        cors_origins="http://localhost:5173",
        auth_rate_limit=1000,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    # https : le cookie de refresh est `Secure`, httpx ne le renverrait pas en http.
    with TestClient(app, base_url="https://testserver") as c:
        yield c
    app.state.engine.dispose()


def register(client: TestClient, email: str | None = None) -> dict[str, str]:
    email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
    res = client.post(
        "/auth/register",
        json={"email": email, "password": PASSWORD, "displayName": "Lan", "locale": "fr"},
    )
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


@pytest.fixture
def auth(client: TestClient) -> dict[str, str]:
    return register(client)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def event(type_: str, payload: dict[str, Any], occurred_at: datetime | None = None) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "type": type_,
        "occurredAt": iso(occurred_at or datetime.now(UTC)),
        "schemaVersion": 1,
        "payload": payload,
    }
