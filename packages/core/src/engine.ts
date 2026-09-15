import { compareAnswer, heardClassOf, normalizeAnswer, toneOf } from "./text.ts";
import type {
  Concept,
  ConceptId,
  ContentIndex,
  CultureCard,
  GameId,
  LexicalVariantEntry,
  Lesson,
  LessonId,
  LessonStep,
  Localized,
  StepType,
  Tone,
} from "./types.ts";

/**
 * Moteur d'exercices : transforme une étape de leçon (donnée) en exercice
 * jouable (options mélangées, bonne réponse), puis évalue la réponse.
 * Il ne connaît aucune langue : tout vient du ContentIndex.
 */

export interface ChoiceOption {
  id: string;
  /** Texte dans la langue cible (vietnamien). */
  text?: string;
  /** Libellé dans la langue d'interface (questions de culture). */
  label?: Localized;
  conceptId?: ConceptId;
  image?: string;
  /** Pour tone_identify : les tons écrits regroupés dans cette classe auditive. */
  tones?: Tone[];
}

interface ExerciseBase {
  stepIndex: number;
  conceptIds: ConceptId[];
  explain: Localized | null;
}

export type Exercise =
  | (ExerciseBase & { type: "culture_card"; card: CultureCard; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "listen_pick_image" | "listen_pick_text"; audio: Concept; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "tone_identify"; audio: Concept; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "tone_minimal_pair"; audio: Concept | null; target: string; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "spot_the_south"; entry: LexicalVariantEntry; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "build_sentence"; target: string; translation: Localized; audio: Concept | null; tokens: ChoiceOption[] })
  | (ExerciseBase & { type: "speak_repeat"; concept: Concept; pitchRef: string | null })
  /** Produire le mot avec le bon ton (une syllabe) : noté par la courbe de hauteur, comme speak_repeat. */
  | (ExerciseBase & { type: "tone_produce"; concept: Concept; tone: Tone; pitchRef: string | null })
  | (ExerciseBase & { type: "game"; game: GameId; conceptIds: ConceptId[] })
  | (ExerciseBase & { type: "unsupported"; stepType: StepType });

export type ChoiceExercise = Extract<Exercise, { answerId: string }>;

export type ExerciseResponse =
  | { kind: "choice"; optionId: string }
  | { kind: "tokens"; optionIds: string[] }
  | { kind: "speech"; score: number | null }
  | { kind: "game"; correct: number; total: number }
  | { kind: "skip" };

export interface Evaluation {
  correct: boolean;
  /** Presque juste (erreur de ton seule) : message spécifique, note FSRS « hard ». */
  nearMiss: boolean;
  /** false = n'influence ni le score ni le SRS (micro refusé, exercice passé, type non géré). */
  graded: boolean;
  expected: string;
  explain: Localized | null;
}

/** Score de prononciation (0–100) à partir duquel speak_repeat / tone_produce est réussi. */
export const SPEAK_PASS_SCORE = 60;
export const GAME_PASS_RATIO = 0.7;

// ---------------------------------------------------------------------------
// Aléa déterministe : même séance + même étape = même ordre d'options (reprise exacte).

export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// ---------------------------------------------------------------------------

export class ContentError extends Error {
  override name = "ContentError";
}

function requireConcept(content: ContentIndex, id: ConceptId): Concept {
  const c = content.concepts.get(id);
  if (!c) throw new ContentError(`Concept inconnu : ${id}`);
  return c;
}

export function buildExercise(content: ContentIndex, lesson: Lesson, stepIndex: number, seed: string): Exercise {
  const step = lesson.steps[stepIndex];
  if (!step) throw new ContentError(`Étape ${stepIndex} absente de ${lesson.id}`);
  const rand = seededRandom(`${seed}:${lesson.id}:${stepIndex}`);
  return buildFromStep(content, lesson, step, stepIndex, rand);
}

