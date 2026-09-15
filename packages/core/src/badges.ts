import type { SrsCard } from "./srs.ts";
import type { Streak } from "./streak.ts";
import type { ConceptId, Curriculum, LessonId, PackFeature, StepType, UnitId } from "./types.ts";

/**
 * Badges (spec §5.4, contrat phase5 §3). Les critères sont évalués après chaque séance,
 * à partir de l'état local ; un badge gagné ne se perd jamais. Évaluation identique côté API.
 * Les badges de défi `challenge_*` sont attribués par le serveur seulement.
 */

export const BADGE_CODES = [
  "first_lesson",
  "streak_7",
  "streak_30",
  "streak_100",
  "streak_365",
  "unit_1_done",
  "words_50",
  "words_500",
  "tone_ear",
  "no_north_accent",
  "culture_explorer",
  "culture_unit",
] as const;
export type BadgeCode = (typeof BADGE_CODES)[number];

export type BadgeFamily = "assiduity" | "skill" | "culture";
export const BADGE_FAMILY: Record<BadgeCode, BadgeFamily> = {
  first_lesson: "assiduity",
  streak_7: "assiduity",
  streak_30: "assiduity",
  streak_100: "assiduity",
  streak_365: "assiduity",
  unit_1_done: "skill",
  words_50: "skill",
  words_500: "skill",
  tone_ear: "skill",
  no_north_accent: "skill",
  culture_explorer: "culture",
  culture_unit: "culture",
};

export const WORDS_BADGE_COUNT = 50;
export const WORDS_500_BADGE_COUNT = 500;
/** « Oreille tonale » : ≥ 95 % de réussite sur les 50 derniers items de tons. */
export const TONE_EAR_WINDOW = 50;
export const TONE_EAR_RATIO = 0.95;
/** « Sans accent du Nord » : ≥ 95 % sur les 30 derniers `spot_the_south`. */
export const NO_NORTH_WINDOW = 30;
export const NO_NORTH_RATIO = 0.95;
/** « Explorateur de culture » : 20 cartes culture différentes réussies. */
export const CULTURE_EXPLORER_COUNT = 20;
/** Tag d'unité culturelle (badge culture_unit). */
export const CULTURE_UNIT_TAG = "culture";
/** Préfixe des badges de défi (serveur seulement). */
export const CHALLENGE_BADGE_PREFIX = "challenge_";

export const TONE_EXERCISE_TYPES: ReadonlySet<StepType> = new Set(["tone_identify", "tone_minimal_pair", "tone_produce"]);

export interface BadgeInput {
  curriculum: Curriculum;
  completedLessons: ReadonlySet<LessonId>;
  streak: Streak;
  /** Nombre de mots connus (voir countKnownWords). */
  knownWords: number;
  /** Résultats des derniers items de tons, du plus ancien au plus récent. */
  toneLog: readonly boolean[];
  /** Résultats des derniers `spot_the_south`, du plus ancien au plus récent. */
  southLog?: readonly boolean[];
  /** Nombre de cartes culture différentes réussies. */
  cultureCardsPassed?: number;
  /** Unités dont le test est réussi (ou sautées au placement). */
  passedUnits?: ReadonlySet<UnitId>;
  /** Fonctionnalités du pack : sans « tones », le badge d'oreille tonale ne s'applique pas. */
  features?: readonly PackFeature[];
}

/** Badges qui ont un sens pour ce pack (ordre de BADGE_CODES). */
export function badgeCodesFor(pack: { features: readonly PackFeature[] }): BadgeCode[] {
  return BADGE_CODES.filter(
    (code) => (code !== "tone_ear" || pack.features.includes("tones")) && (code !== "no_north_accent" || pack.features.includes("lexical_variants")),
  );
}

export function isChallengeBadge(code: string): boolean {
  return code.startsWith(CHALLENGE_BADGE_PREFIX);
}

/** Ajoute un résultat au journal des tons en gardant la fenêtre utile. */
export function pushToneResult(log: readonly boolean[], correct: boolean): boolean[] {
  return [...log, correct].slice(-TONE_EAR_WINDOW);
}

/** Ajoute un résultat au journal des `spot_the_south`. */
export function pushSouthResult(log: readonly boolean[], correct: boolean): boolean[] {
  return [...log, correct].slice(-NO_NORTH_WINDOW);
}

/** Mots (concepts de type word) ayant une carte SRS au-delà de l'état « new ». */
export function countKnownWords(cards: readonly SrsCard[], wordIds: ReadonlySet<ConceptId>): number {
  return cards.filter((c) => c.state !== "new" && wordIds.has(c.conceptId)).length;
}

function windowRatio(log: readonly boolean[] | undefined, size: number, ratio: number): boolean {
  const window = (log ?? []).slice(-size);
  return window.length >= size && window.filter(Boolean).length / window.length >= ratio;
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
    case "streak_100":
      return bestStreak >= 100;
    case "streak_365":
      return bestStreak >= 365;
    case "unit_1_done": {
      const unit = input.curriculum.units[0];
      return unit !== undefined && unit.lessons.length > 0 && unit.lessons.every((id) => input.completedLessons.has(id));
    }
    case "words_50":
      return input.knownWords >= WORDS_BADGE_COUNT;
    case "words_500":
      return input.knownWords >= WORDS_500_BADGE_COUNT;
    case "tone_ear":
      return windowRatio(input.toneLog, TONE_EAR_WINDOW, TONE_EAR_RATIO);
    case "no_north_accent":
      return windowRatio(input.southLog, NO_NORTH_WINDOW, NO_NORTH_RATIO);
    case "culture_explorer":
      return (input.cultureCardsPassed ?? 0) >= CULTURE_EXPLORER_COUNT;
    case "culture_unit": {
      const passed = input.passedUnits;
      return passed !== undefined && input.curriculum.units.some((u) => (u.tags ?? []).includes(CULTURE_UNIT_TAG) && passed.has(u.id));
    }
  }
}

/** Badges nouvellement gagnés (ordre stable de BADGE_CODES). */
export function evaluateBadges(input: BadgeInput, earned: ReadonlySet<string>): BadgeCode[] {
  const applicable: readonly BadgeCode[] = input.features ? badgeCodesFor({ features: input.features }) : BADGE_CODES;
  return applicable.filter((code) => !earned.has(code) && criterion(code, input));
}
