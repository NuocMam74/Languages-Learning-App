"""Série (spec §5.1) — portage fidèle de `packages/core/src/streak.ts`.

Dates en « jour local » de l'utilisateur : la série suit son calendrier, pas l'UTC.
- Un jour compte s'il contient au moins une séance terminée.
- 1 protection offerte tous les 10 jours de série, 2 au maximum, consommée automatiquement.
- Une absence couverte par `frozen_until` (vacances déclarées) ne casse pas la série.
"""

from dataclasses import dataclass, replace
from datetime import date

MAX_FREEZES = 2
FREEZE_EVERY_DAYS = 10


@dataclass(frozen=True)
class Streak:
    current: int = 0
    longest: int = 0
    last_active_date: date | None = None
    freezes_available: int = 0
    frozen_until: date | None = None


def _day(d: date) -> int:
    return d.toordinal()


def record_activity(streak: Streak, today: date) -> Streak:
    """Enregistre une séance terminée le jour `today`."""
    if streak.last_active_date == today:
        return streak

    freezes = streak.freezes_available
    if streak.last_active_date is None:
        current = 1
    else:
        gap = _day(today) - _day(streak.last_active_date)
        if gap <= 0:
            return streak  # horloge revenue en arrière : on ignore
        missed = gap - 1
        frozen_days = (
            0
            if streak.frozen_until is None
            else max(0, min(_day(streak.frozen_until), _day(today) - 1) - _day(streak.last_active_date))
        )
        uncovered = missed - frozen_days
        if uncovered <= 0:
            current = streak.current + 1
        elif uncovered <= freezes:
            freezes -= uncovered
            current = streak.current + 1
        else:
            current = 1

    earned = current // FREEZE_EVERY_DAYS - (current - 1) // FREEZE_EVERY_DAYS
    frozen_until = (
        streak.frozen_until if streak.frozen_until is not None and _day(streak.frozen_until) >= _day(today) else None
    )
    return replace(
        streak,
        current=current,
        longest=max(streak.longest, current),
        last_active_date=today,
        freezes_available=min(MAX_FREEZES, freezes + earned),
        frozen_until=frozen_until,
    )
