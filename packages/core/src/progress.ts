import type { LessonRun, StepResult } from "./engine.ts";
import { deriveRating, newCard, review, type SrsCard, type SrsRating } from "./srs.ts";
import type { ConceptId, Lesson, StepType } from "./types.ts";

/**
 * Conséquences pédagogiques d'une leçon terminée : cartes SRS et XP (spec §5.1).
 */

export const XP_NEW_ITEM = 10;
export const XP_REVIEW = 5;
export const XP_SESSION_BONUS = 20;

/** Note agrégée d'un concept sur les premiers essais d'une leçon. */
export function conceptRating(results: readonly StepResult[], conceptId: ConceptId, formats: ReadonlyMap<number, StepType>): SrsRating {
  const firsts = results.filter((r) => r.attempt === 1 && r.graded && r.conceptIds.includes(conceptId));
  if (firsts.length === 0) return "good";
  const ratings = firsts.map((r) =>
    deriveRating({ correct: r.correct, nearMiss: r.nearMiss, responseMs: r.responseMs, format: formats.get(r.stepIndex) ?? "listen_pick_text" }),
  );
  if (ratings.includes("again")) return firsts.some((r) => r.correct) ? "hard" : "again";
  if (ratings.includes("hard")) return "hard";
  return ratings.every((r) => r === "easy") ? "easy" : "good";
}

export interface LessonOutcome {
  cards: SrsCard[];
  xp: number;
  /** Concepts introduits pour la première fois et réussis. */
  learned: ConceptId[];
}

export function completeLesson(
  lesson: Lesson,
  run: LessonRun,
  existing: ReadonlyMap<ConceptId, SrsCard>,
  now: Date,
): LessonOutcome {
  const formats = new Map(lesson.steps.map((s, i) => [i, s.type]));
  const cards: SrsCard[] = [];
  const learned: ConceptId[] = [];

  for (const conceptId of lesson.review.srsIntroduce) {
    const prior = existing.get(conceptId);
    const rating = conceptRating(run.results, conceptId, formats);
    cards.push(review(prior ?? newCard(conceptId, now), rating, now));
    if (!prior && rating !== "again") learned.push(conceptId);
  }

  return { cards, xp: learned.length * XP_NEW_ITEM, learned };
}

/** Révision isolée (blocs Réveil et Rappel espacé). */
export function reviewConcept(
  card: SrsCard,
  input: { correct: boolean; nearMiss: boolean; responseMs: number; format: StepType },
  now: Date,
): { card: SrsCard; xp: number } {
  const rating = deriveRating(input);
  return { card: review(card, rating, now), xp: input.correct ? XP_REVIEW : 0 };
}
