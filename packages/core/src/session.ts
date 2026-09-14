import { isDue, isMastered, type SrsCard } from "./srs.ts";
import type { ConceptId, Curriculum, Lesson, LessonId } from "./types.ts";

/**
 * Planification d'une séance (spec §4.3) :
 *   Réveil (30 s) → Rappel espacé → Nouveau → Mise en pratique → Bilan (20 s)
 * La durée annoncée est un plafond : les révisions en trop glissent au lendemain.
 */

export const WARMUP_SECONDS = 30;
export const RECAP_SECONDS = 20;
export const WARMUP_ITEMS = 3;
/** Durée moyenne d'un item de révision, feedback compris. */
export const REVIEW_ITEM_SECONDS = 15;
/** Tolérance de dépassement de la durée annoncée (critère d'acceptation : ±20 %). */
export const OVERRUN_TOLERANCE = 0.2;

export type SessionBlock =
  | { kind: "warmup"; conceptIds: ConceptId[] }
  | { kind: "review"; conceptIds: ConceptId[]; deferred: number }
  | { kind: "new"; lessonId: LessonId }
  | { kind: "recap" };

export interface SessionPlan {
  blocks: SessionBlock[];
  estimatedSeconds: number;
}

export interface PlanInput {
  targetMinutes: number;
  cards: readonly SrsCard[];
  nextLesson: Lesson | null;
  now: Date;
}

export function planSession({ targetMinutes, cards, nextLesson, now }: PlanInput): SessionPlan {
  const budget = targetMinutes * 60;
  const blocks: SessionBlock[] = [];
  let used = RECAP_SECONDS;

  const due = cards.filter((c) => isDue(c, now)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const dueIds = new Set(due.map((c) => c.conceptId));

  const warmup = cards
    .filter((c) => isMastered(c) && !dueIds.has(c.conceptId))
    .sort((a, b) => b.stability - a.stability)
    .slice(0, WARMUP_ITEMS)
    .map((c) => c.conceptId);
  if (warmup.length > 0) {
    blocks.push({ kind: "warmup", conceptIds: warmup });
    used += WARMUP_SECONDS;
  }

  const lessonSeconds = nextLesson ? nextLesson.estimatedMinutes * 60 : 0;
  // Le nouveau n'entre que s'il tient dans le budget (avec tolérance), ou s'il n'y a rien à réviser.
  const includeLesson =
    nextLesson !== null && (due.length === 0 || used + lessonSeconds <= budget * (1 + OVERRUN_TOLERANCE));

  const reviewBudget = Math.max(0, budget - used - (includeLesson ? lessonSeconds : 0));
  const reviewCount = Math.min(due.length, Math.floor(reviewBudget / REVIEW_ITEM_SECONDS));
  if (reviewCount > 0) {
    blocks.push({ kind: "review", conceptIds: due.slice(0, reviewCount).map((c) => c.conceptId), deferred: due.length - reviewCount });
    used += reviewCount * REVIEW_ITEM_SECONDS;
  }

  if (includeLesson && nextLesson) {
    blocks.push({ kind: "new", lessonId: nextLesson.id });
    used += lessonSeconds;
  }

  blocks.push({ kind: "recap" });
  return { blocks, estimatedSeconds: used };
}

/**
 * Prochaine leçon disponible : toutes ses conditions remplies, non terminée,
 * dans une unité publiée. Le parcours du profil (famille, voyage…) trie les
 * unités par tags : un seul corpus, plusieurs chemins (spec §6.2).
 */
export function nextLesson(
  curriculum: Curriculum,
  lessons: ReadonlyMap<LessonId, Lesson>,
  completed: ReadonlySet<LessonId>,
  path: string | null,
): Lesson | null {
  const boost = new Set(path ? (curriculum.paths[path]?.boostTags ?? []) : []);
  const units = curriculum.units
    .map((unit, order) => ({ unit, order, boosted: (unit.tags ?? []).some((t) => boost.has(t)) }))
    .filter(({ unit }) => unit.status === "available");

  // Unités boostées d'abord ; les prérequis empêchent de sauter le socle.
  units.sort((a, b) => Number(b.boosted) - Number(a.boosted) || a.order - b.order);

  for (const { unit } of units) {
    for (const lessonId of unit.lessons) {
      if (completed.has(lessonId)) continue;
      const lesson = lessons.get(lessonId);
      if (!lesson) continue;
      if (lesson.prerequisites.every((p) => completed.has(p))) return lesson;
    }
  }
  return null;
}
