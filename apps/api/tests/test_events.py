"""`POST /me/events` : idempotence, rejets, fusion SRS, progression, XP et série."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import Answer, ProcessedEvent
from tests.conftest import event, register


def post(client: TestClient, auth: dict[str, str], events: list[dict[str, Any]]) -> dict[str, Any]:
    res = client.post("/me/events", headers=auth, json={"events": events})
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def answer(session_id: str = "s1") -> dict[str, Any]:
    return event(
        "answer_submitted",
        {
            "sessionId": session_id,
            "lessonId": "vi-south.u01.l01",
            "stepIndex": 1,
            "exerciseType": "tone_minimal_pair",
            "conceptIds": ["c_ma_ghost", "c_ma_mom"],
            "correct": True,
            "nearMiss": False,
            "responseMs": 2150.4,
            "attempt": 1,
        },
    )


def session_completed(session_id: str, local_date: str, xp: int = 30, when: datetime | None = None) -> dict[str, Any]:
    return event(
        "session_completed",
        {"sessionId": session_id, "xpGained": xp, "itemsCount": 8, "durationMs": 360000, "localDate": local_date},
        when,
    )


def card(reps: int, last_review: str | None, stability: float = 3.0, due: str = "2026-01-01T00:00:00.000Z") -> dict:
    return {
        "conceptId": "c_ba",
        "due": due,
        "stability": stability,
        "difficulty": 5.0,
        "scheduledDays": 1,
        "learningSteps": 0,
        "reps": reps,
        "lapses": 0,
        "state": "review",
        "lastReview": last_review,
    }


def me(client: TestClient, auth: dict[str, str]) -> dict[str, Any]:
    body: dict[str, Any] = client.get("/me", headers=auth).json()
    return body


def count(client: TestClient, model: type) -> int:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        return int(db.scalar(select(func.count()).select_from(model)) or 0)


def test_batch_is_idempotent(client: TestClient, auth: dict[str, str]) -> None:
    batch = [
        event("session_started", {"sessionId": "s1", "source": "daily", "plannedSeconds": 380}),
        answer(),
        answer(),
        session_completed("s1", "2026-09-14"),
    ]
    ids = [e["id"] for e in batch]

    first = post(client, auth, batch)
    assert sorted(first["accepted"]) == sorted(ids)
    assert first["rejected"] == []

    second = post(client, auth, batch)
    assert sorted(second["accepted"]) == sorted(ids)
    assert second["rejected"] == []

    state = me(client, auth)
    assert state["enrollment"]["xpTotal"] == 30
    assert state["streak"]["current"] == 1
    assert count(client, Answer) == 2
    assert count(client, ProcessedEvent) == 4


def test_duplicate_id_inside_one_batch_applied_once(client: TestClient, auth: dict[str, str]) -> None:
    e = session_completed("s-dup", "2026-09-14")
    result = post(client, auth, [e, e])
    assert result["accepted"] == [e["id"], e["id"]]
    assert me(client, auth)["enrollment"]["xpTotal"] == 30


def test_same_session_completed_twice_with_new_event_id_no_double_xp(client: TestClient, auth: dict[str, str]) -> None:
    post(client, auth, [session_completed("s-x", "2026-09-14")])
    post(client, auth, [session_completed("s-x", "2026-09-14")])
    assert me(client, auth)["enrollment"]["xpTotal"] == 30


def test_future_and_invalid_events_rejected(client: TestClient, auth: dict[str, str]) -> None:
    now = datetime.now(UTC)
    future = session_completed("s-f", "2026-09-20", when=now + timedelta(hours=25))
    near_future = session_completed("s-n", "2026-09-14", when=now + timedelta(hours=23))
    bad = answer()
    bad["payload"]["exerciseType"] = "not_a_type"
    wrong_version = answer()
    wrong_version["schemaVersion"] = 2
    unknown_lesson = event(
        "lesson_completed", {"sessionId": "s", "lessonId": "vi-south.u99.l01", "score": 1, "durationMs": 10}
    )

    result = post(client, auth, [future, near_future, bad, wrong_version, unknown_lesson])
    assert result["accepted"] == [near_future["id"]]
    reasons = {r["id"]: r["reason"] for r in result["rejected"]}
    assert reasons[future["id"]] == "occurred_at_in_future"
    assert reasons[bad["id"]].startswith("invalid:")
    assert reasons[wrong_version["id"]].startswith("invalid:")
    assert reasons[unknown_lesson["id"]] == "unknown_lesson"
    assert me(client, auth)["enrollment"]["xpTotal"] == 30


def test_batch_size_limit(client: TestClient, auth: dict[str, str]) -> None:
    res = client.post("/me/events", headers=auth, json={"events": [answer() for _ in range(501)]})
    assert res.status_code == 422


def test_event_id_of_another_user_is_not_applied(client: TestClient) -> None:
    alice = register(client)
    bob = register(client)
    e = session_completed("s-a", "2026-09-14")
    post(client, alice, [e])
    result = post(client, bob, [e])
    assert result["rejected"] == [{"id": e["id"], "reason": "id_conflict"}]
    assert me(client, bob)["enrollment"]["xpTotal"] == 0


def test_srs_merge_never_regresses(client: TestClient, auth: dict[str, str]) -> None:
    def due() -> list[dict[str, Any]]:
        body: list[dict[str, Any]] = client.get("/me/srs/due?limit=10", headers=auth).json()
        return body

    post(client, auth, [event("srs_card_updated", {"card": card(3, "2026-01-01T00:00:00.000Z", stability=3)})])
    assert due()[0]["reps"] == 3

    # Moins de révisions, même si plus récent : ignoré.
    post(client, auth, [event("srs_card_updated", {"card": card(2, "2026-06-01T00:00:00.000Z", stability=99)})])
    assert due()[0]["reps"] == 3
    assert due()[0]["stability"] == 3

    # Même nombre, plus ancien : ignoré. Même nombre, plus récent : appliqué.
    post(client, auth, [event("srs_card_updated", {"card": card(3, "2025-12-01T00:00:00.000Z", stability=50)})])
    assert due()[0]["stability"] == 3
    post(client, auth, [event("srs_card_updated", {"card": card(3, "2026-02-01T00:00:00.000Z", stability=4)})])
    assert due()[0]["stability"] == 4

    # Plus de révisions : appliqué ; la forme renvoyée est celle de SrsCard.
    post(client, auth, [event("srs_card_updated", {"card": card(5, "2026-03-01T00:00:00.000Z", stability=6)})])
    [stored] = due()
    assert stored["reps"] == 5
    assert set(stored) == {
        "conceptId",
        "due",
        "stability",
        "difficulty",
        "scheduledDays",
        "learningSteps",
        "reps",
        "lapses",
        "state",
        "lastReview",
    }


def test_srs_due_excludes_future_and_new_cards(client: TestClient, auth: dict[str, str]) -> None:
    future = card(1, None, due="2999-01-01T00:00:00.000Z")
    future["conceptId"] = "c_future"
    new = card(0, None)
    new["conceptId"] = "c_new"
    new["state"] = "new"
    post(client, auth, [event("srs_card_updated", {"card": c}) for c in (future, new, card(1, None))])
    assert [c["conceptId"] for c in client.get("/me/srs/due", headers=auth).json()] == ["c_ba"]


def test_lesson_completed_advances_current_lesson(client: TestClient, auth: dict[str, str]) -> None:
    def completed(score: float) -> dict[str, Any]:
        return event(
            "lesson_completed",
            {"sessionId": "s1", "lessonId": "vi-south.u01.l01", "score": score, "durationMs": 300000},
        )

    assert me(client, auth)["enrollment"]["currentLessonId"] == "vi-south.u01.l01"
    post(client, auth, [completed(0.8)])
    assert me(client, auth)["enrollment"]["currentLessonId"] == "vi-south.u01.l02"

    post(client, auth, [completed(0.5)])
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        from app.models import LessonProgress

        [progress] = db.scalars(select(LessonProgress)).all()
    assert progress.status == "completed"
    assert progress.score == 0.8  # meilleur score conservé
    assert progress.attempts == 2


def test_streak_consecutive_days_and_gap_covered_by_freeze(client: TestClient, auth: dict[str, str]) -> None:
    start = datetime(2026, 8, 1, 18, tzinfo=UTC)
    # 10 jours consécutifs → 1 protection gagnée.
    post(
        client,
        auth,
        [
            session_completed(f"d{i}", (start + timedelta(days=i)).date().isoformat(), when=start + timedelta(days=i))
            for i in range(10)
        ],
    )
    streak = me(client, auth)["streak"]
    assert streak["current"] == 10
    assert streak["freezesAvailable"] == 1
    assert streak["lastActiveDate"] == "2026-08-10"

    # Un jour manqué (11 août), séance le 12 : la protection est consommée, la série continue.
    post(client, auth, [session_completed("d12", "2026-08-12", when=datetime(2026, 8, 12, 18, tzinfo=UTC))])
    streak = me(client, auth)["streak"]
    assert streak == {
        "current": 11,
        "longest": 11,
        "lastActiveDate": "2026-08-12",
        "freezesAvailable": 0,
        "frozenUntil": None,
    }

    # Deux jours manqués sans protection : la série repart à 1.
    post(client, auth, [session_completed("d15", "2026-08-15", when=datetime(2026, 8, 15, 18, tzinfo=UTC))])
    streak = me(client, auth)["streak"]
    assert (streak["current"], streak["longest"]) == (1, 11)
    assert me(client, auth)["enrollment"]["xpTotal"] == 30 * 12


def test_events_processed_in_occurred_at_order(client: TestClient, auth: dict[str, str]) -> None:
    later = session_completed("o2", "2026-08-02", when=datetime(2026, 8, 2, tzinfo=UTC))
    earlier = session_completed("o1", "2026-08-01", when=datetime(2026, 8, 1, tzinfo=UTC))
    post(client, auth, [later, earlier])
    assert me(client, auth)["streak"]["current"] == 2


def test_answer_row_is_stored(client: TestClient, auth: dict[str, str]) -> None:
    e = answer(session_id=str(uuid.uuid4()))
    post(client, auth, [e])
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.get(Answer, e["id"])
    assert row is not None
    assert row.concept_id == "c_ma_ghost"
    assert row.concept_ids == ["c_ma_ghost", "c_ma_mom"]
    assert row.response_ms == 2150
