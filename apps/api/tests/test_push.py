"""Web Push (contrat Phase 2 §4) : abonnement, rappels horaires, gabarits non culpabilisants."""

import base64
import re
import unicodedata
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
from app.maintenance import vapid_keys
from app.models import PushSubscription
from app.services import push
from tests.test_events import post, session_completed

ENDPOINT = "https://push.example.com/send/abc"


def subscribe(client: TestClient, auth: dict[str, str], **overrides: Any) -> int:
    body = {
        "endpoint": ENDPOINT,
        "keys": {"p256dh": "BPk", "auth": "xyz"},
        "reminderHour": 19,
        "timezone": "Europe/Paris",
    } | overrides
    return client.post("/push/subscribe", headers=auth, json=body).status_code


def subscriptions(client: TestClient) -> list[PushSubscription]:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        return list(db.scalars(select(PushSubscription)))


def test_vapid_public_key(client: TestClient, settings: Settings) -> None:
    assert client.get("/push/vapid-public-key").status_code == 503
    app = create_app(settings.model_copy(update={"vapid_public_key": "BPublicKey"}))
    with TestClient(app, base_url="https://testserver") as other:
        assert other.get("/push/vapid-public-key").json() == {"key": "BPublicKey"}
    app.state.engine.dispose()


def test_subscribe_updates_profile_and_unsubscribe(client: TestClient, auth: dict[str, str]) -> None:
    assert client.post("/push/subscribe", json={}).status_code == 401
    assert subscribe(client, auth) == 204
    assert subscribe(client, auth, reminderHour=8) == 204  # même endpoint : mise à jour
    rows = subscriptions(client)
    assert [(r.reminder_hour, r.timezone, r.keys_json) for r in rows] == [
        (8, "Europe/Paris", {"p256dh": "BPk", "auth": "xyz"})
    ]
    profile = client.get("/me", headers=auth).json()["profile"]
    assert (profile["reminderHour"], profile["timezone"], profile["notificationsEnabled"]) == (8, "Europe/Paris", True)

    assert subscribe(client, auth, timezone="Nowhere/Land") == 422
    assert subscribe(client, auth, reminderHour=24) == 422
    assert subscribe(client, auth, endpoint="http://insecure") == 422

    res = client.request("DELETE", "/push/subscribe", headers=auth, json={"endpoint": ENDPOINT})
    assert res.status_code == 204
    assert subscriptions(client) == []
    assert client.request("DELETE", "/push/subscribe", headers=auth, json={"endpoint": ENDPOINT}).status_code == 204


def run_reminders(
    client: TestClient, now: datetime, statuses: list[int | None] | None = None
) -> tuple[push.ReminderReport, list[dict[str, Any]]]:
    sent: list[dict[str, Any]] = []
    queue = list(statuses or [])

    def sender(subscription: PushSubscription, data: str) -> int | None:
        sent.append({"endpoint": subscription.endpoint, "data": data})
        return queue.pop(0) if queue else None

    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        report = push.send_due_reminders(db, sender, now)
    return report, sent


def test_reminder_at_local_hour_once_a_day(client: TestClient, auth: dict[str, str]) -> None:
    subscribe(client, auth, reminderHour=19, timezone="Asia/Ho_Chi_Minh")  # UTC+7
    # 11:00 UTC = 18:00 à Saïgon : trop tôt.
    report, sent = run_reminders(client, datetime(2026, 9, 14, 11, 0, tzinfo=UTC))
    assert (report.sent, sent) == (0, [])
    report, sent = run_reminders(client, datetime(2026, 9, 14, 12, 0, tzinfo=UTC))
    assert report.sent == 1
    assert sent[0]["endpoint"] == ENDPOINT
    assert '"url": "/"' in sent[0]["data"] and '"title": "Cô Mai"' in sent[0]["data"]
    # Même heure locale relancée (tâche rejouée) : pas de doublon.
    assert run_reminders(client, datetime(2026, 9, 14, 12, 30, tzinfo=UTC))[0].sent == 0
    # Le lendemain : nouveau rappel.
    assert run_reminders(client, datetime(2026, 9, 15, 12, 0, tzinfo=UTC))[0].sent == 1


def test_no_reminder_after_session_or_when_disabled(client: TestClient, auth: dict[str, str]) -> None:
    subscribe(client, auth, reminderHour=20, timezone="Europe/Paris")  # UTC+2 en septembre
    post(client, auth, [session_completed("s1", "2026-09-14")])
    assert run_reminders(client, datetime(2026, 9, 14, 18, 0, tzinfo=UTC))[0].sent == 0
    client.patch("/me/profile", headers=auth, json={"notificationsEnabled": False})
    assert run_reminders(client, datetime(2026, 9, 15, 18, 0, tzinfo=UTC))[0].sent == 0
    client.patch("/me/profile", headers=auth, json={"notificationsEnabled": True})
    assert run_reminders(client, datetime(2026, 9, 15, 18, 0, tzinfo=UTC))[0].sent == 1


def test_expired_subscription_deleted(client: TestClient, auth: dict[str, str]) -> None:
    subscribe(client, auth, reminderHour=10, timezone="UTC")
    report, _ = run_reminders(client, datetime(2026, 9, 14, 10, 0, tzinfo=UTC), statuses=[410])
    assert (report.sent, report.deleted) == (0, 1)
    assert subscriptions(client) == []


def test_webpush_sender_maps_errors() -> None:
    from pywebpush import WebPushException

    settings = Settings(_env_file=None, vapid_private_key="k", vapid_subject="mailto:a@b.c")
    sub = PushSubscription(endpoint=ENDPOINT, keys_json={"p256dh": "p", "auth": "a"})
    sender = push.webpush_sender(settings)
    with patch("pywebpush.webpush") as webpush:
        assert sender(sub, "{}") is None
        kwargs = webpush.call_args.kwargs
        assert kwargs["subscription_info"] == {"endpoint": ENDPOINT, "keys": {"p256dh": "p", "auth": "a"}}
        assert kwargs["vapid_claims"] == {"sub": "mailto:a@b.c"}
        webpush.side_effect = WebPushException("gone", response=MagicMock(status_code=410))
        assert sender(sub, "{}") == 410


EMOJI = re.compile("[\U0001f000-\U0001faff☀-➿⌚-⏿]")


def test_templates_are_never_guilt_inducing() -> None:
    texts = [t for lang in push.TEMPLATES.values() for pool in lang.values() for t in pool]
    assert len(texts) >= 10
    for text in texts:
        lowered = unicodedata.normalize("NFC", text).lower()
        for phrase in push.FORBIDDEN_PHRASES:
            assert phrase not in lowered, (phrase, text)
        assert not EMOJI.search(text), text
        assert "!" not in text  # pas d'injonction
    for locale in ("fr", "en", "de"):
        payload = push.reminder_payload(locale, 12, datetime(2026, 9, 14).date(), "u1")
        assert payload.url == "/"
        assert payload.body
    assert "12" in push.reminder_payload("fr", 12, datetime(2026, 9, 14).date(), "u1").body


def test_vapid_keys_format() -> None:
    public, private = vapid_keys()
    assert len(base64.urlsafe_b64decode(public + "=")) == 65
    assert len(base64.urlsafe_b64decode(private + "=")) == 32