function buildFromStep(content: ContentIndex, lesson: Lesson, step: LessonStep, stepIndex: number, rand: () => number): Exercise {
  switch (step.type) {
    case "culture_card": {
      const card = content.culture.get(step.ref);
      if (!card) throw new ContentError(`Carte culture inconnue : ${step.ref}`);
      const options = card.question.options.map((label, i) => ({ id: String(i), label }));
      return {
        type: "culture_card", stepIndex, conceptIds: [], explain: card.question.explain ?? null,
        card, options, answerId: String(card.question.answer),
      };
    }

    case "listen_pick_image": {
      const audio = requireConcept(content, step.concept);
      const all = [step.concept, ...step.distractors].map((id) => requireConcept(content, id));
      const options = shuffle(all, rand).map((c) => ({ id: c.id, conceptId: c.id, ...(c.image ? { image: c.image } : {}), text: c.vi }));
      return { type: step.type, stepIndex, conceptIds: [audio.id], explain: step.explain ?? audio.note ?? null, audio, options, answerId: audio.id };
    }

    case "listen_pick_text": {
      const audio = requireConcept(content, step.concept);
      const texts = shuffle([audio.vi, ...step.distractors], rand);
      const options = texts.map((text, i) => ({ id: `t${i}`, text }));
      const answer = options.find((o) => o.text === audio.vi);
      return { type: step.type, stepIndex, conceptIds: [audio.id], explain: step.explain ?? audio.note ?? null, audio, options, answerId: answer?.id ?? "" };
    }

    case "tone_identify": {
      const audio = requireConcept(content, step.concept);
      const classes = content.pack.toneSystem?.heardClasses;
      if (!classes) throw new ContentError(`tone_identify sans toneSystem dans le pack`);
      const tone = audio.tone ?? toneOf(audio.vi);
      const answerClass = heardClassOf(tone, classes);
      // Les classes gardent un ordre fixe : l'oreille apprend une grille stable.
      const options = classes.map((tones, i) => ({ id: `tone${i}`, tones: [...tones] }));
      return { type: step.type, stepIndex, conceptIds: [audio.id], explain: step.explain ?? null, audio, options, answerId: `tone${answerClass}` };
    }

    case "tone_minimal_pair": {
      const targetIndex = Math.floor(rand() * step.pair.length);
      const target = step.pair[targetIndex] ?? step.pair[0] ?? "";
      const audioId = step.audioConcepts?.[targetIndex];
      const audio = audioId ? requireConcept(content, audioId) : null;
      const options = step.pair.map((text, i) => ({ id: `p${i}`, text }));
      return {
        type: step.type, stepIndex, conceptIds: audio ? [audio.id] : [], explain: step.explain ?? null,
        audio, target, options, answerId: `p${targetIndex}`,
      };
    }

    case "spot_the_south": {
      const entry = content.variants?.entries.find((e) => e.id === step.variant);
      if (!entry) throw new ContentError(`Variante inconnue : ${step.variant}`);
      const south = entry.south[0] ?? "";
      const north = entry.north[0] ?? "";
      const options = shuffle([{ id: "south", text: south }, { id: "north", text: north }], rand);
      return { type: step.type, stepIndex, conceptIds: [], explain: step.explain ?? entry.note ?? null, entry, options, answerId: "south" };
    }

    case "build_sentence": {
      const tokens = shuffle(step.tokens.map((text, i) => ({ id: `k${i}`, text })), rand);
      const audio = step.audioConcept ? requireConcept(content, step.audioConcept) : null;
      return {
        type: step.type, stepIndex, conceptIds: audio ? [audio.id] : conceptsInText(content, lesson, step.target),
        explain: step.explain ?? null, target: step.target, translation: step.translation, audio, tokens,
      };
    }

    case "speak_repeat": {
      const concept = requireConcept(content, step.concept);
      return {
        type: step.type, stepIndex, conceptIds: [concept.id], explain: step.explain ?? concept.note ?? null,
        concept, pitchRef: step.pitchRef ?? concept.pitch ?? null,
      };
    }

    case "tone_produce": {
      const concept = requireConcept(content, step.concept);
      return {
        type: step.type, stepIndex, conceptIds: [concept.id], explain: step.explain ?? concept.note ?? null,
        concept, tone: concept.tone ?? toneOf(concept.vi), pitchRef: concept.pitch ?? null,
      };
    }

    case "game": {
      const pool = step.conceptPool === "lesson" || step.conceptPool === "unit" || step.conceptPool === "known"
        ? lesson.concepts
        : step.conceptPool;
      return { type: step.type, stepIndex, conceptIds: [...pool], explain: null, game: step.game };
    }

    default:
      return { type: "unsupported", stepIndex, conceptIds: [], explain: null, stepType: step.type };
  }
}

