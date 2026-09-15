import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exercise, ExerciseResponse } from "./engine.ts";
import {
  buildExam,
  checkExam,
  EXAM_ITEM_COUNT,
  examItemRefs,
  flatIndexOf,
  gradeExam,
  isExamUnlocked,
  lessonsForConcepts,
  nextExamAttemptAt,
  revisionLessons,
  type ExamAnswer,
  type ExamFile,
  type ExamQuestion,
} from "./exams.ts";
import { loadPack } from "./testing/pack.ts";

const content = loadPack();
const exam = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "content", "vi-south", "exams", "a0.json"), "utf8")) as ExamFile;

function right(ex: Exercise): ExerciseResponse {
  switch (ex.type) {
    case "build_sentence": {
      // Construction gloutonne de la cible avec les jetons (jetons multi-mots compris).
      let rest = ex.target;
      const ids: string[] = [];
      const used = new Set<string>();
      while (rest.trim()) {
        const tok = ex.tokens.find((t) => !used.has(t.id) && t.text && rest.trimStart().startsWith(t.text));
        if (!tok?.text) break;
        used.add(tok.id);
        ids.push(tok.id);
        rest = rest.trimStart().slice(tok.text.length).replace(/^[.,!?]/, "");
      }
      return { kind: "tokens", optionIds: ids };
    }
    case "speak_repeat":
    case "tone_produce":
      return { kind: "speech", score: 80 };
    default:
      return "answerId" in ex ? { kind: "choice", optionId: ex.answerId } : { kind: "skip" };
  }
}

const answersFor = (questions: ExamQuestion[], pick: (q: ExamQuestion) => ExerciseResponse = (q) => right(q.exercise)): ExamAnswer[] =>
  questions.map((q) => ({ section: q.section, index: q.index, response: pick(q), responseMs: 1000 }));

describe("examens : fichier A0", () => {
  it("est valide (25 items, sections, concepts des unités requises)", () => {
    expect(checkExam(content, exam).filter((i) => i.level === "error")).toEqual([]);
    expect(examItemRefs(exam)).toHaveLength(EXAM_ITEM_COUNT);
  });

  it("signale un concept hors des unités requises et un total faux", () => {
    const broken: ExamFile = structuredClone(exam);
    broken.requiresUnits = ["vi-south.u01"];
    broken.sections[3]?.items.pop();
    const messages = checkExam(content, broken).filter((i) => i.level === "error").map((i) => i.message);
    expect(messages.some((m) => m.includes("hors des unités requises"))).toBe(true);
    expect(messages.some((m) => m.includes("24 items"))).toBe(true);
  });
});

