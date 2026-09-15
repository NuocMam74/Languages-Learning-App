"""Fixtures : application sur une base SQLite temporaire, contenu réel du dépôt."""

import shutil
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
# Pack copié en dossier temporaire pour les tests du studio (petit, écrit par la publication).
STUDIO_PACK = "es"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        jwt_secret="test-secret-test-secret-test-secret-32b",
        content_dir=REPO_ROOT / "content",
        cors_origins="http://localhost:5173",
        auth_rate_limit=1000,
        # Jamais de réseau en test : pas de clé, le modèle est remplacé par un double (tests/test_tutor.py).
        anthropic_api_key=None,
        tutor_rate_limit=1000,
        root_path="",
        media_dir=tmp_path / "media",
        storage_backend="local",
        # Rendu pur Python partout (WeasyPrint exige Pango, absent sous Windows) ; WeasyPrint testé à part.
        pdf_renderer="fpdf2",
        public_web_url="https://parlo.test",
        scheduler_enabled=False,
        vapid_public_key=None,
        vapid_private_key=None,
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


def user_id_of(client: TestClient, headers: dict[str, str]) -> str:
    res = client.get("/me", headers=headers)
    assert res.status_code == 200, res.text
    user_id: str = res.json()["user"]["id"]
    return user_id


def grant_roles(client: TestClient, headers: dict[str, str], *roles: str) -> str:
    """Attribue des rôles directement en base (contrat Phase 4 §0) ; renvoie l'id de l'utilisateur."""
    from app.models import User

    user_id = user_id_of(client, headers)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        user = db.get(User, user_id)
        assert user is not None
        user.roles = list(roles)
        db.commit()
    return user_id


# --- Studio (Phase 4) : contenu temporaire ---------------------------------------------------


@pytest.fixture
def content_dir(tmp_path: Path) -> Path:
    root = tmp_path / "content"
    shutil.copytree(REPO_ROOT / "content" / "schema", root / "schema")
    shutil.copytree(REPO_ROOT / "content" / STUDIO_PACK, root / STUDIO_PACK)
    return root


@pytest.fixture
def studio_settings(settings: Settings, content_dir: Path, tmp_path: Path) -> Settings:
    return settings.model_copy(
        update={
            "content_dir": content_dir,
            "studio_media_dir": tmp_path / "studio-media",
            "studio_publish_enabled": True,
            "default_course": STUDIO_PACK,
        }
    )
