"""Niveaux de profil 1–50 (contrat parcours §3).

XP cumulée requise pour atteindre le niveau L : 25·(L−1)·(L+2) (L=2 → 100 ; L=50 → 63 700).
Noms : `pack.levelNames` (10 noms localisés, un par tranche de 5 niveaux).
"""

from dataclasses import dataclass

from app.services.content import Pack, level_names

MAX_LEVEL = 50
LEVELS_PER_NAME = 5


def xp_for_level(level: int) -> int:
    """XP cumulée pour atteindre `level` (1 → 0)."""
    level = max(1, min(MAX_LEVEL, level))
    return 25 * (level - 1) * (level + 2)


def level_for_xp(xp: int) -> int:
    xp = max(0, xp)
    level = 1
    while level < MAX_LEVEL and xp_for_level(level + 1) <= xp:
        level += 1
    return level


@dataclass(frozen=True)
class LevelInfo:
    value: int
    name: dict[str, str]
    xp_into_level: int
    xp_for_next: int


def level_name(pack: Pack | None, level: int) -> dict[str, str]:
    names = level_names(pack)
    if names is None:
        return {"fr": f"Niveau {level}", "en": f"Level {level}"}
    return dict(names[(max(1, min(MAX_LEVEL, level)) - 1) // LEVELS_PER_NAME])


def level_info(xp: int, pack: Pack | None) -> LevelInfo:
    """`xpIntoLevel` : XP au-delà du seuil du niveau ; `xpForNext` : écart jusqu'au niveau suivant (0 au niveau 50)."""
    xp = max(0, xp)
    value = level_for_xp(xp)
    floor = xp_for_level(value)
    span = xp_for_level(value + 1) - floor if value < MAX_LEVEL else 0
    return LevelInfo(value=value, name=level_name(pack, value), xp_into_level=xp - floor, xp_for_next=span)
