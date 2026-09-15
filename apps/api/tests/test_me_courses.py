"""`/me`, `/me/profile`, `/courses`, manifeste et `/healthz`."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.seed import DEMO_EMAIL, DEMO_PASSWORD, seed


def test_healthz(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}


def test_me_fresh_user(client: TestClient, auth: dict[str, str]) -> None:
    me = client.get("/me", headers=auth).json()
    assert me["profile"] == {
        "motivation": None,
        "dailyGoalMin": 10,
        "reminderHour": None,
        "levelEstimate": None,
        "pathVariant": None,
        "leaguesEnabled": True,
        "timezone": None,
        "notificationsEnabled": False,
    }
    assert me["enrollment"]["courseCode"] == "vi-south"
    assert me["enrollment"]["xpTotal"] == 0
    assert me["enrollment"]["level"] == 1
    assert me["enrollment"]["currentLessonId"] == "vi-south.u01.l01"
    assert me["streak"] == {
        "current": 0,
        "longest": 0,
        "lastActiveDate": None,
        "freezesAvailable": 0,
        "frozenUntil": None,
    }


def test_patch_profile(client: TestClient, auth: dict[str, str]) -> None:
    res = client.patch("/me/profile", headers=auth, json={"motivation": "family", "dailyGoalMin": 5, "reminderHour": 8})
    assert res.status_code == 200
    body = res.json()
    assert body["motivation"] == "family"
    assert body["dailyGoalMin"] == 5
    assert body["reminderHour"] == 8
    assert body["leaguesEnabled"] is False  # spec §5.3

    res = client.patch("/me/profile", headers=auth, json={"leaguesEnabled": True, "reminderHour": None})
    assert res.json()["leaguesEnabled"] is True
    assert res.json()["reminderHour"] is None

    assert client.patch("/me/profile", headers=auth, json={"motivation": "travel"}).json()["leaguesEnabled"] is True
    assert client.patch("/me/profile", headers=auth, json={"pathVariant": "family"}).json()["pathVariant"] == "family"


def test_patch_profile_validation(client: TestClient, auth: dict[str, str]) -> None:
    assert client.patch("/me/profile", headers=auth, json={"dailyGoalMin": 7}).status_code == 422
    assert client.patch("/me/profile", headers=auth, json={"reminderHour": 24}).status_code == 422
    assert client.patch("/me/profile", headers=auth, json={"motivation": "money"}).status_code == 422
    assert client.patch("/me/profile", headers=auth, json={"pathVariant": "nope"}).status_code == 422
    assert client.patch("/me/profile", headers=auth, json={"unknown": 1}).status_code == 422
    assert client.patch("/me/profile", headers=auth, json={"timezone": "Mars/Olympus"}).status_code == 422
    assert client.patch("/me/profile", headers=auth, json={"notificationsEnabled": None}).status_code == 422


def test_patch_profile_timezone_and_notifications(client: TestClient, auth: dict[str, str]) -> None:
    body = client.patch(
        "/me/profile", headers=auth, json={"timezone": "Asia/Ho_Chi_Minh", "notificationsEnabled": True}
    ).json()
    assert (body["timezone"], body["notificationsEnabled"]) == ("Asia/Ho_Chi_Minh", True)
    profile = client.get("/me", headers=auth).json()["profile"]
    assert (profile["timezone"], profile["notificationsEnabled"]) == ("Asia/Ho_Chi_Minh", True)
    assert client.patch("/me/profile", headers=auth, json={"timezone": None}).json()["timezone"] is None


def test_courses_and_manifest(client: TestClient) -> None:
    courses = client.get("/courses").json()
    vi = next(c for c in courses if c["code"] == "vi-south")
    assert vi["version"] == 1
    assert vi["name"]["fr"] == "Vietnamien du Sud"

    manifest = client.get("/courses/vi-south/manifest").json()
    assert manifest["code"] == "vi-south"
    assert manifest["baseUrl"] == "/content/vi-south/v1/"
    assert "pack.json" in manifest["files"]
    assert "lessons/u01/l01.json" in manifest["files"]

    served = client.get(manifest["baseUrl"] + "lessons/u01/l01.json")
    assert served.status_code == 200
    assert served.json()["id"] == "vi-south.u01.l01"

    assert client.get("/courses/xx/manifest").status_code == 404


def test_seed_creates_demo_user_who_can_log_in(client: TestClient, settings: Settings) -> None:
    assert seed(settings) is True
    assert seed(settings) is False  # idempotent
    res = client.post("/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert res.status_code == 200, res.text
    me = client.get("/me", headers={"Authorization": f"Bearer {res.json()['accessToken']}"}).json()
    assert me["enrollment"]["courseCode"] == "vi-south"
    assert me["profile"]["motivation"] == "travel"
