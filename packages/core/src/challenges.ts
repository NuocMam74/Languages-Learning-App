import { GAME_PASS_RATIO } from "./engine.ts";
import type { ParloEvent } from "./events.ts";
import type { ConceptId, ContentIndex, LessonId, Localized, UnitId } from "./types.ts";

/**
 * Défi de la semaine (spec §5.2, contrat phase2 §3). Le serveur fait foi ;
 * ce module recalcule la progression localement (hors ligne, invité) avec les
 * mêmes règles, à partir des événements de la période.
 */

/** Tour de conversation avec Cô Mai compté dans les défis « parole » (contrat Phase 3 §4). */
export const SPEAKING_SECONDS_PER_TURN = 20;

export const CHALLENGE_KINDS = ["words_theme", "streak_days", "speaking_minutes", "lessons", "game_score"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

/** Durée créditée par item de prononciation noté. */
export const SPEAKING_SECONDS_PER_ITEM = 10;
export const CHALLENGE_XP = 50;

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  title: Localized;
  target: number;
  unit: UnitId | null;
  progress: number;
  completedAt: string | null;
  claimedAt: string | null;
  periodStart: string;
  periodEnd: string;
  badgeCode: string;
}

export type ChallengeSpec = Pick<Challenge, "kind" | "target" | "unit" | "periodStart" | "periodEnd">;

function dayNumber(isoDay: string): number {
  const [y, m, d] = isoDay.split("-").map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

/** Plus longue suite de jours consécutifs. */
export function longestDayRun(days: Iterable<string>): number {
  const sorted = [...new Set(days)].map(dayNumber).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const n of sorted) {
    run = n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }
  return best;
}

export function inChallengePeriod(event: Pick<ParloEvent, "occurredAt">, spec: Pick<ChallengeSpec, "periodStart" | "periodEnd">): boolean {
  const t = Date.parse(event.occurredAt);
  return t >= Date.parse(spec.periodStart) && t < Date.parse(spec.periodEnd);
}

/** Mots (concepts `word`) introduits par les leçons d'une unité. */
function unitWords(content: ContentIndex, unit: UnitId): Map<LessonId, ConceptId[]> {
  const lessons = content.curriculum.units.find((u) => u.id === unit)?.lessons ?? [];
  return new Map(
    lessons.map((id) => [id, (content.lessons.get(id)?.review.srsIntroduce ?? []).filter((c) => content.concepts.get(c)?.type === "word")]),
  );
}

/**
 * Progression d'un défi à partir des événements (ordre indifférent).
 * `content` n'est nécessaire que pour `words_theme`.
 */
export function challengeProgress(spec: ChallengeSpec, events: readonly ParloEvent[], content?: ContentIndex): number {
  const mine = events.filter((e) => inChallengePeriod(e, spec));
  switch (spec.kind) {
    case "words_theme": {
      if (!content || !spec.unit) return 0;
      const words = unitWords(content, spec.unit);
      const learned = new Set<ConceptId>();
      for (const e of mine) if (e.type === "lesson_completed") for (const c of words.get(e.payload.lessonId) ?? []) learned.add(c);
      return learned.size;
    }
    case "streak_days":
      return longestDayRun(mine.flatMap((e) => (e.type === "session_completed" ? [e.payload.localDate] : [])));
    case "speaking_minutes": {
      // Même règle que l'API : 10 s par prononciation notée, 20 s par tour de conversation.
      const items = mine.filter((e) => e.type === "pronunciation_scored").length;
      const turns = mine.filter((e) => e.type === "conversation_turn").length;
      return Math.floor((items * SPEAKING_SECONDS_PER_ITEM + turns * SPEAKING_SECONDS_PER_TURN) / 60);
    }
    case "lessons":
      return mine.filter((e) => e.type === "lesson_completed").length;
    case "game_score":
      return mine.filter((e) => e.type === "game_played" && e.payload.total > 0 && e.payload.correct / e.payload.total >= GAME_PASS_RATIO).length;
  }
}

/**
 * Progression optimiste d'un défi serveur : progression connue + événements
 * pas encore synchronisés (l'outbox ne contient que ceux-là, pas de double compte).
 * Une série ne s'additionne pas : on garde le maximum.
 */
export function optimisticProgress(challenge: Challenge, pending: readonly ParloEvent[], content?: ContentIndex): number {
  const local = challengeProgress(challenge, pending, content);
  const value = challenge.kind === "streak_days" ? Math.max(challenge.progress, local) : challenge.progress + local;
  return Math.min(challenge.target, value);
}

// ---------------------------------------------------------------------------
// Défi local (invité, jamais synchronisé) : rotation déterministe par semaine UTC.

/** Lundi 00:00 UTC de la semaine de `now`. */
export function challengeWeekStart(now: Date): Date {
  const day = (now.getUTCDay() + 6) % 7; // lundi = 0
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
}

const LOCAL_ROTATION: { kind: ChallengeKind; target: number }[] = [
  { kind: "lessons", target: 5 },
  { kind: "streak_days", target: 5 },
  { kind: "words_theme", target: 10 },
  { kind: "game_score", target: 3 },
  { kind: "speaking_minutes", target: 5 },
];

export function localChallengeSpec(now: Date, content?: ContentIndex, completed: ReadonlySet<LessonId> = new Set()): ChallengeSpec & { id: string; badgeCode: string } {
  const start = challengeWeekStart(now);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const week = Math.floor(start.getTime() / (7 * 86_400_000));
  let pick = LOCAL_ROTATION[week % LOCAL_ROTATION.length] ?? { kind: "lessons" as const, target: 5 };
  let unit: UnitId | null = null;
  if (pick.kind === "words_theme") {
    // L'unité en cours : la première qui n'est pas terminée.
    unit = content?.curriculum.units.find((u) => u.status === "available" && u.lessons.some((id) => !completed.has(id)))?.id ?? null;
    if (!unit) pick = { kind: "lessons", target: 5 };
  }
  const id = `local-${start.toISOString().slice(0, 10)}`;
  return { id, kind: pick.kind, target: pick.target, unit, periodStart: start.toISOString(), periodEnd: end.toISOString(), badgeCode: `challenge_${pick.kind}` };
}
