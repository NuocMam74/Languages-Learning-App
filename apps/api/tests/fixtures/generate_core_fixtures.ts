/**
 * Fixtures de parité Python ↔ packages/core (moteur d'exercices, aléa, texte, planificateur).
 *
 * Régénérer depuis la racine du dépôt après toute modification de engine.ts, text.ts ou session.ts :
 *   npx tsx apps/api/tests/fixtures/generate_core_fixtures.ts
 *
 * Écrit apps/api/tests/fixtures/core_parity.json, rejoué par apps/api/tests/test_core_parity.py.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildExercise,
  compareAnswer,
  evaluate,
  examLesson,
  flatIndexOf,
  gradeExam,
  localChallengeSpec,
  buildExam,
  newCard,
  normalizeAnswer,
  planSession,
  review,
  seededRandom,
  type ExamAnswer,
  type ExamFile,
  type ExerciseResponse,
  type Lesson,
  type SrsCard,
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

function answerSet(seed: string, variant: number): ExamAnswer[] {
  return buildExam(content, exam, seed).flatMap((q, i) => {
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
    const answers = answerSet(seed, variant);
    const g = gradeExam(exam, buildExam(content, exam, seed), answers);
    return { seed, answers, passed: g.passed, global: g.global, scores: g.scores, gaps: g.gaps };
  }),
);

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

writeFileSync(join(here, "core_parity.json"), JSON.stringify({ random, text, exercises, grades, challengeWeeks, planner: { now: NOW.toISOString(), masteredPool, duePool, cases: planner } }) + "\n");
console.log(`core_parity.json : ${exercises.length} exercices, ${planner.length} plans`);
