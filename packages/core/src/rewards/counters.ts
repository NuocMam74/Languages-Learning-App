import { dayNumber, localDay } from "../streak.ts";

/**
 * Compteurs d'activité (contrat phase9 §1) : la matière première des missions et des trophées.
 *
 * Ils sont **dérivés** de ce qu'une séance produit déjà (items, réussites, XP, leçons…) et écrits
 * dans la même transaction que les totaux — jamais recalculés depuis l'outbox, qui se vide à la
 * synchronisation. Tout reste sur l'appareil (spec §14) : aucun événement nouveau.
 */

export const METRICS = [
  /** Séances terminées (hors entraînement). */
  "sessions",
  /** Leçons terminées. */
  "lessons",
  /** Items répondus, tous blocs confondus. */
  "items",
  /** Items réussis du premier coup. */
  "correct",
  /** XP gagnée. */
  "xp",
  /** Parties de mini-jeu jouées. */
  "games",
  /** Parties réussies (ratio ≥ seuil du moteur). */
  "gameWins",
  /** Leçons terminées sans une seule erreur. */
  "perfectLessons",
  /** Items de rappel espacé réussis. */
  "reviewItems",
  /** Concepts appris pour la première fois. */
  "newWords",
  /** Items de tons répondus. */
  "toneItems",
  /** Items de production orale notés. */
  "speakItems",
  /** Minutes d'activité (arrondies à la séance). */
  "minutes",
  /** Missions réclamées. */
  "missions",
] as const;

export type Metric = (typeof METRICS)[number];
export type Counters = Partial<Record<Metric, number>>;

/** Journal par jour local (AAAA-MM-JJ). */
export type CountersJournal = Record<string, Counters>;

/** Au-delà, un jour ne sert plus à rien : aucune mission ne regarde si loin. */
export const JOURNAL_MAX_DAYS = 400;

export const emptyCounters = (): Counters => ({});

/** Somme de deux jeux de compteurs. Une métrique à zéro n'est pas écrite : le journal reste petit. */
export function addCounters(a: Counters, b: Counters): Counters {
  const out: Counters = {};
  for (const metric of METRICS) {
    const sum = (a[metric] ?? 0) + (b[metric] ?? 0);
    if (sum !== 0) out[metric] = sum;
  }
  return out;
}

/** Retire les valeurs nulles ou négatives : un compteur ne recule jamais. */
export function normalizeCounters(raw: unknown): Counters {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out: Counters = {};
  for (const metric of METRICS) {
    const value = source[metric];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[metric] = Math.floor(value);
  }
  return out;
}

export function normalizeJournal(raw: unknown): CountersJournal {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out: CountersJournal = {};
  for (const [day, value] of Object.entries(source)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const counters = normalizeCounters(value);
    if (Object.keys(counters).length > 0) out[day] = counters;
  }
  return out;
}

/** Ajoute des compteurs au jour `day` et oublie ce qui est trop vieux. */
export function bumpJournal(journal: CountersJournal, day: string, delta: Counters): CountersJournal {
  const merged: CountersJournal = { ...journal, [day]: addCounters(journal[day] ?? {}, delta) };
  const cutoff = dayNumber(day) - JOURNAL_MAX_DAYS;
  return Object.fromEntries(Object.entries(merged).filter(([key]) => dayNumber(key) > cutoff));
}

export function sumCounters(journal: CountersJournal, days: Iterable<string>): Counters {
  let out: Counters = {};
  for (const day of days) {
    const counters = journal[day];
    if (counters) out = addCounters(out, counters);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Périodes

export type MissionPeriod = "daily" | "weekly" | "monthly";
export const MISSION_PERIODS: readonly MissionPeriod[] = ["daily", "weekly", "monthly"];

export interface Period {
  kind: MissionPeriod;
  /** Clé stable de la période (`2026-09-17`, `2026-W38`, `2026-09`). */
  key: string;
  /** Jours locaux couverts, du premier au dernier (bornes comprises). */
  days: string[];
  /** Instant de fin (exclu), horloge locale : « il reste X ». */
  endsAt: Date;
}

const addDays = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

/** Lundi de la semaine locale de `date` (la série suit le calendrier de l'apprenant, pas l'UTC). */
export function weekStart(date: Date): Date {
  return addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -((date.getDay() + 6) % 7));
}

/** Numéro de semaine ISO (lundi, semaine qui contient le jeudi). */
export function isoWeek(date: Date): { year: number; week: number } {
  const monday = weekStart(date);
  const thursday = addDays(monday, 3);
  const firstThursday = (() => {
    const jan4 = new Date(thursday.getFullYear(), 0, 4);
    return addDays(weekStart(jan4), 3);
  })();
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { year: thursday.getFullYear(), week };
}

function daysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(localDay(d));
  return out;
}

/** Période courante d'un genre de mission, à l'heure locale de l'apprenant. */
export function periodOf(kind: MissionPeriod, now: Date): Period {
  if (kind === "daily") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { kind, key: localDay(start), days: [localDay(start)], endsAt: addDays(start, 1) };
  }
  if (kind === "weekly") {
    const start = weekStart(now);
    const end = addDays(start, 7);
    const { year, week } = isoWeek(now);
    return { kind, key: `${year}-W${String(week).padStart(2, "0")}`, days: daysBetween(start, end), endsAt: end };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { kind, key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`, days: daysBetween(start, end), endsAt: end };
}

/** Compteurs accumulés dans la période (les jours à venir sont simplement absents du journal). */
export function periodCounters(journal: CountersJournal, period: Period): Counters {
  return sumCounters(journal, period.days);
}
