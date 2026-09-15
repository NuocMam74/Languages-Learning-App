"""Parité avec packages/core : aléa, texte, moteur d'exercices (graine d'examen), planificateur.

Fixtures produites par `npx tsx apps/api/tests/fixtures/generate_core_fixtures.ts` (voir l'en-tête du script).
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from app.config import REPO_ROOT
from app.services import exams
from app.services.content import Lesson, load_packs
from app.services.engine import evaluate, seeded_random
from app.services.planner import plan_session
from app.services.srs import SrsCard
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
    result = exams.grade(PACK, EXAM_SPEC, case["seed"], case["answers"])
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
