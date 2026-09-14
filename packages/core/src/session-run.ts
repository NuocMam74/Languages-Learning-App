import { currentItem, isFinished, startLesson, type Evaluation, type Exercise, type LessonRun } from "./engine.ts";
import type { SessionSource } from "./events.ts";
import { XP_REVIEW } from "./progress.ts";
import type { SessionPlan } from "./session.ts";
import type { ConceptId, ContentIndex, Lesson, StepType } from "./types.ts";

/**
 * Déroulé d'une séance complète (spec §4.3), sérialisable en JSON : le snapshot
 * local couvre toute la séance (réveil, révisions, leçon, mise en pratique),
 * pas seulement la leçon, pour une reprise exacte (spec §3.6).
 */

export type ReviewBlockKind = "warmup" | "review";

export interface ReviewItem {
  conceptId: ConceptId;
  block: ReviewBlockKind;
  attempt: number;
}

export interface ReviewResult extends ReviewItem {
  /** Position dans la file de révision (graine de l'exercice, stepIndex de l'événement). */
  index: number;
  format: StepType;
  correct: boolean;
  nearMiss: boolean;
  graded: boolean;
  responseMs: number;
}

export interface SessionRun {
  sessionId: string;
  source: SessionSource;
  plan: SessionPlan;
  reviewQueue: ReviewItem[];
  reviewCursor: number;
  reviewResults: ReviewResult[];
  /** Concepts connus au démarrage : distracteurs stables à la reprise. */
  knownAtStart: ConceptId[];
  lesson: LessonRun | null;
  /** La partie leçon a été enregistrée (cartes SRS, progression). */
  lessonSaved: boolean;
  learned: ConceptId[];
  xp: number;
  startedAt: string;
}

export type SessionPhase =
  | { kind: "warmup" | "review"; item: ReviewItem; index: number }
  | { kind: "new" | "practice"; lesson: LessonRun }
  | { kind: "save_lesson"; lesson: LessonRun }
  | { kind: "recap" };

export function startSessionRun(input: {
  plan: SessionPlan;
  sessionId: string;
  source: SessionSource;
  lesson: Lesson | null;
  known: readonly ConceptId[];
  now: Date;
}): SessionRun {
  const { plan, sessionId, source, lesson, known, now } = input;
  const reviewQueue: ReviewItem[] = [];
  let hasNew = false;
  for (const block of plan.blocks) {
    if (block.kind === "warmup" || block.kind === "review") {
      for (const conceptId of block.conceptIds) reviewQueue.push({ conceptId, block: block.kind, attempt: 1 });
    }
    if (block.kind === "new") hasNew = true;
  }
  return {
    sessionId,
    source,
    plan,
    reviewQueue,
    reviewCursor: 0,
    reviewResults: [],
    knownAtStart: [...known],
    lesson: hasNew && lesson ? startLesson(lesson, sessionId, now) : null,
    lessonSaved: false,
    learned: [],
    xp: 0,
    startedAt: now.toISOString(),
  };
}

export function sessionPhase(run: SessionRun, content: ContentIndex): SessionPhase {
  const item = run.reviewQueue[run.reviewCursor];
  if (item) return { kind: item.block, item, index: run.reviewCursor };
  if (run.lesson && !run.lessonSaved) {
    if (isFinished(run.lesson)) return { kind: "save_lesson", lesson: run.lesson };
    const step = currentItem(run.lesson);
    const type = step ? content.lessons.get(run.lesson.lessonId)?.steps[step.stepIndex]?.type : undefined;
    return { kind: type === "game" ? "practice" : "new", lesson: run.lesson };
  }
  return { kind: "recap" };
}

export const REVIEW_MAX_ATTEMPTS = 2;

/** Graine d'un exercice de révision : même séance + même position = même exercice. */
export function reviewSeed(run: SessionRun, index: number): string {
  const item = run.reviewQueue[index];
  return `${run.sessionId}:r${index}:${item?.attempt ?? 1}`;
}

export function recordReviewResult(run: SessionRun, exercise: Exercise, evaluation: Evaluation, responseMs: number): SessionRun {
  const item = run.reviewQueue[run.reviewCursor];
  if (!item) return run;
  const result: ReviewResult = {
    ...item,
    index: run.reviewCursor,
    format: exercise.type === "unsupported" ? exercise.stepType : exercise.type,
    correct: evaluation.correct,
    nearMiss: evaluation.nearMiss,
    graded: evaluation.graded,
    responseMs,
  };
  const queue = [...run.reviewQueue];
  // Une erreur revient en fin de révision, sans interrompre (spec §4.5).
  if (evaluation.graded && !evaluation.correct && item.attempt < REVIEW_MAX_ATTEMPTS) {
    queue.push({ conceptId: item.conceptId, block: "review", attempt: item.attempt + 1 });
  }
  const xp = evaluation.graded && evaluation.correct && item.attempt === 1 ? XP_REVIEW : 0;
  return { ...run, reviewQueue: queue, reviewCursor: run.reviewCursor + 1, reviewResults: [...run.reviewResults, result], xp: run.xp + xp };
}

/** Items joués (révisions + étapes de leçon) : sert de curseur global. */
export function sessionItemsDone(run: SessionRun): number {
  return run.reviewCursor + (run.lesson?.cursor ?? 0);
}

/** Items restants connus (relances comprises), pour la barre de progression. */
export function sessionItemsRemaining(run: SessionRun): number {
  const reviews = run.reviewQueue.length - run.reviewCursor;
  const lesson = run.lesson && !run.lessonSaved ? run.lesson.queue.length - run.lesson.cursor : 0;
  return Math.max(0, reviews) + Math.max(0, lesson);
}

/** Concepts révisés avec succès (premier essai) pendant la séance. */
export function reviewedConcepts(run: SessionRun): ConceptId[] {
  return [...new Set(run.reviewResults.filter((r) => r.attempt === 1 && r.graded && r.correct).map((r) => r.conceptId))];
}
