import { currentItem, isFinished, startLesson, type Evaluation, type Exercise, type LessonRun } from "./engine.ts";
import type { SessionSource } from "./events.ts";
import { isBriefingEmpty, type Briefing } from "./prerequisites.ts";
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

/**
 * Mode d'une séance (contrat phase8 §2). `practice` : on rejoue une leçon **déjà terminée** depuis la
 * bibliothèque « Réviser ». Le déroulé est identique, mais les conséquences ne le sont pas :
 *   - le SRS reçoit bien les réponses (c'est l'intérêt de refaire la leçon) ;
 *   - la progression n'est pas recomptée : ni `lessonProgress`, ni XP, ni série, ni badges ;
 *   - côté événements : `session_started` et `answer_submitted` comme d'habitude (ce qui s'est
 *     vraiment passé), mais **ni `lesson_completed` ni `session_completed`** — ce sont eux que le
 *     serveur agrège (XP, ligue, série, leçons acquises) et les émettre, fût-ce à 0, compterait
 *     une seconde fois une leçon déjà acquise.
 */
export type SessionMode = "normal" | "practice";

export interface SessionRun {
  sessionId: string;
  source: SessionSource;
  /** Absent = `normal` (toutes les séances écrites avant le contrat phase8). */
  mode?: SessionMode;
  plan: SessionPlan;
  reviewQueue: ReviewItem[];
  reviewCursor: number;
  reviewResults: ReviewResult[];
  /** Concepts connus au démarrage : distracteurs stables à la reprise. */
  knownAtStart: ConceptId[];
  lesson: LessonRun | null;
  /** La partie leçon a été enregistrée (cartes SRS, progression). */
  lessonSaved: boolean;
  /**
   * La fiche de préparation a été consultée (contrat phase10 §1, élargi phase16 §2). Absent = pas
   * encore vue, donc les séances écrites avant ce contrat la montrent une fois à la reprise — sans
   * conséquence.
   */
  taught?: boolean;
  /**
   * Ce qu'il faut avoir consulté avant les exercices (contrat phase16 §2), figé au démarrage comme
   * `knownAtStart` : une reprise retrouve exactement la même fiche, même si on a révisé entre-temps.
   * Absent = séance écrite avant ce contrat ; la fiche retombe alors sur les seuls mots introduits.
   */
  briefing?: Briefing;
  learned: ConceptId[];
  xp: number;
  startedAt: string;
  /** Version du pack au démarrage : la reprise reste possible après une mise à jour du contenu. */
  contentVersion?: number;
}

export type SessionPhase =
  | { kind: "warmup" | "review"; item: ReviewItem; index: number }
  /**
   * Préparation : on **présente tout ce que les exercices vont exiger** avant de faire pratiquer
   * (contrat phase10 §1, élargi phase16 §2) — les mots neufs, ceux qu'on réutilise, les phrases
   * modèles, les fiches à lire et les consignes des formats jamais rencontrés. Ce n'est pas un
   * item : elle ne compte ni dans la barre de progression, ni dans le SRS, ni dans les événements.
   */
  | { kind: "teach"; lesson: LessonRun; briefing: Briefing }
  | { kind: "new" | "practice"; lesson: LessonRun }
  | { kind: "save_lesson"; lesson: LessonRun }
  | { kind: "recap" };

/** Séance d'entraînement : on rejoue sans rien recompter (contrat phase8 §2). */
export function isPracticeRun(run: Pick<SessionRun, "mode">): boolean {
  return run.mode === "practice";
}

export function startSessionRun(input: {
  plan: SessionPlan;
  sessionId: string;
  source: SessionSource;
  lesson: Lesson | null;
  known: readonly ConceptId[];
  now: Date;
  /** Défaut : `normal`. */
  mode?: SessionMode;
  /** Ce qu'il faut consulter avant les exercices (contrat phase16 §2). */
  briefing?: Briefing;
  /** Étapes jouables de la leçon (voir playableStepIndexes) ; défaut : toutes. */
  playable?: readonly number[];
  /** Version du contenu au démarrage (contrat phase5 §6). */
  contentVersion?: number;
}): SessionRun {
  const { plan, sessionId, source, lesson, known, now, playable, contentVersion, mode, briefing } = input;
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
    ...(mode && mode !== "normal" ? { mode } : {}),
    plan,
    reviewQueue,
    reviewCursor: 0,
    reviewResults: [],
    knownAtStart: [...known],
    lesson: hasNew && lesson ? startLesson(lesson, sessionId, now, playable) : null,
    lessonSaved: false,
    learned: [],
    xp: 0,
    ...(briefing && !isBriefingEmpty(briefing) ? { briefing } : {}),
    startedAt: now.toISOString(),
    ...(contentVersion !== undefined ? { contentVersion } : {}),
  };
}

