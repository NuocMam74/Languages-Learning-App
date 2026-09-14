/**
 * Série (spec §5.1). Dates en « jour local » AAAA-MM-JJ : la série suit le
 * calendrier de l'utilisateur, pas l'UTC.
 *
 * - Un jour compte s'il contient au moins une séance terminée.
 * - 1 protection offerte tous les 10 jours de série, 2 au maximum, consommée automatiquement.
 * - Une absence couverte par `frozenUntil` (vacances déclarées) ne casse pas la série.
 */

export interface Streak {
  current: number;
  longest: number;
  lastActiveDate: string | null;
  freezesAvailable: number;
  frozenUntil: string | null;
}

export const MAX_FREEZES = 2;
export const FREEZE_EVERY_DAYS = 10;

export const emptyStreak = (): Streak => ({
  current: 0,
  longest: 0,
  lastActiveDate: null,
  freezesAvailable: 0,
  frozenUntil: null,
});

function dayNumber(isoDay: string): number {
  const [y, m, d] = isoDay.split("-").map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Enregistre une séance terminée le jour `today`. */
export function recordActivity(streak: Streak, today: string): Streak {
  if (streak.lastActiveDate === today) return streak;

  let current: number;
  let freezes = streak.freezesAvailable;

  if (streak.lastActiveDate === null) {
    current = 1;
  } else {
    const gap = dayNumber(today) - dayNumber(streak.lastActiveDate);
    if (gap <= 0) return streak; // horloge revenue en arrière : on ignore
    const missed = gap - 1;
    const frozenDays =
      streak.frozenUntil === null
        ? 0
        : Math.max(0, Math.min(dayNumber(streak.frozenUntil), dayNumber(today) - 1) - dayNumber(streak.lastActiveDate));
    const uncovered = missed - frozenDays;
    if (uncovered <= 0) {
      current = streak.current + 1;
    } else if (uncovered <= freezes) {
      freezes -= uncovered;
      current = streak.current + 1;
    } else {
      current = 1;
    }
  }

  const earned = Math.floor(current / FREEZE_EVERY_DAYS) - Math.floor((current - 1) / FREEZE_EVERY_DAYS);
  return {
    current,
    longest: Math.max(streak.longest, current),
    lastActiveDate: today,
    freezesAvailable: Math.min(MAX_FREEZES, freezes + earned),
    frozenUntil: streak.frozenUntil !== null && dayNumber(streak.frozenUntil) >= dayNumber(today) ? streak.frozenUntil : null,
  };
}
