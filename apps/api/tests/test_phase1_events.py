"""Phase 1 : `placement_completed`, `badge_earned`, `/me` (badges, niveau, objectif du jour), rejeu d'invité."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.config import REPO_ROOT
from app.services.content import load_packs
from tests.conftest import event, register
from tests.test_events import me, post, session_completed

LAST_LESSON = sorted(load_packs(REPO_ROOT / "content")["vi-south"].lessons)[-1]


def placement(entry: str = LAST_LESSON, level: int = 2) -> dict[str, Any]:
    return event(
        "placement_completed",
        {"levelEstimate": level, "entryLessonId": entry, "correct": 7, "total": 10, "knownConceptIds": ["c_ba"]},
    )


def badge(code: str, when: datetime | None = None) -> dict[str, Any]:
    return event("badge_earned", {"badgeCode": code}, when)


def test_placement_sets_level_and_entry_lesson(client: TestClient, auth: dict[str, str]) -> None:
    assert me(client, auth)["levelEstimate"] is None
    result = post(client, auth, [placement()])
    assert result["rejected"] == []
    state = me(client, auth)
    assert state["levelEstimate"] == 2
    assert state["profile"]["levelEstimate"] == "2"
    assert state["enrollment"]["currentLessonId"] == LAST_LESSON


def test_placement_does_not_move_learner_with_completed_lessons(client: TestClient, auth: dict[str, str]) -> None:
    done = event(
        "lesson_completed", {"sessionId": "s1", "lessonId": "vi-south.u01.l01", "score": 1, "durationMs": 1000}
    )
    post(client, auth, [done])
    current = me(client, auth)["enrollment"]["currentLessonId"]
    post(client, auth, [placement(level=3)])
    state = me(client, auth)
    assert state["levelEstimate"] == 3
    assert state["enrollment"]["currentLessonId"] == current


def test_placement_rejections(client: TestClient, auth: dict[str, str]) -> None:
    unknown = placement(entry="vi-south.u99.l01")
    too_high = placement()
    too_high["payload"]["levelEstimate"] = 4
    result = post(client, auth, [unknown, too_high])
    reasons = {r["id"]: r["reason"] for r in result["rejected"]}
    assert reasons[unknown["id"]] == "unknown_lesson"
    assert reasons[too_high["id"]].startswith("invalid:")
    assert me(client, auth)["levelEstimate"] is None


def test_badges_idempotent_and_unknown_rejected(client: TestClient, auth: dict[str, str]) -> None:
    now = datetime.now(UTC).replace(microsecond=0)
    later = badge("streak_7", now)
    earlier = badge("streak_7", now - timedelta(days=1))
    unknown = badge("moon_walker")
    result = post(client, auth, [later, badge("first_lesson", now + timedelta(seconds=1)), unknown])
    assert result["rejected"] == [{"id": unknown["id"], "reason": "unknown_badge"}]
    post(client, auth, [earlier, later])  # renvoi (même id) + même badge sous un autre id

    badges = me(client, auth)["badges"]
    assert [b["code"] for b in badges] == ["streak_7", "first_lesson"]
    assert datetime.fromisoformat(badges[0]["earnedAt"]) == now - timedelta(days=1)
    assert set(badges[0]) == {"code", "earnedAt"}


def test_daily_goal_from_local_date(client: TestClient, auth: dict[str, str]) -> None:
    fresh = me(client, auth)["dailyGoal"]
    assert fresh["targetMin"] == 10
    assert fresh["doneTodayMin"] == 0

    now = datetime.now(UTC)
    post(
        client,
        auth,
        [
            session_completed("d1", "2030-01-02", when=now - timedelta(minutes=30)),  # 6 min
            session_completed("d2", "2030-01-02", when=now - timedelta(minutes=5)),  # 6 min
            session_completed("d0", "2030-01-01", when=now - timedelta(hours=2)),
        ],
    )
    # Sans paramètre : jour local de la dernière séance récente.
    assert me(client, auth)["dailyGoal"] == {"targetMin": 10, "doneTodayMin": 12.0, "localDate": "2030-01-02"}
    # Paramètre explicite du client.
    assert client.get("/me?localDate=2030-01-01", headers=auth).json()["dailyGoal"]["doneTodayMin"] == 6.0
    assert client.get("/me?localDate=2030-01-03", headers=auth).json()["dailyGoal"]["doneTodayMin"] == 0


def test_guest_outbox_replayed_after_register(client: TestClient) -> None:
    """Parcours invité complet rejoué d'un bloc juste après l'inscription (migration invité → compte)."""
    headers = register(client)
    t0 = datetime.now(UTC) - timedelta(hours=1)
    placement_session = str(uuid.uuid4())
    lesson_session = str(uuid.uuid4())

    def at(seconds: int) -> datetime:
        return t0 + timedelta(seconds=seconds)

    outbox: list[dict[str, Any]] = [
        event("session_started", {"sessionId": placement_session, "source": "placement", "plannedSeconds": 120}, at(0)),
        event(
            "placement_completed",
            {
                "levelEstimate": 1,
                "entryLessonId": "vi-south.u01.l01",
                "correct": 3,
                "total": 8,
                "knownConceptIds": ["c_chao"],
            },
            at(100),
        ),
        event("session_started", {"sessionId": lesson_session, "source": "lesson", "plannedSeconds": 300}, at(120)),
    ]
    for i, correct in enumerate([True, False, True]):
        outbox.append(
            event(
                "answer_submitted",
                {
                    "sessionId": lesson_session,
                    "lessonId": "vi-south.u01.l01",
                    "stepIndex": i + 1,
                    "exerciseType": "tone_minimal_pair",
                    "conceptIds": ["c_ma_mom"],
                    "correct": correct,
                    "nearMiss": False,
                    "responseMs": 1800,
                    "attempt": 1,
                },
                at(130 + i * 10),
            )
        )
    outbox += [
        event(
            "srs_card_updated",
            {
                "card": {
                    "conceptId": "c_ma_mom",
                    "due": (t0 + timedelta(days=1)).isoformat(),
                    "stability": 1.2,
                    "difficulty": 5.1,
                    "scheduledDays": 1,
                    "learningSteps": 0,
                    "reps": 1,
                    "lapses": 0,
                    "state": "learning",
                    "lastReview": at(170).isoformat(),
                }
            },
            at(170),
        ),
        event(
            "lesson_completed",
            {"sessionId": lesson_session, "lessonId": "vi-south.u01.l01", "score": 0.67, "durationMs": 300000},
            at(420),
        ),
        event(
            "session_completed",
            {
                "sessionId": lesson_session,
                "xpGained": 40,
                "itemsCount": 3,
                "durationMs": 300000,
                "localDate": t0.date().isoformat(),
            },
            at(421),
        ),
        event("badge_earned", {"badgeCode": "first_lesson"}, at(422)),
    ]

    result = post(client, headers, list(reversed(outbox)))  # ordre d'envoi quelconque : trié par occurredAt
    assert result["rejected"] == []
    assert len(result["accepted"]) == len(outbox)
    assert post(client, headers, outbox)["rejected"] == []  # renvoi complet : idempotent

    state = client.get(f"/me?localDate={t0.date().isoformat()}", headers=headers).json()
    assert state["levelEstimate"] == 1
    assert state["enrollment"]["xpTotal"] == 40
    assert state["enrollment"]["currentLessonId"] != "vi-south.u01.l01"
    assert state["streak"]["current"] == 1
    assert [b["code"] for b in state["badges"]] == ["first_lesson"]
    assert state["dailyGoal"]["doneTodayMin"] == 5.0
    due = client.get("/me/srs/due", headers=headers).json()
    assert due == []  # carte due demain
