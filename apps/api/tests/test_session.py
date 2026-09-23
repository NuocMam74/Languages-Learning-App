"""Plan de séance (portage de session.ts) et série (portage de streak.ts)."""

from datetime import UTC, date, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import REPO_ROOT
from app.services.content import Lesson, load_packs
from app.services.planner import (
    OVERRUN_TOLERANCE,
    RECAP_SECONDS,
    REVIEW_ITEM_SECONDS,
    next_lesson,
    plan_session,
    review_day_threshold,
)
from app.services.progression import ProgressState, progress_from
from app.services.srs import SrsCard
from app.services.streak import Streak, record_activity
from tests.conftest import event

NOW = datetime(2026, 9, 14, 12, tzinfo=UTC)
PACK = load_packs(REPO_ROOT / "content")["vi-south"]


def make_card(concept_id: str, *, due_in_days: float, stability: float = 1.0, state: str = "review") -> SrsCard:
    return SrsCard(
        concept_id=concept_id,
        due=NOW + timedelta(days=due_in_days),
        stability=stability,
        difficulty=5,
        scheduled_days=1,
        learning_steps=0,
        reps=3,
        lapses=0,
        state=state,  # type: ignore[arg-type]
        last_review=NOW - timedelta(days=1),
    )


def test_session_next_for_fresh_user(client: TestClient, auth: dict[str, str]) -> None:
    plan = client.get("/me/session/next", headers=auth).json()
    assert plan == {
        "courseCode": "vi-south",
        "targetMinutes": 10,
        # Les bases (u00, contrat phase26 §2) ouvrent le parcours.
        "blocks": [{"kind": "new", "lessonId": "vi-south.u00.l01"}, {"kind": "recap"}],
        "estimatedSeconds": 20 + PACK.lessons["vi-south.u00.l01"].estimated_minutes * 60,
    }


def test_session_next_uses_progress_cards_and_goal(client: TestClient, auth: dict[str, str]) -> None:
    due_card = {
        "conceptId": "c_ma_mom",
        "due": "2026-01-01T00:00:00.000Z",
        "stability": 2,
        "difficulty": 5,
        "scheduledDays": 1,
        "learningSteps": 0,
        "reps": 2,
        "lapses": 0,
        "state": "review",
        "lastReview": "2025-12-31T00:00:00.000Z",
    }
    client.post(
        "/me/events",
        headers=auth,
        json={
            "events": [
                event(
                    "lesson_completed", {"sessionId": "s", "lessonId": "vi-south.u00.l01", "score": 1, "durationMs": 1}
                ),
                event("srs_card_updated", {"card": due_card}),
            ]
        },
    )
    lesson_seconds = PACK.lessons["vi-south.u00.l02"].estimated_minutes * 60
    plan = client.get("/me/session/next", headers=auth).json()
    assert plan["blocks"] == [
        {"kind": "review", "conceptIds": ["c_ma_mom"], "deferred": 0},
        {"kind": "new", "lessonId": "vi-south.u00.l02"},
        {"kind": "recap"},
    ]
    assert plan["estimatedSeconds"] == 20 + 15 + lesson_seconds

    # Plus petit objectif proposé : 10 min (600 s, toléré 720 s). Le plancher est passé de 5 à 10
    # quand un niveau est devenu un barème de 20 exercices notés (contrat phase21 §3) — un niveau
    # dure 6 min, et le planificateur écarte purement et simplement une leçon plus longue que
    # l'objectif du jour.
    #
    # Ce qui se vérifie ici n'est donc pas la durée d'un niveau (elle bougera encore, le jour où
    # les enregistrements existeront), mais l'invariant : au plus petit objectif, la leçon du jour
    # tient dans la séance avec ses révisions, marge de tolérance comprise.
    client.patch("/me/profile", headers=auth, json={"dailyGoalMin": 10})
    plan = client.get("/me/session/next", headers=auth).json()
    assert [b["kind"] for b in plan["blocks"]] == ["review", "new", "recap"]
    assert plan["estimatedSeconds"] <= 600 * (1 + OVERRUN_TOLERANCE)


def due_cards(n: int) -> list[SrsCard]:
    return [make_card(f"c_x{i}", due_in_days=-1 - i / 1000, state="learning") for i in range(n)]


LESSON_5 = Lesson(id="vi-south.u01.l01", unit="vi-south.u01", estimated_minutes=5, prerequisites=())


# --- Miroir de packages/core/src/session.test.ts ---------------------------------------------


def test_plan_new_user_first_lesson_then_recap() -> None:
    plan = plan_session(5, [], LESSON_5, NOW)
    assert plan.blocks == [{"kind": "new", "lessonId": "vi-south.u01.l01"}, {"kind": "recap"}]


