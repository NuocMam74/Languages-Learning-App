"""Catalogue et critères des badges (spec §5.4, §5.2, contrat parcours §3).

Les badges d'apprentissage sont décernés côté client (événement `badge_earned`) ; le serveur n'accepte que les
codes connus et applique les **mêmes critères** (`evaluate_badges`, portage de packages/core/src/badges.ts) pour
les tests de parité et l'export. Les badges des défis de la semaine (`challenge_<kind>`) sont décernés par le
serveur seul, à la réclamation du défi, et listés dans `/me.badges`. Les lignes `badges` sont créées par les
migrations (0002, 0003, 0006) et, à défaut (tests, base créée par `create_all`), à la volée avec le même
identifiant déterministe.
"""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Badge
from app.services.content import Pack
from app.services.progression import ProgressState, is_unit_passed
from app.services.streak import Streak

_BADGE_NAMESPACE = uuid.UUID("5b0f6f7e-2c1a-4d4e-9a4b-7061726c6f00")


@dataclass(frozen=True)
class BadgeDef:
    code: str
    family: str  # assiduity | competence | culture | challenge
    criteria: dict[str, Any]


WORDS_BADGE_COUNT = 50
WORDS_500_COUNT = 500
TONE_EAR_WINDOW = 50
TONE_EAR_RATIO = 0.95
NO_NORTH_WINDOW = 30
NO_NORTH_RATIO = 0.95
CULTURE_EXPLORER_CARDS = 20

LEARNING_BADGES: dict[str, BadgeDef] = {
    b.code: b
    for b in (
        BadgeDef("first_lesson", "assiduity", {"lessonsCompleted": 1}),
        BadgeDef("streak_7", "assiduity", {"streakDays": 7}),
        BadgeDef("streak_30", "assiduity", {"streakDays": 30}),
        BadgeDef("streak_100", "assiduity", {"streakDays": 100}),
        BadgeDef("streak_365", "assiduity", {"streakDays": 365}),
        BadgeDef("unit_1_done", "competence", {"unitCompleted": "first"}),
        BadgeDef("words_50", "competence", {"conceptsLearned": WORDS_BADGE_COUNT}),
        BadgeDef("words_500", "competence", {"conceptsLearned": WORDS_500_COUNT}),
        BadgeDef("tone_ear", "competence", {"toneItems": TONE_EAR_WINDOW, "toneAccuracy": TONE_EAR_RATIO}),
        BadgeDef("no_north_accent", "competence", {"spotTheSouthItems": NO_NORTH_WINDOW, "accuracy": NO_NORTH_RATIO}),
        BadgeDef("culture_explorer", "culture", {"cultureCardsPassed": CULTURE_EXPLORER_CARDS}),
        BadgeDef("culture_unit", "culture", {"unitTestPassedWithTag": "culture"}),
    )
}

CHALLENGE_KINDS = ("words_theme", "streak_days", "speaking_minutes", "lessons", "game_score")

CHALLENGE_BADGES: dict[str, BadgeDef] = {
    f"challenge_{kind}": BadgeDef(f"challenge_{kind}", "challenge", {"challengeKind": kind}) for kind in CHALLENGE_KINDS
}


def badge_id(code: str) -> str:
    """Identifiant stable d'un badge (identique dans la migration et à la création à la volée)."""
    return str(uuid.uuid5(_BADGE_NAMESPACE, code))


def ensure_badge(db: Session, code: str, *, server_awarded: bool = False) -> Badge | None:
    """Ligne `badges` du code connu (créée si absente) ; None si le code est inconnu.

    `server_awarded` ouvre aussi les badges décernés par le serveur (refusés dans `badge_earned`).
    """
    definition = LEARNING_BADGES.get(code) or (CHALLENGE_BADGES.get(code) if server_awarded else None)
    if definition is None:
        return None
    row = db.scalar(select(Badge).where(Badge.code == code))
    if row is None:
        row = Badge(id=badge_id(code), code=code, family=definition.family, criteria_json=definition.criteria)
        db.add(row)
        db.flush()
    return row


# --- Critères (portage de evaluateBadges) ----------------------------------------------------


@dataclass(frozen=True)
class BadgeInput:
    pack: Pack
    progress: ProgressState
    streak: Streak
    known_words: int
    # Résultats des derniers items, du plus ancien au plus récent.
    tone_log: Sequence[bool] = ()
    south_log: Sequence[bool] = ()
    culture_cards_passed: int = 0


def badge_codes_for(pack: Pack) -> list[str]:
    """Badges d'apprentissage qui ont un sens pour ce pack (ordre du catalogue)."""
    features = set(pack.raw.get("features") or [])
    out = []
    for code in LEARNING_BADGES:
        if code == "tone_ear" and "tones" not in features:
            continue
        if code == "no_north_accent" and "lexical_variants" not in features:
            continue
        out.append(code)
    return out


def _window_ok(log: Sequence[bool], window: int, ratio: float) -> bool:
    recent = list(log)[-window:]
    return len(recent) >= window and sum(1 for r in recent if r) / len(recent) >= ratio


def criterion(code: str, data: BadgeInput) -> bool:
    best = max(data.streak.current, data.streak.longest)
    pack = data.pack
    match code:
        case "first_lesson":
            return len(data.progress.completed) >= 1
        case "streak_7" | "streak_30" | "streak_100" | "streak_365":
            return best >= int(code.split("_")[1])
        case "unit_1_done":
            unit = pack.units[0] if pack.units else None
            return unit is not None and bool(unit.lessons) and all(i in data.progress.completed for i in unit.lessons)
        case "words_50":
            return data.known_words >= WORDS_BADGE_COUNT
        case "words_500":
            return data.known_words >= WORDS_500_COUNT
        case "tone_ear":
            return _window_ok(data.tone_log, TONE_EAR_WINDOW, TONE_EAR_RATIO)
        case "no_north_accent":
            return _window_ok(data.south_log, NO_NORTH_WINDOW, NO_NORTH_RATIO)
        case "culture_explorer":
            return data.culture_cards_passed >= CULTURE_EXPLORER_CARDS
        case "culture_unit":
            return any("culture" in unit.tags and is_unit_passed(pack, unit, data.progress) for unit in pack.units)
    return False


def evaluate_badges(data: BadgeInput, earned: Collection[str]) -> list[str]:
    """Badges nouvellement gagnés (ordre stable du catalogue)."""
    return [code for code in badge_codes_for(data.pack) if code not in earned and criterion(code, data)]