/**
 * Ce que la fiche de préparation présente. La séance la porte depuis son démarrage (`briefing`) ;
 * les snapshots écrits avant le contrat phase16 n'en ont pas, et retombent alors sur les seuls
 * mots que la leçon introduit — le comportement d'avant, sans rien casser à la reprise.
 *
 * Vide = rien à préparer (leçon de révision, test d'unité, tout déjà connu) : la phase est sautée,
 * on ne fait pas lire une fiche pour rien. L'entraînement, lui, est écarté en amont par
 * `sessionPhase`.
 */
export function runBriefing(run: SessionRun, content: ContentIndex): Briefing {
  if (run.briefing) return run.briefing;
  return { discover: conceptsToTeach(run, content), recall: [], models: [], guides: [], formats: [] };
}

/** Les concepts que la leçon introduit et que l'apprenant n'a pas déjà rencontrés. */
export function conceptsToTeach(run: SessionRun, content: ContentIndex): ConceptId[] {
  if (!run.lesson) return [];
  const known = new Set(run.knownAtStart);
  const lesson = content.lessons.get(run.lesson.lessonId);
  return (lesson?.review.srsIntroduce ?? []).filter((id) => !known.has(id) && content.concepts.has(id));
}

/** La fiche de préparation a été consultée : on passe aux exercices. */
export function markTaught(run: SessionRun): SessionRun {
  return run.taught ? run : { ...run, taught: true };
}

export function sessionPhase(run: SessionRun, content: ContentIndex): SessionPhase {
  const item = run.reviewQueue[run.reviewCursor];
  if (item) return { kind: item.block, item, index: run.reviewCursor };
  if (run.lesson && !run.lessonSaved) {
    if (isFinished(run.lesson)) return { kind: "save_lesson", lesson: run.lesson };
    // Découverte avant pratique, une seule fois, et après le réveil et le rappel espacé : l'ordre
    // de la séance reste celui de la spec §4.3, la présentation s'insère en tête du bloc « Nouveau ».
    // Jamais en entraînement (contrat phase8 §2) : on y rejoue une leçon déjà terminée pour
    // s'exercer, pas pour découvrir — présenter la fiche serait un contresens.
    if (!run.taught && !isPracticeRun(run)) {
      const briefing = runBriefing(run, content);
      if (!isBriefingEmpty(briefing)) return { kind: "teach", lesson: run.lesson, briefing };
    }
    const step = currentItem(run.lesson);
    const type = step ? content.lessons.get(run.lesson.lessonId)?.steps[step.stepIndex]?.type : undefined;
    return { kind: type === "game" ? "practice" : "new", lesson: run.lesson };
  }
  return { kind: "recap" };
}

export interface SessionMisses {
  /**
   * Concepts ratés et **pas rattrapés** avant la fin de la séance. Ce sont eux que le bilan doit
   * nommer : sans ça, on termine une séance sans savoir ce qui a résisté.
   */
  missed: ConceptId[];
  /** Ratés puis réussis avant la fin : l'essentiel du travail d'une séance, et ça se dit. */
  recovered: ConceptId[];
}

/**
 * Ce qui a résisté pendant la séance (contrat phase13 §1), vu concept par concept — pas étape par
 * étape : un même mot croisé en rappel espacé puis dans la leçon ne se compte qu'une fois.
 *
 * Les items non notés sont ignorés (carte culture sans question, production orale sans courbe,
 * mini-jeu passé) : ils ne peuvent ni résister ni être rattrapés.
 */
export function sessionMisses(run: SessionRun): SessionMisses {
  const seen: ConceptId[] = [];
  const wrong = new Set<ConceptId>();
  const right = new Set<ConceptId>();
  const note = (conceptIds: readonly ConceptId[], correct: boolean) => {
    for (const id of conceptIds) {
      if (!wrong.has(id) && !right.has(id)) seen.push(id);
      (correct ? right : wrong).add(id);
    }
  };
  for (const result of run.reviewResults) if (result.graded) note([result.conceptId], result.correct);
  for (const result of run.lesson?.results ?? []) if (result.graded) note(result.conceptIds, result.correct);
  return {
    missed: seen.filter((id) => wrong.has(id) && !right.has(id)),
    recovered: seen.filter((id) => wrong.has(id) && right.has(id)),
  };
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

/** Items notés de la séance (révisions + étapes de leçon). */
export function sessionGradedItems(run: SessionRun): number {
  return run.reviewResults.filter((r) => r.graded).length + (run.lesson?.results.filter((r) => r.graded).length ?? 0);
}

/**
 * Séance vide (contrat phase5 §3) : aucun item noté ni leçon terminée → ni XP, ni session_completed,
 * ni jour de série. `lessonCompleted` : la partie leçon a été enregistrée.
 */
export function isEmptySession(run: SessionRun, lessonCompleted: boolean = run.lessonSaved): boolean {
  return sessionGradedItems(run) === 0 && !lessonCompleted;
}
