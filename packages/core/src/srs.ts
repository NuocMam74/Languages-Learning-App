import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from "ts-fsrs";
import type { ConceptId, StepType } from "./types.ts";

/**
 * Encapsulation de ts-fsrs (ADR 0003). Le reste du code ne manipule que
 * `SrsCard`, sérialisable tel quel en IndexedDB et en JSON pour l'API.
 */

export type SrsState = "new" | "learning" | "review" | "relearning";
export type SrsRating = "again" | "hard" | "good" | "easy";

export interface SrsCard {
  conceptId: ConceptId;
  /** ISO 8601 */
  due: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: SrsState;
  /** ISO 8601 */
  lastReview: string | null;
}

const STATE_TO_NAME: Record<State, SrsState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};
const NAME_TO_STATE: Record<SrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const RATING: Record<SrsRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const scheduler = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: true }));

function toFsrs(card: SrsCard): Card {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: 0,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: NAME_TO_STATE[card.state],
    ...(card.lastReview ? { last_review: new Date(card.lastReview) } : {}),
  };
}

function fromFsrs(conceptId: ConceptId, card: Card): SrsCard {
  return {
    conceptId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_NAME[card.state],
    lastReview: card.last_review ? card.last_review.toISOString() : null,
  };
}

export function newCard(conceptId: ConceptId, now: Date): SrsCard {
  return fromFsrs(conceptId, createEmptyCard(now));
}

export function review(card: SrsCard, rating: SrsRating, now: Date): SrsCard {
  const { card: next } = scheduler.next(toFsrs(card), now, RATING[rating]);
  return fromFsrs(card.conceptId, next);
}

export function isDue(card: SrsCard, now: Date): boolean {
  return card.state !== "new" && new Date(card.due).getTime() <= now.getTime();
}

/** Carte considérée comme maîtrisée (utilisée pour le bloc « Réveil »). */
export function isMastered(card: SrsCard): boolean {
  return card.state === "review" && card.stability >= 7 && card.lapses <= 2;
}

/** Résolution de conflit de sync : l'état le plus avancé gagne (ADR 0003). */
export function mergeCards(a: SrsCard, b: SrsCard): SrsCard {
  if (a.reps !== b.reps) return a.reps > b.reps ? a : b;
  const ta = a.lastReview ? Date.parse(a.lastReview) : 0;
  const tb = b.lastReview ? Date.parse(b.lastReview) : 0;
  return tb > ta ? b : a;
}

/**
 * Poids d'un format : une production orale réussie prouve plus qu'un QCM.
 * `expectedMs` = temps de réponse « confortable » pour ce format.
 */
const FORMAT_PROFILE: Partial<Record<StepType, { weight: "recognition" | "recall" | "production"; expectedMs: number }>> = {
  listen_pick_image: { weight: "recognition", expectedMs: 4000 },
  listen_pick_text: { weight: "recognition", expectedMs: 5000 },
  tone_identify: { weight: "recognition", expectedMs: 5000 },
  tone_minimal_pair: { weight: "recognition", expectedMs: 4000 },
  spot_the_south: { weight: "recognition", expectedMs: 5000 },
  match_pairs: { weight: "recognition", expectedMs: 12000 },
  fill_gap: { weight: "recall", expectedMs: 8000 },
  build_sentence: { weight: "recall", expectedMs: 12000 },
  listen_transcribe: { weight: "recall", expectedMs: 12000 },
  translate_to_vi: { weight: "recall", expectedMs: 15000 },
  translate_to_fr: { weight: "recall", expectedMs: 12000 },
  speak_repeat: { weight: "production", expectedMs: 8000 },
  tone_produce: { weight: "production", expectedMs: 8000 },
};

export interface RatingInput {
  correct: boolean;
  /** Réponse presque juste (erreur de ton seule) : ni échec total, ni réussite. */
  nearMiss?: boolean;
  responseMs: number;
  format: StepType;
}

/** Note FSRS dérivée automatiquement ; l'utilisateur ne note jamais lui-même. */
export function deriveRating({ correct, nearMiss = false, responseMs, format }: RatingInput): SrsRating {
  if (!correct) return nearMiss ? "hard" : "again";
  const profile = FORMAT_PROFILE[format] ?? { weight: "recognition", expectedMs: 6000 };
  const ratio = responseMs / profile.expectedMs;
  if (ratio > 2) return "hard";
  if (profile.weight === "recognition") return "good";
  // Rappel ou production réussis vite : preuve forte.
  return ratio <= 0.6 ? "easy" : "good";
}
