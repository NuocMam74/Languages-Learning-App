import type { SessionRun } from "../session-run.ts";
import type { ConceptId, Lesson, StepType } from "../types.ts";
import { TONAL_STEP_TYPES } from "../types.ts";
import type { Counters } from "./counters.ts";

/**
 * Compteurs d'une séance terminée (contrat phase9 §1) : on **dérive** ce qui vient de se passer de
 * ce que la séance a déjà produit — aucun compteur n'est incrémenté à la volée pendant qu'on
 * répond, donc rien ne peut être compté deux fois à la reprise d'une séance interrompue.
 *
 * Fonction pure : `learner.ts` l'appelle avec l'état qu'il vient d'enregistrer.
 */

/** Formats notés à la voix (production orale, spec §4.4). */
export const SPEAKING_STEP_TYPES: ReadonlySet<StepType> = new Set<StepType>(["speak_repeat", "speak_answer", "speak_roleplay", "tone_produce"]);

export interface SessionCountersInput {
  run: SessionRun;
  /** Leçon de la séance, si elle en avait une. */
  lesson?: Lesson | null | undefined;
  /** Leçon effectivement terminée et enregistrée. */
  lessonCompleted: boolean;
  /** XP créditée (déjà écrêtée). */
  xp: number;
  itemsCount: number;
  durationMs: number;
  /** Concepts appris pour la première fois. */
  learned: readonly ConceptId[];
}

export function sessionCounters(input: SessionCountersInput): Counters {
  const { run, lesson, lessonCompleted } = input;
  const lessonResults = run.lesson?.results ?? [];
  const formats = new Map((lesson?.steps ?? []).map((step, index) => [index, step.type] as const));
  const lessonFormat = (stepIndex: number): StepType | undefined => formats.get(stepIndex);

  const graded = lessonResults.filter((result) => result.graded);
  const firstTries = graded.filter((result) => result.attempt === 1);
  const reviewGraded = run.reviewResults.filter((result) => result.graded);

  const correct = firstTries.filter((result) => result.correct).length + reviewGraded.filter((result) => result.correct).length;
  const reviewItems = reviewGraded.filter((result) => result.correct && result.block === "review").length;

  const isTone = (format: StepType | undefined) => format !== undefined && TONAL_STEP_TYPES.has(format);
  const isSpeaking = (format: StepType | undefined) => format !== undefined && SPEAKING_STEP_TYPES.has(format);
  const toneItems = firstTries.filter((r) => isTone(lessonFormat(r.stepIndex))).length + reviewGraded.filter((r) => isTone(r.format)).length;
  const speakItems = firstTries.filter((r) => isSpeaking(lessonFormat(r.stepIndex))).length + reviewGraded.filter((r) => isSpeaking(r.format)).length;

  // Sans faute : la leçon est allée au bout et chaque item noté a été juste **du premier coup**.
  const perfect = lessonCompleted && firstTries.length > 0 && firstTries.every((result) => result.correct);

  const counters: Counters = {
    sessions: 1,
    items: Math.max(0, Math.round(input.itemsCount)),
    correct,
    xp: Math.max(0, Math.round(input.xp)),
    minutes: Math.max(0, Math.round(input.durationMs / 60_000)),
    ...(lessonCompleted ? { lessons: 1 } : {}),
    ...(perfect ? { perfectLessons: 1 } : {}),
    ...(reviewItems > 0 ? { reviewItems } : {}),
    ...(input.learned.length > 0 ? { newWords: input.learned.length } : {}),
    ...(toneItems > 0 ? { toneItems } : {}),
    ...(speakItems > 0 ? { speakItems } : {}),
  };
  // Les métriques nulles ne sont pas écrites : le journal reste petit (voir `addCounters`).
  return Object.fromEntries(Object.entries(counters).filter(([, value]) => value !== 0)) as Counters;
}
