"""Parité avec packages/core : aléa, texte, moteur d'exercices (graine d'examen), planificateur, règles du parcours.

Fixtures produites par `npx tsx apps/api/tests/fixtures/generate_core_fixtures.ts` (voir l'en-tête du script).
"""

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest

from app.config import REPO_ROOT
from app.services import exams, progression
from app.services.badges import BadgeInput, evaluate_badges
from app.services.content import Lesson, load_packs
from app.services.engine import evaluate, seeded_random
from app.services.events import cap_session
from app.services.levels import level_info
from app.services.media import ALL_MEDIA
from app.services.planner import plan_session
from app.services.srs import SrsCard
from app.services.streak import Streak, displayed_current, record_activity
from app.services.text import compare_answer, normalize_answer

FIXTURES = Path(__file__).parent / "fixtures"
PARITY: dict[str, Any] = json.loads((FIXTURES / "core_parity.json").read_text(encoding="utf-8"))
EXAM: dict[str, Any] = json.loads((FIXTURES / "exam_a0.json").read_text(encoding="utf-8"))
PACK = load_packs(REPO_ROOT / "content")["vi-south"]
EXAM_SPEC = exams.parse_exam(EXAM)


def test_seeded_random_matches_core() -> None:
    for case in PARITY["random"]:
        rand = seeded_random(case["seed"])
        assert [rand() for _ in case["values"]] == case["values"]


def test_text_normalization_and_comparison_match_core() -> None:
    for case in PARITY["text"]["normalize"]:
        assert normalize_answer(case["input"]) == case["output"], case
    for case in PARITY["text"]["compare"]:
        assert compare_answer(case["given"], [case["accepted"]]) == case["kind"], case


@pytest.mark.parametrize("case", PARITY["exercises"], ids=lambda c: f"{c['seed'][:8]}-{c['section']}-{c['index']}")
def test_exam_exercises_match_core(case: dict[str, Any]) -> None:
    exercise = exams.build_items(PACK, EXAM_SPEC, case["seed"])[(case["section"], case["index"])]
    expected = case["exercise"]
    assert exercise.type == expected["type"]
    assert exercise.concept_ids == expected["conceptIds"]
    assert exercise.answer_id == expected["answerId"]
    if expected["options"] is not None:
        assert [(o.id, o.text, list(o.tones) if o.tones else None) for o in exercise.options] == [
            (o["id"], o["text"], o["tones"]) for o in expected["options"]
        ]
    if expected["tokens"] is not None:
        assert [(t.id, t.text) for t in exercise.tokens] == [(t["id"], t["text"]) for t in expected["tokens"]]
    for ev in case["evaluations"]:
        result = evaluate(exercise, ev["response"])
        assert (result.correct, result.near_miss, result.graded) == (ev["correct"], ev["nearMiss"], ev["graded"]), ev


@pytest.mark.parametrize("case", PARITY["grades"], ids=lambda c: f"{c['seed'][:8]}-{len(c['answers'])}")
def test_exam_grading_matches_core(case: dict[str, Any]) -> None:
    # `mediaIndex` null côté core (pack lu sur disque) : tous les médias déclarés sont présents.
    result = exams.grade(PACK, EXAM_SPEC, case["seed"], case["answers"], ALL_MEDIA)
    assert result.passed == case["passed"]
    assert result.global_score == pytest.approx(case["global"])
    assert result.scores == pytest.approx(case["scores"])
    assert result.gaps == case["gaps"]


def _card(raw: dict[str, Any]) -> SrsCard:
    return SrsCard(
        concept_id=raw["conceptId"],
        due=datetime.fromisoformat(raw["due"]),
        stability=raw["stability"],
        difficulty=raw["difficulty"],
        scheduled_days=raw["scheduledDays"],
        learning_steps=raw["learningSteps"],
        reps=raw["reps"],
        lapses=raw["lapses"],
        state=raw["state"],
        last_review=datetime.fromisoformat(raw["lastReview"]) if raw["lastReview"] else None,
    )


def test_planner_matches_core() -> None:
    fixture = PARITY["planner"]
    now = datetime.fromisoformat(fixture["now"])
    mastered = [_card(c) for c in fixture["masteredPool"]]
    due = [_card(c) for c in fixture["duePool"]]
    for case in fixture["cases"]:
        spec = case["input"]
        lesson = spec["nextLesson"]
        plan = plan_session(
            spec["targetMinutes"],
            [*mastered[: spec["mastered"]], *due[: spec["due"]]],
            Lesson(id=lesson["id"], unit="U", estimated_minutes=lesson["estimatedMinutes"], prerequisites=())
            if lesson
            else None,
            now,
        )
        assert {"blocks": plan.blocks, "estimatedSeconds": plan.estimated_seconds} == case["output"], spec