describe("examens : construction", () => {
  it("index à plat dans l'ordre des sections", () => {
    expect(flatIndexOf(exam, { section: "listening", index: 0 })).toBe(0);
    expect(flatIndexOf(exam, { section: "reading", index: 0 })).toBe(8);
    expect(flatIndexOf(exam, { section: "speaking", index: 4 })).toBe(24);
    expect(flatIndexOf(exam, { section: "speaking", index: 5 })).toBe(-1);
  });

  it("même graine = mêmes options ; graine différente = ordre qui peut changer", () => {
    const a = buildExam(content, exam, "attempt-1");
    const b = buildExam(content, exam, "attempt-1");
    expect(a.map((q) => q.exercise)).toEqual(b.map((q) => q.exercise));
    const orders = new Set(["s1", "s2", "s3", "s4", "s5", "s6"].map((seed) => JSON.stringify(buildExam(content, exam, seed).map((q) => ("options" in q.exercise ? q.exercise.options.map((o) => o.id) : [])))));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("respecte l'ordre de passage donné par le serveur", () => {
    const refs = [{ section: "speaking", index: 1 }, { section: "listening", index: 2 }] as const;
    const qs = buildExam(content, exam, "x", refs);
    expect(qs.map((q) => [q.section, q.index, q.flatIndex])).toEqual([["speaking", 1, 21], ["listening", 2, 2]]);
  });

  it("marque les items silencieux", () => {
    const qs = buildExam(content, exam, "x");
    expect(qs.filter((q) => q.silent).every((q) => q.section === "reading")).toBe(true);
    expect(qs.some((q) => q.silent)).toBe(true);
  });
});

describe("examens : notation §2.2", () => {
  const questions = buildExam(content, exam, "seed");

  it("tout juste : réussite, 100 % partout, aucune lacune", () => {
    const grade = gradeExam(exam, questions, answersFor(questions));
    expect(grade.passed).toBe(true);
    expect(grade.global).toBe(1);
    expect(grade.scores).toEqual({ listening: 1, reading: 1, vocabulary: 1, speaking: 1 });
    expect(grade.gaps).toEqual([]);
  });

  it("global pondéré par le nombre d'items", () => {
    // 6 fautes d'écoute sur 8 : 19/25 = 0.76 global, mais écoute 0.25 < 0.5 → échec.
    let wrong = 0;
    const grade = gradeExam(exam, questions, answersFor(questions, (q) => (q.section === "listening" && wrong++ < 6 ? { kind: "skip" } : right(q.exercise))));
    expect(grade.global).toBeCloseTo(19 / 25);
    expect(grade.scores.listening).toBeCloseTo(2 / 8);
    expect(grade.passed).toBe(false);
    expect(grade.gaps.map((g) => g.skill)).toEqual(["listening"]);
  });

  it("seuil global : 18/25 échoue même si chaque compétence ≥ 0.5", () => {
    const misses = new Set(["listening:0", "listening:1", "reading:0", "reading:1", "vocabulary:0", "vocabulary:1", "speaking:0"]);
    const grade = gradeExam(exam, questions, answersFor(questions, (q) => (misses.has(`${q.section}:${q.index}`) ? { kind: "skip" } : right(q.exercise))));
    expect(grade.global).toBeCloseTo(18 / 25);
    expect(Object.values(grade.scores).every((s) => (s ?? 0) >= 0.5)).toBe(true);
    expect(grade.passed).toBe(false);
  });

  it("oral : score ≥ 60 juste, < 60 faux, micro refusé faux à l'examen certifiant", () => {
    const speech = (score: number | null) => answersFor(questions, (q) => (q.section === "speaking" ? { kind: "speech", score } : right(q.exercise)));
    expect(gradeExam(exam, questions, speech(60)).scores.speaking).toBe(1);
    expect(gradeExam(exam, questions, speech(59)).scores.speaking).toBe(0);
    const refused = gradeExam(exam, questions, speech(null));
    expect(refused.scores.speaking).toBe(0);
    expect(refused.passed).toBe(false);
  });

  it("examen blanc : micro refusé = oral non noté, exclu du global", () => {
    const answers = answersFor(questions, (q) => (q.section === "speaking" ? { kind: "speech", score: null } : right(q.exercise)));
    const grade = gradeExam(exam, questions, answers, { allowUngradedSpeech: true });
    expect(grade.scores.speaking).toBeNull();
    expect(grade.global).toBe(1);
    expect(grade.passed).toBe(true);
  });

  it("réponse absente = faux", () => {
    const grade = gradeExam(exam, questions, answersFor(questions).slice(0, 20));
    expect(grade.scores.speaking).toBe(0);
    expect(grade.gaps.find((g) => g.skill === "speaking")?.conceptIds.length).toBeGreaterThan(0);
  });
});

describe("examens : accès et lacunes", () => {
  it("débloqué seulement quand toutes les leçons des unités requises sont faites", () => {
    const all = new Set(exam.requiresUnits.flatMap((u) => content.curriculum.units.find((x) => x.id === u)?.lessons ?? []));
    expect(isExamUnlocked(content.curriculum, exam, all)).toBe(true);
    const missing = new Set(all);
    missing.delete("vi-south.u04.l08");
    expect(isExamUnlocked(content.curriculum, exam, missing)).toBe(false);
  });

  it("avec les leçons : seuls les tests d'unité comptent (règle partagée avec l'API)", () => {
    const units = exam.requiresUnits.map((u) => content.curriculum.units.find((x) => x.id === u)!);
    const tests = new Set(units.flatMap((u) => u.lessons.filter((id) => content.lessons.get(id)?.kind === "unit_test")));
    expect(tests.size).toBe(units.length);
    expect(isExamUnlocked(content.curriculum, exam, tests, content.lessons)).toBe(true);
    const oneMissing = new Set(tests);
    oneMissing.delete([...tests][0]!);
    expect(isExamUnlocked(content.curriculum, exam, oneMissing, content.lessons)).toBe(false);
  });

  it("prochaine tentative 48 h après la dernière", () => {
    const now = new Date("2026-09-14T10:00:00Z");
    expect(nextExamAttemptAt(exam, null, now)).toBeNull();
    expect(nextExamAttemptAt(exam, "2026-09-13T10:00:00Z", now)?.toISOString()).toBe("2026-09-15T10:00:00.000Z");
    expect(nextExamAttemptAt(exam, "2026-09-12T09:00:00Z", now)).toBeNull();
  });

  it("leçons à revoir : première leçon qui introduit le concept, ordre du cursus", () => {
    const lessons = lessonsForConcepts(content, exam, ["c_vo", "c_chao"]);
    expect(lessons[0]?.startsWith("vi-south.u01")).toBe(true);
    expect(lessons.some((id) => id.startsWith("vi-south.u04"))).toBe(true);
  });

  it("examen blanc : une faute de spot_the_south renvoie à une leçon", () => {
    const questions = buildExam(content, exam, "seed");
    const grade = gradeExam(exam, questions, answersFor(questions, (q) => (q.exercise.type === "spot_the_south" ? { kind: "choice", optionId: "north" } : right(q.exercise))));
    expect(revisionLessons(content, exam, questions, grade).length).toBeGreaterThan(0);
  });
});
