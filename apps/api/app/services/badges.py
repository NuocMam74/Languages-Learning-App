"""Catalogue des badges de la Phase 1 (spec §5.4).

Les badges sont décernés côté client (événement `badge_earned`) ; le serveur n'accepte que les codes
connus. Les lignes `badges` sont créées par la migration 0002 et, à défaut (tests, base créée par
`create_all`), à la volée avec le même identifiant déterministe.
"""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Badge

_BADGE_NAMESPACE = uuid.UUID("5b0f6f7e-2c1a-4d4e-9a4b-7061726c6f00")


@dataclass(frozen=True)
class BadgeDef:
    code: str
    family: str  # assiduity | competence | culture
    criteria: dict[str, Any]


PHASE1_BADGES: dict[str, BadgeDef] = {
    b.code: b
    for b in (
        BadgeDef("streak_7", "assiduity", {"streakDays": 7}),
        BadgeDef("streak_30", "assiduity", {"streakDays": 30}),
        BadgeDef("first_lesson", "assiduity", {"lessonsCompleted": 1}),
        BadgeDef("unit_1_done", "competence", {"unitCompleted": "vi-south.u01"}),
        BadgeDef("words_50", "competence", {"conceptsLearned": 50}),
        BadgeDef("tone_ear", "competence", {"toneItems": 50, "toneAccuracy": 0.95}),
    )
}


def badge_id(code: str) -> str:
    """Identifiant stable d'un badge (identique dans la migration et à la création à la volée)."""
    return str(uuid.uuid5(_BADGE_NAMESPACE, code))


def ensure_badge(db: Session, code: str) -> Badge | None:
    """Ligne `badges` du code connu (créée si absente) ; None si le code est inconnu."""
    definition = PHASE1_BADGES.get(code)
    if definition is None:
        return None
    row = db.scalar(select(Badge).where(Badge.code == code))
    if row is None:
        row = Badge(id=badge_id(code), code=code, family=definition.family, criteria_json=definition.criteria)
        db.add(row)
        db.flush()
    return row
