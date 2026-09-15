"""Série (spec §5.1, contrat parcours §3) — portage de `packages/core/src/streak.ts`.

Dates en « jour local » de l'utilisateur : la série suit son calendrier, pas l'UTC.
- Un jour compte s'il contient au moins une séance terminée (non vide).
- 1 protection offerte tous les 10 jours de série, 2 au maximum, consommée automatiquement.
- Une absence couverte par le gel (« je pars quelques jours ») ne casse pas la série ; le gel ne couvre que les jours
  ≥ `frozen_from` (jour local de la déclaration) et ≤ `frozen_until` : pas de réparation rétroactive.
- Lecture : la série affichée vaut 0 si le dernier jour actif est antérieur à hier et que les jours manqués ne sont
  couverts ni par le gel ni par les protections disponibles.
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
    frozen_from: date | None = None


def _day(d: date) -> int:
    return d.toordinal()


def frozen_days_between(streak: Streak, first: date, last: date) -> int:
    """Jours de [first, last] couverts par le gel (bornés par frozen_from et frozen_until)."""
    if streak.frozen_until is None:
        return 0
    start = _day(first)
    if streak.frozen_from is not None:
        start = max(start, _day(streak.frozen_from))
    end = min(_day(last), _day(streak.frozen_until))
    return max(0, end - start + 1)


def _uncovered(streak: Streak, today: date) -> int:
    """Jours manqués entre le dernier jour actif et `today` (exclus) non couverts par le gel."""
    assert streak.last_active_date is not None  # noqa: S101
    missed = _day(today) - _day(streak.last_active_date) - 1
    if missed <= 0:
        return 0
    first = date.fromordinal(_day(streak.last_active_date) + 1)
    last = date.fromordinal(_day(today) - 1)
    return missed - frozen_days_between(streak, first, last)


def record_activity(streak: Streak, today: date) -> Streak:
    """Enregistre une séance terminée le jour `today`."""
    if streak.last_active_date == today:
        return streak

    freezes = streak.freezes_available
    if streak.last_active_date is None:
        current = 1
    else:
        if _day(today) - _day(streak.last_active_date) <= 0:
            return streak  # horloge revenue en arrière : on ignore
        uncovered = _uncovered(streak, today)
        if uncovered <= 0:
            current = streak.current + 1
        elif uncovered <= freezes:
            freezes -= uncovered
            current = streak.current + 1
        else:
            current = 1

    earned = current // FREEZE_EVERY_DAYS - (current - 1) // FREEZE_EVERY_DAYS
    keep_freeze = streak.frozen_until is not None and _day(streak.frozen_until) >= _day(today)
    return replace(
        streak,
        current=current,
        longest=max(streak.longest, current),
        last_active_date=today,
        freezes_available=min(MAX_FREEZES, freezes + earned),
        frozen_until=streak.frozen_until if keep_freeze else None,
        frozen_from=streak.frozen_from if keep_freeze else None,
    )


def displayed_current(streak: Streak, today: date) -> int:
    """Série affichée le jour `today` (règle de lecture, §3)."""
    if streak.last_active_date is None:
        return 0
    if _day(today) - _day(streak.last_active_date) <= 1:
        return streak.current
    return streak.current if _uncovered(streak, today) <= streak.freezes_available else 0


def freeze(streak: Streak, local_date: date, frozen_until: date | None) -> Streak:
    """Déclaration (ou annulation avec None) du gel « je pars quelques jours »."""
    if frozen_until is None:
        return replace(streak, frozen_until=None, frozen_from=None)
    return replace(streak, frozen_until=frozen_until, frozen_from=local_date)
