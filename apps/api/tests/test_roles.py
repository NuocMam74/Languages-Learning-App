"""Rôles (contrat Phase 4 §0) : `/me`, `PUT /admin/users/{id}/roles`, `require_roles`, CLI grant-role."""

from fastapi.testclient import TestClient

from app.maintenance import change_role
from tests.conftest import grant_roles, register, user_id_of


def test_me_roles_default_learner(client: TestClient, auth: dict[str, str]) -> None:
    assert client.get("/me", headers=auth).json()["roles"] == ["learner"]


def test_admin_sets_roles(client: TestClient) -> None:
    admin = register(client)
    grant_roles(client, admin, "admin")
    target = register(client)
    target_id = user_id_of(client, target)

    assert client.put(f"/admin/users/{target_id}/roles", headers=target, json={"roles": ["admin"]}).status_code == 403
    res = client.put(f"/admin/users/{target_id}/roles", headers=admin, json={"roles": ["teacher", "learner", "editor"]})
    assert res.status_code == 200, res.text
    assert res.json() == {"id": target_id, "displayName": "Lan", "roles": ["learner", "editor", "teacher"]}
    assert "email" not in res.json()
    assert client.get("/me", headers=target).json()["roles"] == ["learner", "editor", "teacher"]

    assert client.put(f"/admin/users/{target_id}/roles", headers=admin, json={"roles": ["root"]}).status_code == 422
    assert client.put("/admin/users/nope/roles", headers=admin, json={"roles": []}).status_code == 404
    assert client.put(f"/admin/users/{target_id}/roles", json={"roles": []}).status_code == 401


def test_require_roles_on_studio_and_classes(client: TestClient) -> None:
    learner = register(client)
    assert client.get("/studio/packs", headers=learner).status_code == 403
    assert client.post("/classes", headers=learner, json={"name": "6e B", "packCode": "vi-south"}).status_code == 403
    grant_roles(client, learner, "reviewer")
    assert client.get("/studio/packs", headers=learner).status_code == 200
    # admin passe partout
    grant_roles(client, learner, "admin")
    assert client.post("/classes", headers=learner, json={"name": "6e B", "packCode": "vi-south"}).status_code == 201


def test_cli_grant_and_revoke_role(client: TestClient) -> None:
    headers = register(client, "prof@example.com")
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    assert "teacher" in change_role(factory, "Prof@Example.com", "teacher", grant=True)
    assert client.get("/me", headers=headers).json()["roles"] == ["learner", "teacher"]
    change_role(factory, "prof@example.com", "teacher", grant=False)
    assert client.get("/me", headers=headers).json()["roles"] == ["learner"]
    for email, role in (("nobody@example.com", "teacher"), ("prof@example.com", "wizard")):
        try:
            change_role(factory, email, role, grant=True)
        except ValueError:
            continue
        raise AssertionError("ValueError attendue")
