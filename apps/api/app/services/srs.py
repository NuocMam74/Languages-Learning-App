"""Cartes SRS côté serveur — portage de `isDue`, `isMastered` et `mergeCards` (packages/core/src/srs.ts).

Le serveur ne recalcule pas FSRS : l'état est calculé côté client et persisté ici (ADR 0003).
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

SrsState = Literal["new", "learning", "review", "relearning"]


@dataclass(frozen=True)
class SrsCard:
    concept_id: str
    due: datetime
    stability: float
    difficulty: float
    scheduled_days: float
    learning_steps: int
    reps: int
    lapses: int
    state: SrsState
    last_review: datetime | None


def is_due(card: SrsCard, now: datetime) -> bool:
    return card.state != "new" and card.due <= now


def is_mastered(card: SrsCard) -> bool:
    """Carte considérée comme maîtrisée (bloc « Réveil »)."""
    return card.state == "review" and card.stability >= 7 and card.lapses <= 2


def merge_cards(a: SrsCard, b: SrsCard) -> SrsCard:
    """Conflit de sync : `reps` le plus élevé gagne, puis `last_review` le plus récent ; égalité → `a`."""
    if a.reps != b.reps:
        return a if a.reps > b.reps else b
    ta = a.last_review.timestamp() if a.last_review else 0.0
    tb = b.last_review.timestamp() if b.last_review else 0.0
    return b if tb > ta else a