def test_plan_never_exceeds_tolerance() -> None:
    for minutes in (5, 10, 15, 20):
        for due in (0, 3, 40, 300):
            plan = plan_session(minutes, due_cards(due), LESSON_5, NOW)
            assert plan.estimated_seconds <= minutes * 60 * (1 + OVERRUN_TOLERANCE)


def test_plan_5_min_few_reviews_before_lesson() -> None:
    plan = plan_session(5, due_cards(3), LESSON_5, NOW)
    assert [b["kind"] for b in plan.blocks] == ["review", "new", "recap"]
    assert plan.estimated_seconds <= 300 * (1 + OVERRUN_TOLERANCE)


def test_plan_review_day_without_new() -> None:
    assert review_day_threshold(120) == 8
    assert review_day_threshold(300) == 10
    assert review_day_threshold(1200) == 40
    plan = plan_session(5, due_cards(12), LESSON_5, NOW)
    assert [b["kind"] for b in plan.blocks] == ["review", "recap"]


def test_plan_extra_reviews_deferred() -> None:
    plan = plan_session(5, due_cards(100), None, NOW)
    review = next(b for b in plan.blocks if b["kind"] == "review")
    assert len(review["conceptIds"]) == (300 - RECAP_SECONDS) // REVIEW_ITEM_SECONDS
    assert review["deferred"] == 100 - len(review["conceptIds"])


def test_plan_warmup_review_cap_and_lesson() -> None:
    mastered = [make_card(f"m{i}", due_in_days=10, stability=10 + i) for i in range(4)]
    due = [make_card(f"d{i}", due_in_days=-i) for i in range(12)]
    lesson = Lesson(id="L", unit="U", estimated_minutes=6, prerequisites=())
    plan = plan_session(10, [*mastered, *due], lesson, NOW)
    warmup, review, new, recap = plan.blocks
    assert warmup == {"kind": "warmup", "conceptIds": ["m3", "m2", "m1"]}
    # 12 < seuil 20 : leçon incluse ; 720 − 20 − 30 − 360 = 310 s → 20 révisions possibles, 12 dues.
    assert review["conceptIds"] == [f"d{i}" for i in range(11, -1, -1)]
    assert review["deferred"] == 0
    assert new == {"kind": "new", "lessonId": "L"}
    assert recap == {"kind": "recap"}
    assert plan.estimated_seconds == 20 + 30 + 12 * 15 + 360


def test_next_lesson_follows_prerequisites() -> None:
    def done(ids: set[str]) -> ProgressState:
        return progress_from(PACK, dict.fromkeys(ids, 1.0))

    assert next_lesson(PACK, PACK.lessons, done(set()), None).id == "vi-south.u00.l01"  # type: ignore[union-attr]
    assert next_lesson(PACK, PACK.lessons, done({"vi-south.u00.l01"}), "family").id == "vi-south.u00.l02"  # type: ignore[union-attr]
    assert next_lesson(PACK, PACK.lessons, done(set(PACK.lessons)), None) is None


def test_session_next_honors_placement_entry(client: TestClient, auth: dict[str, str]) -> None:
    entry = "vi-south.u02.l01"
    placement = event(
        "placement_completed",
        {"levelEstimate": 1, "entryLessonId": entry, "correct": 5, "total": 8, "knownConceptIds": []},
    )
    client.post("/me/events", headers=auth, json={"events": [placement]})
    plan = client.get("/me/session/next", headers=auth).json()
    assert {"kind": "new", "lessonId": entry} in plan["blocks"]
    done = event("lesson_completed", {"sessionId": "s", "lessonId": entry, "score": 1, "durationMs": 1})
    client.post("/me/events", headers=auth, json={"events": [done]})
    assert client.get("/me", headers=auth).json()["enrollment"]["currentLessonId"] == "vi-south.u02.l02"


def test_record_activity_rules() -> None:
    s = record_activity(Streak(), date(2026, 9, 1))
    assert (s.current, s.longest, s.last_active_date) == (1, 1, date(2026, 9, 1))
    assert record_activity(s, date(2026, 9, 1)) is s  # même jour
    assert record_activity(s, date(2026, 8, 31)) is s  # horloge revenue en arrière
    assert record_activity(s, date(2026, 9, 2)).current == 2
    assert record_activity(s, date(2026, 9, 3)).current == 1  # trou sans protection

    # Absence déclarée : les jours gelés couvrent le trou.
    frozen = Streak(current=5, longest=5, last_active_date=date(2026, 9, 1), frozen_until=date(2026, 9, 5))
    after = record_activity(frozen, date(2026, 9, 6))
    assert (after.current, after.frozen_until) == (6, None)
    during = record_activity(frozen, date(2026, 9, 4))
    assert (during.current, during.frozen_until) == (6, date(2026, 9, 5))

    # Protections plafonnées à 2.
    s = Streak(current=29, longest=29, last_active_date=date(2026, 9, 1), freezes_available=2)
    assert record_activity(s, date(2026, 9, 2)).freezes_available == 2