/** Concepts de la leçon dont la forme apparaît dans le texte (pour rattacher une phrase au SRS). */
function conceptsInText(content: ContentIndex, lesson: Lesson, text: string): ConceptId[] {
  const haystack = ` ${normalizeAnswer(text)} `;
  return lesson.concepts.filter((id) => {
    const c = content.concepts.get(id);
    return c !== undefined && haystack.includes(` ${normalizeAnswer(c.vi)} `);
  });
}

// ---------------------------------------------------------------------------

export function evaluate(exercise: Exercise, response: ExerciseResponse): Evaluation {
  const ungraded = (expected = ""): Evaluation => ({ correct: true, nearMiss: false, graded: false, expected, explain: null });
  if (response.kind === "skip") return { ...ungraded(), correct: false };

  switch (exercise.type) {
    case "culture_card":
    case "listen_pick_image":
    case "listen_pick_text":
    case "tone_identify":
    case "tone_minimal_pair":
    case "spot_the_south": {
      if (response.kind !== "choice") return { ...ungraded(), correct: false };
      const expectedOption = exercise.options.find((o) => o.id === exercise.answerId);
      const chosen = exercise.options.find((o) => o.id === response.optionId);
      const correct = response.optionId === exercise.answerId;
      const expected = expectedOption?.text ?? expectedOption?.label?.fr ?? expectedOption?.tones?.join(" / ") ?? "";
      // Une confusion de ton sur le même mot est « presque juste ».
      const nearMiss =
        !correct && chosen?.text !== undefined && expectedOption?.text !== undefined &&
        compareAnswer(chosen.text, [expectedOption.text]).kind === "tone_only";
      // Les cartes culture informent, elles ne notent pas.
      const graded = exercise.type !== "culture_card";
      return { correct, nearMiss, graded, expected, explain: exercise.explain };
    }

    case "build_sentence": {
      if (response.kind !== "tokens") return { ...ungraded(exercise.target), correct: false };
      const byId = new Map(exercise.tokens.map((t) => [t.id, t.text ?? ""]));
      const sentence = response.optionIds.map((id) => byId.get(id) ?? "").join(" ");
      const match = compareAnswer(sentence, [exercise.target]);
      return {
        correct: match.kind === "correct",
        nearMiss: match.kind === "tone_only",
        graded: true,
        expected: exercise.target,
        explain: exercise.explain,
      };
    }

    case "speak_repeat":
    case "tone_produce": {
      if (response.kind !== "speech") return { ...ungraded(exercise.concept.vi), correct: false };
      // Micro refusé ou indisponible : l'exercice devient de l'écoute, sans note.
      if (response.score === null) return ungraded(exercise.concept.vi);
      const correct = response.score >= SPEAK_PASS_SCORE;
      return { correct, nearMiss: !correct && response.score >= SPEAK_PASS_SCORE - 15, graded: true, expected: exercise.concept.vi, explain: exercise.explain };
    }

    case "game": {
      if (response.kind !== "game" || response.total === 0) return ungraded();
      const correct = response.correct / response.total >= GAME_PASS_RATIO;
      return { correct, nearMiss: false, graded: true, expected: "", explain: null };
    }

    case "unsupported":
      return ungraded();
  }
}

