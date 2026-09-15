import type { SrsCard } from "./srs.ts";
import type { Streak } from "./streak.ts";
import type { ConceptId, Curriculum, LessonId, PackFeature, StepType } from "./types.ts";

/**
 * Badges de la Phase 1 (spec §5.4). Les critères sont évalués après chaque
 * séance, à partir de l'état local ; un badge gagné ne se perd jamais.
 */

export const BADGE_CODES = ["first_lesson", "streak_7", "streak_30", "unit_1_done", "words_50", "tone_ear"] as const;
export type BadgeCode = (typeof BADGE_CODES)[number];

export type BadgeFamily = "assiduity" | "skill";
export const BADGE_FAMILY: Record<BadgeCode, BadgeFamily> = {
  first_lesson: "assiduity",
  streak_7: "assiduity",
  streak_30: "assiduity",
  unit_1_done: "skill",
  words_50: "skill",
  tone_ear: "skill",
};

export const WORDS_BADGE_COUNT = 50;
/** « Oreille tonale » : ≥ 95 % de réussite sur les 50 derniers items de tons. */
export const TONE_EAR_WINDOW = 50;
export const TONE_EAR_RATIO = 0.95;

export const TONE_EXERCISE_TYPES: ReadonlySet<StepType> = new Set(["tone_identify", "tone_minimal_pair", "tone_produce"]);

export interface BadgeInput {
  curriculum: Curriculum;
  completedLessons: ReadonlySet<LessonId>;
  streak: Streak;
  /** Nombre de mots connus (voir countKnownWords). */
  knownWords: number;
  /** Résultats des derniers items de tons, du plus ancien au plus récent. */
  toneLog: readonly boolean[];
  /** Fonctionnalités du pack : sans « tones », le badge d'oreille tonale ne s'applique pas. */
  features?: readonly PackFeature[];
}

/** Badges qui ont un sens pour ce pack (ordre de BADGE_CODES). */
export function badgeCodesFor(pack: { features: readonly PackFeature[] }): BadgeCode[] {
  return BADGE_CODES.filter((code) => code !== "tone_ear" || pack.features.includes("tones"));
}

/** Ajoute un résultat au journal des tons en gardant la fenêtre utile. */
export function pushToneResult(log: readonly boolean[], correct: boolean): boolean[] {
  return [...log, correct].slice(-TONE_EAR_WINDOW);
}

/** Mots (concepts de type word) ayant une carte SRS au-delà de l'état « new ». */
export function countKnownWords(cards: readonly SrsCard[], wordIds: ReadonlySet<ConceptId>): number {
  return cards.filter((c) => c.state !== "new" && wordIds.has(c.conceptId)).length;
}

function criterion(code: BadgeCode, input: BadgeInput): boolean {
  const bestStreak = Math.max(input.streak.current, input.streak.longest);
  switch (code) {
    case "first_lesson":
      return input.completedLessons.size >= 1;
    case "streak_7":
      return bestStreak >= 7;
    case "streak_30":
      return bestStreak >= 30;
    case "unit_1_done": {
      const unit = input.curriculum.units[0];
      return unit !== undefined && unit.lessons.length > 0 && unit.lessons.every((id) => input.completedLessons.has(id));
    }
    case "words_50":
      return input.knownWords >= WORDS_BADGE_COUNT;
    case "tone_ear": {
      const window = input.toneLog.slice(-TONE_EAR_WINDOW);
      return window.length >= TONE_EAR_WINDOW && window.filter(Boolean).length / window.length >= TONE_EAR_RATIO;
    }
  }
}

/** Badges nouvellement gagnés (ordre stable de BADGE_CODES). */
export function evaluateBadges(input: BadgeInput, earned: ReadonlySet<string>): BadgeCode[] {
  const applicable: readonly BadgeCode[] = input.features ? badgeCodesFor({ features: input.features }) : BADGE_CODES;
  return applicable.filter((code) => !earned.has(code) && criterion(code, input));
}
