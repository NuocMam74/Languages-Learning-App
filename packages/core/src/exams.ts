import { checkLessonStep, type ContentIssue } from "./content-checks.ts";
import { buildExercise, evaluate, SPEAK_PASS_SCORE, type Exercise, type ExerciseResponse } from "./engine.ts";
import type { ConceptId, ContentIndex, Curriculum, Lesson, LessonId, LessonStep, Localized, StepType, UnitId } from "./types.ts";

/**
 * Examens de certificat (spec §5.5, docs/contracts/phase2.md §2).
 *
 * Un examen est un fichier de contenu : 4 sections (compétences) d'étapes de leçon.
 * Pour construire les exercices, on fabrique une leçon synthétique dont les étapes
 * sont les items dans l'ordre des sections : l'item n° k (tous items confondus)
 * est l'étape k, et l'ordre des options vient de buildExercise(…, graine) —
 * exactement comme côté serveur, qui rejoue `evaluate` avec la graine `attemptId`.
 */

export const EXAM_SKILLS = ["listening", "reading", "vocabulary", "speaking"] as const;
export type ExamSkill = (typeof EXAM_SKILLS)[number];
export type ExamLevel = "A0" | "A1" | "A2";

export const EXAM_ITEM_COUNT = 25;
export const EXAM_MIN_SECTION_ITEMS = 4;
/** Chaque compétence doit atteindre au moins ce score pour réussir. */
export const EXAM_MIN_SKILL_SCORE = 0.5;
/** Grâce serveur après la durée officielle (contrat §2.3). */
export const EXAM_GRACE_MINUTES = 2;

export type ExamStep = Exclude<LessonStep, { type: "culture_card" | "game" }>;

export interface ExamItem {
  step: ExamStep;
  silent?: true;
}

export interface ExamSection {
  skill: ExamSkill;
  items: ExamItem[];
}

export interface ExamFile {
  id: string;
  level: ExamLevel;
  certificate: Localized;
  requiresUnits: UnitId[];
  durationMinutes: number;
  passThreshold: number;
  retryAfterHours: number;
  sections: ExamSection[];
  reviewed: boolean;
}

/** Référence d'un item : compétence + rang dans la section (forme de l'API). */
export interface ExamItemRef {
  section: ExamSkill;
  index: number;
}

export interface ExamQuestion extends ExamItemRef {
  /** Rang tous items confondus = index d'étape de la leçon synthétique. */
  flatIndex: number;
  stepType: StepType;
  silent: boolean;
  exercise: Exercise;
}

export interface ExamAnswer extends ExamItemRef {
  response: ExerciseResponse;
  responseMs: number;
}

export interface ExamItemResult extends ExamItemRef {
  correct: boolean;
  /** false : item non noté (oral sans micro, examen blanc seulement). */
  graded: boolean;
  conceptIds: ConceptId[];
}

export interface ExamGap {
  skill: ExamSkill;
  conceptIds: ConceptId[];
}

export type ExamScores = Record<ExamSkill, number | null>;

export interface ExamGrade {
  passed: boolean;
  global: number;
  scores: ExamScores;
  gaps: ExamGap[];
  items: ExamItemResult[];
}

const SPEECH_STEPS: ReadonlySet<StepType> = new Set(["speak_repeat", "tone_produce"]);

/** Types d'étape attendus par section (contrat §2.1). Hors liste : avertissement. */
export const EXAM_SECTION_STEPS: Record<ExamSkill, ReadonlySet<StepType>> = {
  listening: new Set(["listen_pick_image", "listen_pick_text", "tone_identify", "tone_minimal_pair"]),
  reading: new Set(["spot_the_south", "build_sentence", "listen_pick_text"]),
  vocabulary: new Set(["listen_pick_image", "build_sentence"]),
  speaking: new Set(["speak_repeat", "tone_produce"]),
};

// ---------------------------------------------------------------------------
// Construction

export function examItemRefs(exam: ExamFile): ExamItemRef[] {
  return exam.sections.flatMap((s) => s.items.map((_, index) => ({ section: s.skill, index })));
}

export function flatIndexOf(exam: ExamFile, ref: ExamItemRef): number {
  let offset = 0;
  for (const s of exam.sections) {
    if (s.skill === ref.section) return ref.index >= 0 && ref.index < s.items.length ? offset + ref.index : -1;
    offset += s.items.length;
  }
  return -1;
}

/** Leçons des unités requises, dans l'ordre du cursus. */
export function examLessons(content: ContentIndex, exam: ExamFile): Lesson[] {
  return exam.requiresUnits.flatMap((unitId) => {
    const unit = content.curriculum.units.find((u) => u.id === unitId);
    return (unit?.lessons ?? []).flatMap((id) => content.lessons.get(id) ?? []);
  });
}

/** Concepts des unités requises (union ordonnée). */
export function examConcepts(content: ContentIndex, exam: ExamFile): ConceptId[] {
  return [...new Set(examLessons(content, exam).flatMap((l) => l.concepts))];
}

