"""Planification d'une séance (spec §4.3) — portage fidèle de `packages/core/src/session.ts`.

Réveil (30 s) → Rappel espacé → Nouveau → Mise en pratique → Bilan (20 s).
La durée annoncée est un plafond : les révisions en trop glissent au lendemain.
"""

import math
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.services.content import Lesson, Pack
from app.services.srs import SrsCard, is_due, is_mastered

WARMUP_SECONDS = 30
RECAP_SECONDS = 20
WARMUP_ITEMS = 3
# Durée moyenne d'un item de révision, feedback compris.
REVIEW_ITEM_SECONDS = 15
# Tolérance de dépassement de la durée annoncée (critère d'acceptation : ±20 %).
OVERRUN_TOLERANCE = 0.2


@dataclass(frozen=True)
class SessionPlan:
    blocks: list[dict[str, Any]]
    estimated_seconds: int | float


def plan_session(
    target_minutes: float, cards: Sequence[SrsCard], next_lesson: Lesson | None, now: datetime
) -> SessionPlan:
    """Blocs sérialisés comme `SessionBlock` côté TypeScript (clés camelCase)."""
    budget = target_minutes * 60
    blocks: list[dict[str, Any]] = []
    used: float = RECAP_SECONDS

    due = sorted((c for c in cards if is_due(c, now)), key=lambda c: c.due)
    due_ids = {c.concept_id for c in due}

    warmup = [
        c.concept_id
        for c in sorted(
            (c for c in cards if is_mastered(c) and c.concept_id not in due_ids),
            key=lambda c: -c.stability,
        )[:WARMUP_ITEMS]
    ]
    if warmup:
        blocks.append({"kind": "warmup", "conceptIds": warmup})
        used += WARMUP_SECONDS

    lesson_seconds = next_lesson.estimated_minutes * 60 if next_lesson else 0
    # Le nouveau n'entre que s'il tient dans le budget (avec tolérance), ou s'il n'y a rien à réviser.
    include_lesson = next_lesson is not None and (
        len(due) == 0 or used + lesson_seconds <= budget * (1 + OVERRUN_TOLERANCE)
    )

    review_budget = max(0, budget - used - (lesson_seconds if include_lesson else 0))
    review_count = min(len(due), math.floor(review_budget / REVIEW_ITEM_SECONDS))
    if review_count > 0:
        blocks.append(
            {
                "kind": "review",
                "conceptIds": [c.concept_id for c in due[:review_count]],
                "deferred": len(due) - review_count,
            }
        )
        used += review_count * REVIEW_ITEM_SECONDS

    if include_lesson and next_lesson is not None:
        blocks.append({"kind": "new", "lessonId": next_lesson.id})
        used += lesson_seconds

    blocks.append({"kind": "recap"})
    return SessionPlan(blocks=blocks, estimated_seconds=used)


def next_lesson(
    pack: Pack,
    lessons: Mapping[str, Lesson],
    completed: Collection[str],
    path: str | None,
) -> Lesson | None:
    """Prochaine leçon disponible : prérequis remplis, non terminée, dans une unité publiée.

    Le parcours du profil trie les unités par tags : un seul corpus, plusieurs chemins (spec §6.2).
    """
    boost = set(pack.paths.get(path, ())) if path else set()
    units = [
        (unit, order, any(t in boost for t in unit.tags))
        for order, unit in enumerate(pack.units)
        if unit.status == "available"
    ]
    # Unités boostées d'abord ; les prérequis empêchent de sauter le socle.
    units.sort(key=lambda u: (not u[2], u[1]))

    for unit, _order, _boosted in units:
        for lesson_id in unit.lessons:
            if lesson_id in completed:
                continue
            lesson = lessons.get(lesson_id)
            if lesson is None:
                continue
            if all(p in completed for p in lesson.prerequisites):
                return lesson
    return None
