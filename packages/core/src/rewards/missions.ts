import { seededRandom, shuffle } from "../engine.ts";
import { periodOf, type Counters, type Metric, type MissionPeriod, type Period } from "./counters.ts";
import type { ChestTier } from "./collection.ts";

/**
 * Missions quotidiennes, hebdomadaires et mensuelles (contrat phase9 §3).
 *
 * Générées **localement et de façon déterministe** depuis la période : même appareil hors ligne,
 * même liste — rien à synchroniser, rien à attendre. Les cibles sont calibrées sur l'objectif
 * quotidien choisi à l'onboarding : une mission n'est jamais hors de portée de la personne à qui
 * elle s'adresse (spec §3 : zéro blocage, y compris dans la motivation).
 *
 * Le défi de la semaine du serveur (spec §5.2) reste indépendant : ces missions vivent à côté.
 */

export const MISSION_KINDS = [
  "items",
  "correct",
  "sessions",
  "lessons",
  "games",
  "gameWins",
  "perfect",
  "review",
  "newWords",
  "tones",
  "speak",
  "xp",
  "minutes",
] as const;
export type MissionKind = (typeof MISSION_KINDS)[number];

const METRIC_OF: Record<MissionKind, Metric> = {
  items: "items",
  correct: "correct",
  sessions: "sessions",
  lessons: "lessons",
  games: "games",
  gameWins: "gameWins",
  perfect: "perfectLessons",
  review: "reviewItems",
  newWords: "newWords",
  tones: "toneItems",
  speak: "speakItems",
  xp: "xp",
  minutes: "minutes",
};

/** Combien de missions par période : assez pour choisir, jamais assez pour écraser l'écran. */
export const MISSION_COUNT: Record<MissionPeriod, number> = { daily: 3, weekly: 3, monthly: 2 };

/**
 * Jours actifs supposés d'une période plus longue. On ne demande pas sept jours sur sept : une
 * mission hebdomadaire se boucle en cinq séances, une mensuelle en dix-huit.
 */
const PERIOD_DAYS: Record<MissionPeriod, number> = { daily: 1, weekly: 5, monthly: 18 };

/**
 * Récompense d'une mission réclamée : des **xu**, et un coffre pour les périodes longues.
 *
 * Volontairement pas d'XP : l'XP est la quantité que le serveur calcule depuis les événements
 * d'apprentissage, et `applyServerState` la réécrit à chaque lecture de `/me`. De l'XP ajoutée
 * localement disparaîtrait à la synchronisation suivante — une récompense qui s'évapore est pire
 * que pas de récompense. Les xu, eux, sont locaux de bout en bout (contrat phase9 §1).
 */
export interface MissionReward {
  coins: number;
  chest: ChestTier | null;
}

const REWARD: Record<MissionPeriod, MissionReward> = {
  daily: { coins: 15, chest: null },
  weekly: { coins: 60, chest: "lacquer" },
  monthly: { coins: 200, chest: "jade" },
};

export const missionReward = (period: MissionPeriod): MissionReward => REWARD[period];

export interface Mission {
  /** `2026-W38:review` — stable dans la période, et différent d'une période à l'autre. */
  id: string;
  period: MissionPeriod;
  kind: MissionKind;
  metric: Metric;
  target: number;
  reward: MissionReward;
}

export interface MissionOptions {
  /** Objectif quotidien du profil, en minutes (5, 10, 15 ou 20). */
  dailyGoalMin?: number;
  /** Genres à écarter : un pack sans tons ne demande pas d'exercices de tons. */
  exclude?: Iterable<MissionKind>;
}

/** Unité d'effort : 1 pour 5 min/jour, 4 pour 20 min/jour. */
const goalUnit = (dailyGoalMin: number | undefined): number => Math.max(1, Math.min(4, Math.round((dailyGoalMin ?? 5) / 5)));

/** Cible quotidienne d'un genre, avant multiplication par la durée de la période. */
function dailyTarget(kind: MissionKind, unit: number): number {
  switch (kind) {
    case "items":
      return 6 * unit + 4;
    case "correct":
      return 5 * unit + 3;
    case "review":
      return 4 * unit + 2;
    case "tones":
      return 3 * unit + 2;
    case "newWords":
      return 2 * unit + 1;
    case "speak":
      return 2 * unit;
    case "xp":
      return 40 * unit;
    case "minutes":
      return 5 * unit;
    case "sessions":
      return unit >= 3 ? 2 : 1;
    case "lessons":
      return unit >= 3 ? 2 : 1;
    case "games":
    case "gameWins":
    case "perfect":
      return 1;
  }
}

/**
 * Cible d'une mission. Les périodes longues n'exigent pas la même chose chaque jour : on multiplie
 * par les jours actifs supposés, puis on arrondit à quelque chose de lisible (5, 10, 25…).
 */
export function missionTarget(kind: MissionKind, period: MissionPeriod, options: MissionOptions = {}): number {
  const raw = dailyTarget(kind, goalUnit(options.dailyGoalMin)) * PERIOD_DAYS[period];
  if (period === "daily" || raw < 10) return raw;
  const step = raw >= 500 ? 50 : raw >= 100 ? 25 : 5;
  return Math.max(step, Math.round(raw / step) * step);
}

/**
 * Missions de la période, dans un ordre stable. Le tirage est semé par la clé de période : deux
 * appareils, ou deux lancements, donnent la même liste — et la liste change à chaque période.
 */
export function generateMissions(period: Period, options: MissionOptions = {}): Mission[] {
  const excluded = new Set(options.exclude ?? []);
  const pool = MISSION_KINDS.filter((kind) => !excluded.has(kind));
  const rand = seededRandom(`missions:${period.kind}:${period.key}`);
  const picked = shuffle(pool, rand).slice(0, Math.min(MISSION_COUNT[period.kind], pool.length));
  return picked.map((kind) => ({
    id: `${period.key}:${kind}`,
    period: period.kind,
    kind,
    metric: METRIC_OF[kind],
    target: missionTarget(kind, period.kind, options),
    reward: REWARD[period.kind],
  }));
}

/** Missions courantes des trois périodes (quotidienne d'abord). */
export function currentMissions(now: Date, options: MissionOptions = {}): { period: Period; missions: Mission[] }[] {
  return (["daily", "weekly", "monthly"] as const).map((kind) => {
    const period = periodOf(kind, now);
    return { period, missions: generateMissions(period, options) };
  });
}

export function missionProgress(mission: Mission, counters: Counters): number {
  return Math.min(mission.target, Math.max(0, counters[mission.metric] ?? 0));
}

export const missionDone = (mission: Mission, counters: Counters): boolean => missionProgress(mission, counters) >= mission.target;