/** Leçon synthétique : une étape par item, dans l'ordre des sections. */
export function examLesson(content: ContentIndex, exam: ExamFile): Lesson {
  return {
    id: exam.id,
    unit: exam.requiresUnits[0] ?? "",
    kind: "unit_test",
    title: exam.certificate,
    goal: exam.certificate,
    estimatedMinutes: exam.durationMinutes,
    prerequisites: [],
    concepts: examConcepts(content, exam),
    steps: exam.sections.flatMap((s) => s.items.map((i) => i.step)),
    review: { srsIntroduce: [] },
    reviewed: exam.reviewed,
  };
}

/**
 * Exercices de l'examen pour une graine (attemptId pour l'examen certifiant).
 * `refs` : ordre de passage renvoyé par POST /exams/{id}/start (par défaut, l'ordre du fichier).
 */
export function buildExam(content: ContentIndex, exam: ExamFile, seed: string, refs: readonly ExamItemRef[] = examItemRefs(exam)): ExamQuestion[] {
  const lesson = examLesson(content, exam);
  return refs.flatMap((ref) => {
    const flatIndex = flatIndexOf(exam, ref);
    const item = exam.sections.find((s) => s.skill === ref.section)?.items[ref.index];
    if (flatIndex < 0 || !item) return [];
    return [{ ...ref, flatIndex, stepType: item.step.type, silent: item.silent === true, exercise: buildExercise(content, lesson, flatIndex, seed) }];
  });
}

// ---------------------------------------------------------------------------
// Notation (§2.2) — identique au serveur

export interface GradeOptions {
  /** Examen blanc : un oral sans score (micro refusé) n'est pas noté au lieu d'être faux. */
  allowUngradedSpeech?: boolean;
}

export function gradeItem(question: ExamQuestion, answer: ExamAnswer | undefined, options: GradeOptions = {}): ExamItemResult {
  const base = { section: question.section, index: question.index, conceptIds: question.exercise.conceptIds };
  if (!answer) return { ...base, correct: false, graded: true };
  const { response } = answer;

  if (SPEECH_STEPS.has(question.stepType)) {
    if (response.kind === "speech" && response.score !== null) return { ...base, correct: response.score >= SPEAK_PASS_SCORE, graded: true };
    if (response.kind === "speech" && options.allowUngradedSpeech) return { ...base, correct: false, graded: false };
    return { ...base, correct: false, graded: true };
  }

  const evaluation = evaluate(question.exercise, response);
  return { ...base, correct: evaluation.graded && evaluation.correct, graded: true };
}

const EPSILON = 1e-9;

export function gradeExam(exam: ExamFile, questions: readonly ExamQuestion[], answers: readonly ExamAnswer[], options: GradeOptions = {}): ExamGrade {
  const byRef = new Map(answers.map((a) => [`${a.section}:${a.index}`, a]));
  const items = questions.map((q) => gradeItem(q, byRef.get(`${q.section}:${q.index}`), options));

  const scores = {} as ExamScores;
  let correct = 0;
  let graded = 0;
  const gaps: ExamGap[] = [];
  for (const skill of EXAM_SKILLS) {
    const mine = items.filter((i) => i.section === skill && i.graded);
    const ok = mine.filter((i) => i.correct).length;
    scores[skill] = mine.length === 0 ? null : ok / mine.length;
    correct += ok;
    graded += mine.length;
    const wrong = mine.filter((i) => !i.correct);
    if (wrong.length > 0) gaps.push({ skill, conceptIds: [...new Set(wrong.flatMap((i) => i.conceptIds))] });
  }

  const global = graded === 0 ? 0 : correct / graded;
  const skillsOk = EXAM_SKILLS.every((s) => scores[s] === null ? options.allowUngradedSpeech === true && s === "speaking" : (scores[s] ?? 0) >= EXAM_MIN_SKILL_SCORE - EPSILON);
  return { passed: graded > 0 && global >= exam.passThreshold - EPSILON && skillsOk, global, scores, gaps, items };
}

// ---------------------------------------------------------------------------
// Accès, lacunes

/**
 * Examen débloqué : le test d'unité (`kind: "unit_test"`) de chaque unité requise est fait — terminé,
 * ou sauté grâce au placement si `done` inclut les leçons débloquées. Sans test d'unité (ou sans
 * `lessons`), toutes les leçons de l'unité sont exigées. Même règle que l'API (services/exams.py).
 */
export function isExamUnlocked(
  curriculum: Curriculum,
  exam: ExamFile,
  done: ReadonlySet<LessonId>,
  lessons?: ReadonlyMap<LessonId, Lesson>,
): boolean {
  return exam.requiresUnits.every((unitId) => {
    const unit = curriculum.units.find((u) => u.id === unitId);
    if (!unit || unit.lessons.length === 0) return false;
    const tests = lessons ? unit.lessons.filter((id) => lessons.get(id)?.kind === "unit_test") : [];
    const required = tests.length > 0 ? tests : unit.lessons;
    return required.every((id) => done.has(id));
  });
}