// ---------------------------------------------------------------------------
// Déroulé d'une leçon : file d'étapes, relance des erreurs, intervention du professeur.

export interface QueueItem {
  stepIndex: number;
  attempt: number;
}

export interface StepResult extends QueueItem {
  correct: boolean;
  nearMiss: boolean;
  graded: boolean;
  responseMs: number;
  conceptIds: ConceptId[];
}

/** État sérialisable (JSON) : réécrit après chaque réponse pour une reprise exacte. */
export interface LessonRun {
  sessionId: string;
  lessonId: LessonId;
  queue: QueueItem[];
  cursor: number;
  results: StepResult[];
  /** Erreurs consécutives par concept. */
  errorStreaks: Record<ConceptId, number>;
  /** Concept sur lequel Cô Mai doit intervenir (3 erreurs d'affilée), sinon null. */
  tutorNudge: ConceptId | null;
  startedAt: string;
}

export const MAX_ATTEMPTS = 2;
export const TUTOR_NUDGE_AFTER = 3;

/**
 * `playable` : étapes à jouer (indices d'origine) ; les autres sont retirées de la séance, ni affichées
 * ni notées (contrat phase5 §1, étapes tonales sans audio natif). Défaut : toutes.
 */
export function startLesson(lesson: Lesson, sessionId: string, now: Date, playable?: readonly number[]): LessonRun {
  const keep = playable ? new Set(playable) : null;
  return {
    sessionId,
    lessonId: lesson.id,
    queue: lesson.steps.flatMap((_, stepIndex) => (keep && !keep.has(stepIndex) ? [] : [{ stepIndex, attempt: 1 }])),
    cursor: 0,
    results: [],
    errorStreaks: {},
    tutorNudge: null,
    startedAt: now.toISOString(),
  };
}

export function currentItem(run: LessonRun): QueueItem | null {
  return run.queue[run.cursor] ?? null;
}

export function isFinished(run: LessonRun): boolean {
  return run.cursor >= run.queue.length;
}

export function recordResult(run: LessonRun, exercise: Exercise, evaluation: Evaluation, responseMs: number): LessonRun {
  const item = currentItem(run);
  if (!item) return run;

  const result: StepResult = {
    ...item,
    correct: evaluation.correct,
    nearMiss: evaluation.nearMiss,
    graded: evaluation.graded,
    responseMs,
    conceptIds: exercise.conceptIds,
  };

  const errorStreaks = { ...run.errorStreaks };
  let tutorNudge: ConceptId | null = null;
  if (evaluation.graded) {
    for (const id of exercise.conceptIds) {
      errorStreaks[id] = evaluation.correct ? 0 : (errorStreaks[id] ?? 0) + 1;
      if ((errorStreaks[id] ?? 0) >= TUTOR_NUDGE_AFTER) tutorNudge = id;
    }
  }

  // Une erreur relance l'exercice en fin de leçon, sans interrompre (spec §3.3).
  // Les mini-jeux (mise en pratique) ne sont jamais relancés : le résultat compte, on avance.
  const queue = [...run.queue];
  if (evaluation.graded && !evaluation.correct && item.attempt < MAX_ATTEMPTS && exercise.type !== "game") {
    queue.push({ stepIndex: item.stepIndex, attempt: item.attempt + 1 });
  }

  return { ...run, queue, cursor: run.cursor + 1, results: [...run.results, result], errorStreaks, tutorNudge };
}

/** Score de leçon (0–1) : réussites au premier essai parmi les étapes notées. */
export function lessonScore(run: LessonRun): number {
  const firsts = run.results.filter((r) => r.attempt === 1 && r.graded);
  if (firsts.length === 0) return 1;
  return firsts.filter((r) => r.correct).length / firsts.length;
}

/** Nombre d'étapes restantes, relances connues comprises (pour la barre de progression). */
export function remainingSteps(run: LessonRun): number {
  return Math.max(0, run.queue.length - run.cursor);
}
