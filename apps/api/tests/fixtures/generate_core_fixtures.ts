/**
 * Fixtures de parité Python ↔ packages/core (moteur d'exercices, aléa, texte, planificateur, règles du parcours).
 *
 * Régénérer depuis la racine du dépôt après toute modification de engine.ts, text.ts, session.ts, exams.ts,
 * media.ts, progress.ts, streak.ts, placement.ts ou badges.ts :
 *   npx tsx apps/api/tests/fixtures/generate_core_fixtures.ts
 *
 * Écrit apps/api/tests/fixtures/core_parity.json, rejoué par apps/api/tests/test_core_parity.py.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildExercise,
  capSessionTotals,
  compareAnswer,
  evaluate,
  evaluateBadges,
  examAvailability,
  examLesson,
  flatIndexOf,
  gradeExam,
  isUnitPassed,
  lessonsBefore,
  levelForXp,
  localChallengeSpec,
  buildExam,
  newCard,
  nextLesson,
  normalizeAnswer,
  planSession,
  recordActivity,
  resolveEntryLesson,
  review,
  seededRandom,
  streakAt,
  type ContentIndex,
  type ExamAnswer,
  type ExamFile,
  type ExerciseResponse,
  type Lesson,
  type SrsCard,
  type Streak,
} from "../../../../packages/core/src/index.ts";
import { loadPack } from "../../../../packages/core/src/testing/pack.ts";

const here = import.meta.dirname;
const content = loadPack("vi-south");

const exam = JSON.parse(readFileSync(join(here, "exam_a0.json"), "utf8")) as ExamFile;

function responsesFor(ex: ReturnType<typeof buildExercise>): ExerciseResponse[] {
  const base: ExerciseResponse[] = [{ kind: "skip" }, { kind: "speech", score: 80 }];
  if ("answerId" in ex) return [...base, ...ex.options.map((o) => ({ kind: "choice", optionId: o.id }) as const), { kind: "choice", optionId: "nope" }];
  if (ex.type === "build_sentence") {
    const ids = [...ex.tokens].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).map((t) => t.id);
    return [...base, { kind: "tokens", optionIds: ids }, { kind: "tokens", optionIds: [...ids].reverse() }, { kind: "tokens", optionIds: ids.slice(0, 1) }, { kind: "choice", optionId: "k0" }];
  }
  return [{ kind: "skip" }, { kind: "speech", score: null }, { kind: "speech", score: 0 }, { kind: "speech", score: 59.9 }, { kind: "speech", score: 60 }, { kind: "speech", score: 100 }, { kind: "choice", optionId: "x" }];
}

const seeds = ["0b7f2a3e-1c4d-4e5f-8a9b-0c1d2e3f4a5b", "attempt-1", "ẞ-ünïcødé-ồ"];
const exercises = seeds.flatMap((seed) =>
  exam.sections.flatMap((section) => {
    return section.items.map((_, index) => {
      // Même construction que buildExam (exams.ts) : leçon synthétique, étape = rang tous items confondus.
      const flatIndex = flatIndexOf(exam, { section: section.skill, index });
      const ex = buildExercise(content, examLesson(content, exam), flatIndex, seed);
      const summary = {
        type: ex.type,
        conceptIds: ex.conceptIds,
        options: "options" in ex ? ex.options.map((o) => ({ id: o.id, text: o.text ?? null, tones: o.tones ?? null })) : null,
        answerId: "answerId" in ex ? ex.answerId : null,
        tokens: ex.type === "build_sentence" ? ex.tokens.map((t) => ({ id: t.id, text: t.text ?? null })) : null,
      };
      const evaluations = responsesFor(ex).map((response) => {
        const e = evaluate(ex, response);
        return { response, correct: e.correct, nearMiss: e.nearMiss, graded: e.graded };
      });
      return { seed, section: section.skill, index, exercise: summary, evaluations };
    });
  }),
);

function answerSet(examFile: ExamFile, seed: string, variant: number): ExamAnswer[] {
  return buildExam(content, examFile, seed).flatMap((q, i) => {
    const responses = responsesFor(q.exercise);
    // Variantes : bonnes réponses quand c'est possible, sinon réponses tournantes (fausses, manquantes, oral).
    const best: ExerciseResponse = "answerId" in q.exercise ? { kind: "choice", optionId: q.exercise.answerId } : responses[q.exercise.type === "build_sentence" ? 2 : 5]!;
    const pick = variant >= 4 ? (variant === 5 && q.section === "speaking" && q.index < 3 ? { kind: "speech" as const, score: null } : best) : responses[(i * (variant + 1) + variant) % responses.length]!;
    if (variant === 3 && i % 5 === 0) return [];
    return [{ section: q.section, index: q.index, response: pick, responseMs: 1000 }];
  });
}
const grades = seeds.flatMap((seed) =>
  [0, 1, 2, 3, 4, 5].map((variant) => {
    const answers = answerSet(exam, seed, variant);
    const g = gradeExam(exam, buildExam(content, exam, seed), answers);
    return { seed, answers, passed: g.passed, global: g.global, scores: g.scores, gaps: g.gaps };
  }),
);

// --- Médias (contrat phase5 §1) : examen dont les `speak_repeat` ont une courbe F0, index null / vide / partiel.
const PITCH_REF = "pitch/parity_ref.json";
const examWithPitch: ExamFile = {
  ...exam,
  sections: exam.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.step.type === "speak_repeat" ? { ...it, step: { ...it.step, pitchRef: PITCH_REF } } : it)) })),
};
const mediaVariants: { name: string; media: string[] | null }[] = [
  { name: "all", media: null },
  { name: "none", media: [] },
  { name: "partial", media: [PITCH_REF, "audio/c_ma_mom_mai.opus", "audio/c_ma_ghost_mai.opus", "audio/c_ba_mai.opus"] },
];
const withMedia = (media: string[] | null): ContentIndex => {
  const { mediaIndex: _drop, ...rest } = content;
  return media === null ? rest : { ...rest, mediaIndex: new Set(media) };
};
const mediaGrades = mediaVariants.flatMap(({ name, media }) => {
  const c = withMedia(media);
  return [0, 4, 5].map((variant) => {
    const seed = seeds[variant % seeds.length]!;
    const answers = answerSet(examWithPitch, seed, variant);
    const questions = buildExam(c, examWithPitch, seed);
    const g = gradeExam(examWithPitch, questions, answers);
    const availability = examAvailability(c, examWithPitch);
    return {
      name, media, seed, answers,
      graded: questions.map((q) => ({ section: q.section, index: q.index, graded: q.graded })),
      gradedItems: availability.gradedItems, unavailableReason: availability.unavailableReason,
      passed: g.passed, global: g.global, scores: g.scores, gaps: g.gaps,
    };
  });
});

const challengeWeeks = ["2026-09-14T00:00:00Z", "2026-09-20T23:59:59Z", "2026-09-21T00:00:01Z", "2026-10-01T12:00:00Z", "2027-01-04T08:00:00Z", "2030-06-15T00:00:00Z"].map((iso) => {
  const spec = localChallengeSpec(new Date(iso));
  return { now: iso, kind: spec.kind, target: spec.target, periodStart: spec.periodStart, periodEnd: spec.periodEnd };
});

const random = seeds.map((seed) => {
  const rand = seededRandom(seed);
  return { seed, values: Array.from({ length: 8 }, () => rand()) };
});

const texts = ["Chào  CÔ!", "Má ơi, con về rồi.", "ma", "mà", "Ðây là ba tôi", "đây là ba tôi", "Nghiễm nhiên — tôi nghĩ rằng…", "ổng ở Cần Thơ", "Ông ở cần thơ"];
const text = {
  normalize: texts.map((t) => ({ input: t, output: normalizeAnswer(t) })),
  compare: texts.flatMap((a) => texts.map((b) => ({ given: a, accepted: b, kind: compareAnswer(a, [b]).kind }))),
};

// Planificateur : matrice objectifs × révisions dues × items maîtrisés × leçon.
const NOW = new Date("2026-09-14T08:00:00Z");
function dueCards(n: number): SrsCard[] {
  const past = new Date("2026-09-01T08:00:00Z");
  return Array.from({ length: n }, (_, i) => review(newCard(`c_x${String(i).padStart(3, "0")}`, past), "good", past));
}
function masteredCards(n: number): SrsCard[] {
  return Array.from({ length: n }, (_, i) => {
    let card = review(newCard(`c_m${i}`, new Date("2026-01-01")), "easy", new Date("2026-01-01"));
    for (let k = 0; k < 4 + i; k++) card = review(card, "easy", new Date(card.due));
    return { ...card, due: "2027-06-01T00:00:00.000Z" };
  });
}
const l01 = content.lessons.get("vi-south.u01.l01")!;
const long: Lesson = { ...l01, id: "long", estimatedMinutes: 12 };
const masteredPool = masteredCards(4);
const duePool = dueCards(300);
const planner = [];
for (const minutes of [5, 10, 15, 20]) {
  for (const due of [0, 1, 3, 7, 8, 12, 19, 20, 40, 300]) {
    for (const mastered of [0, 2, 4]) {
      for (const lesson of [null, l01, long]) {
        const cards = [...masteredPool.slice(0, mastered), ...duePool.slice(0, due)];
        const plan = planSession({ targetMinutes: minutes, cards, nextLesson: lesson, now: NOW });
        planner.push({
          input: { targetMinutes: minutes, mastered, due, nextLesson: lesson ? { id: lesson.id, estimatedMinutes: lesson.estimatedMinutes } : null },
          output: plan,
        });
      }
    }
  }
}

// --- Parcours (contrat phase5 §2) : graphe d'unités, tests réussis, placement, prochaine leçon.
const units = content.curriculum.units;
const unitLessons = (i: number) => units[i]?.lessons ?? [];
const testsOf = (ids: readonly string[]) => ids.filter((id) => content.lessons.get(id)?.kind === "unit_test");
const upTo = (n: number) => units.slice(0, n).flatMap((u) => u.lessons);
const nonTests = (ids: readonly string[]) => ids.filter((id) => content.lessons.get(id)?.kind !== "unit_test");
// Leçons **maîtrisées** (contrat phase25 §1) : c'est ce que le client appelle « réussi ». Le serveur
// reste plus permissif à dessein (une leçon terminée compte) ; la parité se vérifie donc là où les
// deux jugent pareil — leçons maîtrisées, tests réussis ou non.
const progressionCases: { name: string; completed: string[]; passed: string[]; path: string | null }[] = [
  { name: "fresh", completed: [], passed: [], path: null },
  { name: "unit1-lessons", completed: unitLessons(0).slice(0, 3), passed: unitLessons(0).slice(0, 3), path: null },
  { name: "unit1-test-failed", completed: unitLessons(0), passed: nonTests(unitLessons(0)), path: null },
  { name: "unit1-passed", completed: unitLessons(0), passed: unitLessons(0), path: null },
  { name: "units1-2-passed-family", completed: upTo(2), passed: upTo(2), path: "family" },
  { name: "units1-2-passed-travel", completed: upTo(2), passed: upTo(2), path: "travel" },
  { name: "units1-4-passed-work", completed: upTo(4), passed: upTo(4), path: "work" },
  { name: "units1-6-passed-roots", completed: upTo(6), passed: upTo(6), path: "roots" },
  { name: "units1-6-tests-failed", completed: upTo(6), passed: [...nonTests(upTo(6)), ...testsOf(upTo(5))], path: null },
  ...[0, 1, 2, 3].map((level) => {
    const entry = resolveEntryLesson(content, level);
    const skipped = entry ? lessonsBefore(content.curriculum, entry.id) : [];
    return { name: `placement-${level}`, completed: skipped, passed: skipped, path: null };
  }),
];
const progression = {
  entries: [0, 1, 2, 3, 7].map((level) => ({ level, lessonId: resolveEntryLesson(content, level)?.id ?? null })),
  cases: progressionCases.map((c) => ({
    ...c,
    next: nextLesson(content.curriculum, content.lessons, new Set(c.completed), c.path, new Set(c.passed))?.id ?? null,
    passedUnits: units.filter((u) => isUnitPassed(content.curriculum, content.lessons, u.id, { completed: new Set(c.completed), passed: new Set(c.passed) })).map((u) => u.id),
  })),
};

// --- Plafonds, niveaux (contrat phase5 §3).
const caps = [
  { xpGained: 30, itemsCount: 8, durationMs: 360_000 },
  { xpGained: 999_999, itemsCount: 5000, durationMs: 864_000_000 },
  { xpGained: 500, itemsCount: 3, durationMs: 60_000.6 },
  { xpGained: 20, itemsCount: 0, durationMs: 0 },
  { xpGained: 1200, itemsCount: 70, durationMs: 14_400_001 },
].map((input) => ({ input, output: capSessionTotals(input) }));
const levels = [0, 1, 99, 100, 249, 250, 449, 450, 5000, 63_699, 63_700, 63_701, 1_000_000].map((xp) => ({ xp, level: levelForXp(xp) }));

// --- Série : enregistrement et lecture, gel daté (contrat phase5 §3).
const base: Streak = { current: 8, longest: 12, lastActiveDate: "2026-09-01", freezesAvailable: 1, frozenUntil: null, frozenFrom: null };
const streakStates: { name: string; streak: Streak }[] = [
  { name: "plain", streak: base },
  { name: "no-freeze", streak: { ...base, freezesAvailable: 0 } },
  { name: "frozen-same-day", streak: { ...base, frozenUntil: "2026-09-10", frozenFrom: "2026-09-01" } },
  { name: "frozen-late", streak: { ...base, freezesAvailable: 0, frozenUntil: "2026-09-10", frozenFrom: "2026-09-05" } },
  { name: "frozen-legacy", streak: { ...base, freezesAvailable: 0, frozenUntil: "2026-09-06", frozenFrom: null } },
  { name: "nine", streak: { ...base, current: 9, longest: 9, freezesAvailable: 2 } },
  { name: "empty", streak: { current: 0, longest: 0, lastActiveDate: null, freezesAvailable: 0, frozenUntil: null, frozenFrom: null } },
];
const streakDays = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-06", "2026-09-08", "2026-09-11", "2026-09-12"];
const streaks = streakStates.flatMap(({ name, streak }) =>
  streakDays.map((day) => ({ name, streak, day, recorded: recordActivity(streak, day), displayed: streakAt(streak, day).current })),
);

// --- Badges (contrat phase5 §3).
const allWords = new Set([...content.concepts.values()].filter((c) => c.type === "word").map((c) => c.id));
const badgeCases = [
  { name: "none", completed: [] as string[], passed: [] as string[], streak: { ...base, current: 0, longest: 0 }, knownWords: 0, toneLog: [] as boolean[], southLog: [] as boolean[], cultureCardsPassed: 0 },
  { name: "streaks", completed: unitLessons(0), passed: [], streak: { ...base, current: 100, longest: 364 }, knownWords: 499, toneLog: Array(50).fill(true), southLog: [...Array(29).fill(true), false], cultureCardsPassed: 19 },
  { name: "max", completed: upTo(24), passed: testsOf(upTo(24)), streak: { ...base, current: 365, longest: 365 }, knownWords: 500, toneLog: [false, ...Array(49).fill(true)], southLog: [false, false, ...Array(28).fill(true)], cultureCardsPassed: 20 },
];
const badges = badgeCases.map((c) => {
  const progressSets = { completed: new Set(c.completed), passed: new Set(c.passed) };
  const passedUnits = new Set(units.filter((u) => isUnitPassed(content.curriculum, content.lessons, u.id, progressSets)).map((u) => u.id));
  const earned = evaluateBadges(
    { curriculum: content.curriculum, completedLessons: progressSets.completed, streak: c.streak, knownWords: c.knownWords, toneLog: c.toneLog, southLog: c.southLog, cultureCardsPassed: c.cultureCardsPassed, passedUnits, features: content.pack.features },
    new Set(),
  );
  return { ...c, earned };
});
void allWords;

writeFileSync(
  join(here, "core_parity.json"),
  JSON.stringify({
    random, text, exercises, grades, challengeWeeks, planner: { now: NOW.toISOString(), masteredPool, duePool, cases: planner },
    mediaGrades: { pitchRef: PITCH_REF, cases: mediaGrades }, progression, caps, levels, streaks, badges,
  }) + "\n",
);
console.log(`core_parity.json : ${exercises.length} exercices, ${planner.length} plans, ${mediaGrades.length} notations médias, ${streaks.length} séries`);