/** Prochaine tentative possible après une tentative soumise (null = tout de suite). */
export function nextExamAttemptAt(exam: ExamFile, lastSubmittedAt: string | null, now: Date = new Date()): Date | null {
  if (!lastSubmittedAt) return null;
  const at = new Date(Date.parse(lastSubmittedAt) + exam.retryAfterHours * 3_600_000);
  return at.getTime() > now.getTime() ? at : null;
}

/**
 * Leçons à revoir pour des concepts manqués : la première leçon (ordre du cursus)
 * qui introduit chaque concept, sinon la première qui l'utilise.
 */
export function lessonsForConcepts(content: ContentIndex, exam: ExamFile, conceptIds: readonly ConceptId[]): LessonId[] {
  const lessons = examLessons(content, exam);
  const found = new Set<LessonId>();
  for (const id of conceptIds) {
    const lesson = lessons.find((l) => l.review.srsIntroduce.includes(id)) ?? lessons.find((l) => l.concepts.includes(id));
    if (lesson) found.add(lesson.id);
  }
  return lessons.filter((l) => found.has(l.id)).map((l) => l.id);
}

/** Leçons à revoir après un examen blanc (items sans concept, ex. spot_the_south, compris). */
export function revisionLessons(content: ContentIndex, exam: ExamFile, questions: readonly ExamQuestion[], grade: ExamGrade): LessonId[] {
  const wrong = grade.items.filter((i) => i.graded && !i.correct);
  const ids = new Set(lessonsForConcepts(content, exam, wrong.flatMap((i) => i.conceptIds)));
  const lessons = examLessons(content, exam);
  for (const item of wrong) {
    const q = questions.find((x) => x.section === item.section && x.index === item.index);
    if (q?.exercise.type === "spot_the_south") {
      const variant = q.exercise.entry.id;
      const lesson = lessons.find((l) => l.steps.some((s) => s.type === "spot_the_south" && s.variant === variant));
      if (lesson) ids.add(lesson.id);
    }
  }
  return lessons.filter((l) => ids.has(l.id)).map((l) => l.id);
}

// ---------------------------------------------------------------------------
// Validation sémantique (scripts/validate-content.ts)

function stepConcepts(step: ExamStep): ConceptId[] {
  switch (step.type) {
    case "listen_pick_image":
      return [step.concept, ...step.distractors];
    case "listen_pick_text":
    case "listen_transcribe":
    case "tone_identify":
    case "tone_produce":
    case "speak_repeat":
      return [step.concept];
    case "tone_minimal_pair":
      return step.audioConcepts ?? [];
    case "build_sentence":
      return step.audioConcept ? [step.audioConcept] : [];
    case "match_pairs":
      return step.concepts;
    default:
      return [];
  }
}

export function checkExam(content: ContentIndex, exam: ExamFile, where = exam.id): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const err = (message: string, at = where) => issues.push({ level: "error", where: at, message });
  const warn = (message: string, at = where) => issues.push({ level: "warning", where: at, message });

  for (const unitId of exam.requiresUnits) {
    const unit = content.curriculum.units.find((u) => u.id === unitId);
    if (!unit) err(`Unité requise inconnue : ${unitId}`);
    else if (unit.lessons.length === 0) err(`Unité requise sans leçon : ${unitId}`);
  }

  const total = exam.sections.reduce((n, s) => n + s.items.length, 0);
  if (total !== EXAM_ITEM_COUNT) err(`${total} items (attendu : ${EXAM_ITEM_COUNT})`);
  for (const skill of EXAM_SKILLS) {
    const count = exam.sections.filter((s) => s.skill === skill).length;
    if (count !== 1) err(`Section « ${skill} » présente ${count} fois (attendu : 1)`);
  }

  const lesson = examLesson(content, exam);
  const allowed = new Set(lesson.concepts);
  for (const section of exam.sections) {
    if (section.items.length < EXAM_MIN_SECTION_ITEMS) err(`Section ${section.skill} : ${section.items.length} items (minimum ${EXAM_MIN_SECTION_ITEMS})`);
    section.items.forEach((item, i) => {
      const at = `${where} ${section.skill}[${i}] (${item.step.type})`;
      if (!EXAM_SECTION_STEPS[section.skill].has(item.step.type)) warn(`Type d'étape inattendu dans la section ${section.skill}`, at);
      if (item.silent && (section.skill === "listening" || section.skill === "speaking")) err(`silent interdit en ${section.skill}`, at);
      for (const id of stepConcepts(item.step)) {
        if (!allowed.has(id)) err(`Concept ${id} hors des unités requises`, at);
      }
      for (const issue of checkLessonStep(content, lesson, item.step, at)) {
        // Les concepts sont contrôlés ci-dessus contre les unités requises.
        if (!issue.message.includes("absent de lesson.concepts")) issues.push(issue);
      }
    });
  }

  if (!issues.some((i) => i.level === "error")) {
    try {
      buildExam(content, exam, "validation");
    } catch (error) {
      err(`Construction impossible : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!exam.reviewed) warn(`Examen non relu par un locuteur natif`);
  return issues;
}