# --- Contrat parcours : médias et notation, graphe d'unités, placement, plafonds, niveaux, série, badges ---------


MEDIA_EXAM = exams.parse_exam(
    {
        **EXAM,
        "sections": [
            {
                **section,
                "items": [
                    {**item, "step": {**item["step"], "pitchRef": PARITY["mediaGrades"]["pitchRef"]}}
                    if item["step"]["type"] == "speak_repeat"
                    else item
                    for item in section["items"]
                ],
            }
            for section in EXAM["sections"]
        ],
    }
)


@pytest.mark.parametrize("case", PARITY["mediaGrades"]["cases"], ids=lambda c: f"{c['name']}-{len(c['answers'])}")
def test_media_aware_grading_matches_core(case: dict[str, Any]) -> None:
    index = ALL_MEDIA if case["media"] is None else frozenset(case["media"])
    graded = exams.graded_refs(PACK, MEDIA_EXAM, index)
    assert [{"section": s, "index": i, "graded": (s, i) in graded} for s, i in MEDIA_EXAM.items()] == case["graded"]
    assert len(graded) == case["gradedItems"]
    assert exams.unavailable_reason(PACK, MEDIA_EXAM, index) == case["unavailableReason"]
    result = exams.grade(PACK, MEDIA_EXAM, case["seed"], case["answers"], index)
    assert result.passed == case["passed"]
    assert result.global_score == pytest.approx(case["global"])
    assert result.scores == pytest.approx(case["scores"])
    assert result.gaps == case["gaps"]


def test_unit_graph_and_placement_match_core() -> None:
    fixture = PARITY["progression"]
    for entry in fixture["entries"]:
        lesson = progression.resolve_entry_lesson(PACK, entry["level"])
        assert (lesson.id if lesson else None) == entry["lessonId"], entry
    for case in fixture["cases"]:
        state = progression.ProgressState(frozenset(case["completed"]), frozenset(case["passed"]))
        lesson = progression.next_lesson(PACK, PACK.lessons, state, case["path"])
        assert (lesson.id if lesson else None) == case["next"], case["name"]
        assert [u.id for u in PACK.units if progression.is_unit_passed(PACK, u, state)] == case["passedUnits"]


def test_session_caps_and_levels_match_core() -> None:
    for case in PARITY["caps"]:
        i = case["input"]
        items, xp, duration = cap_session(i["itemsCount"], i["xpGained"], i["durationMs"])
        assert {"itemsCount": items, "xpGained": xp, "durationMs": duration} == case["output"], case
    for case in PARITY["levels"]:
        info = level_info(case["xp"], None)
        assert {"value": info.value, "xpIntoLevel": info.xp_into_level, "xpForNext": info.xp_for_next} == case[
            "level"
        ], case


def _streak(raw: dict[str, Any]) -> Streak:
    def day(value: str | None) -> date | None:
        return date.fromisoformat(value) if value else None

    return Streak(
        current=raw["current"],
        longest=raw["longest"],
        last_active_date=day(raw["lastActiveDate"]),
        freezes_available=raw["freezesAvailable"],
        frozen_until=day(raw["frozenUntil"]),
        frozen_from=day(raw.get("frozenFrom")),
    )


def test_streak_rules_match_core() -> None:
    for case in PARITY["streaks"]:
        streak = _streak(case["streak"])
        today = date.fromisoformat(case["day"])
        assert record_activity(streak, today) == _streak(case["recorded"]), case
        assert displayed_current(streak, today) == case["displayed"], case


def test_badges_match_core() -> None:
    for case in PARITY["badges"]:
        data = BadgeInput(
            pack=PACK,
            progress=progression.ProgressState(frozenset(case["completed"]), frozenset(case["passed"])),
            streak=_streak(case["streak"]),
            known_words=case["knownWords"],
            tone_log=case["toneLog"],
            south_log=case["southLog"],
            culture_cards_passed=case["cultureCardsPassed"],
        )
        assert evaluate_badges(data, set()) == case["earned"], case["name"]
