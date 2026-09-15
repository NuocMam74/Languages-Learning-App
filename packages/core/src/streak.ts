/**
 * Série (spec §5.1). Dates en « jour local » AAAA-MM-JJ : la série suit le
 * calendrier de l'utilisateur, pas l'UTC.
 *
 * - Un jour compte s'il contient au moins une séance terminée.
 * - 1 protection offerte tous les 10 jours de série, 2 au maximum, consommée automatiquement.
 * - Une absence couverte par `frozenUntil` (vacances déclarées) ne casse pas la série ; le gel ne couvre
 *   que les jours ≥ `frozenFrom` (jour de la déclaration) : pas de réparation rétroactive (contrat phase5 §3).
 */

export interface Streak {
  current: number;
  longest: number;
  lastActiveDate: string | null;
  freezesAvailable: number;
  frozenUntil: string | null;
  /** Jour local de la déclaration du gel ; null = gel ancien sans date (couvre toute l'absence). */
  frozenFrom?: string | null;
}

export const MAX_FREEZES = 2;
export const FREEZE_EVERY_DAYS = 10;

export const emptyStreak = (): Streak => ({
  current: 0,
  longest: 0,
  lastActiveDate: null,
  freezesAvailable: 0,
  frozenUntil: null,
  frozenFrom: null,
});

export function dayNumber(isoDay: string): number {
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
    const frozenDays = frozenDaysBetween(streak, dayNumber(streak.lastActiveDate) + 1, dayNumber(today) - 1);
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
    ...stillFrozen(streak, today),
  };
}

function stillFrozen(streak: Streak, today: string): Pick<Streak, "frozenUntil" | "frozenFrom"> {
  const active = streak.frozenUntil !== null && dayNumber(streak.frozenUntil) >= dayNumber(today);
  return active ? { frozenUntil: streak.frozenUntil, frozenFrom: streak.frozenFrom ?? null } : { frozenUntil: null, frozenFrom: null };
}

/** Jours de [from, to] (numéros de jour) couverts par le gel déclaré. */
function frozenDaysBetween(streak: Streak, from: number, to: number): number {
  if (streak.frozenUntil === null || to < from) return 0;
  const start = streak.frozenFrom ? Math.max(from, dayNumber(streak.frozenFrom)) : from;
  const end = Math.min(to, dayNumber(streak.frozenUntil));
  return Math.max(0, end - start + 1);
}

/**
 * Série affichée au jour `today` (lecture, contrat phase5 §3) : 0 si le dernier jour actif est avant
 * hier et que les jours manqués (jusqu'à hier) ne sont couverts ni par le gel ni par les protections.
 */
export function streakAt(streak: Streak, today: string): Streak {
  if (streak.lastActiveDate === null) return streak;
  const gap = dayNumber(today) - dayNumber(streak.lastActiveDate);
  if (gap <= 1) return streak;
  const missed = gap - 1;
  const uncovered = missed - frozenDaysBetween(streak, dayNumber(streak.lastActiveDate) + 1, dayNumber(today) - 1);
  return uncovered <= streak.freezesAvailable ? streak : { ...streak, current: 0 };
}
