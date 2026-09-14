import { describe, expect, it } from "vitest";
import { recordResult, startLesson, type LessonRun, type StepResult } from "./engine.ts";
import { completeLesson, conceptRating, XP_NEW_ITEM } from "./progress.ts";
import { newCard, review } from "./srs.ts";
import { loadPack } from "./testing/pack.ts";

const content = loadPack();
const NOW = new Date("2026-09-14T08:00:00Z");
const l03 = content.lessons.get("vi-south.u01.l03")!;

function runWith(results: Omit<StepResult, "attempt">[]): LessonRun {
  const run = startLesson(l03, "s", NOW);
  return { ...run, cursor: run.queue.length, results: results.map((r) => ({ ...r, attempt: 1 })) };
}

describe("progress", () => {
  it("leçon réussie : une carte par concept introduit, 10 XP chacun", () => {
    const outcome = completeLesson(l03, runWith([]), new Map(), NOW);
    expect(outcome.cards.map((c) => c.conceptId)).toEqual(l03.review.srsIntroduce);
    expect(outcome.cards.every((c) => c.reps === 1)).toBe(true);
    expect(outcome.xp).toBe(l03.review.srsIntroduce.length * XP_NEW_ITEM);
  });

  it("un concept raté à chaque essai n'est pas compté comme appris", () => {
    const formats = new Map(l03.steps.map((s, i) => [i, s.type]));
    const failed = runWith([{ stepIndex: 1, correct: false, nearMiss: false, graded: true, responseMs: 2000, conceptIds: ["c_ba"] }]);
    expect(conceptRating(failed.results, "c_ba", formats)).toBe("again");
    const outcome = completeLesson(l03, failed, new Map(), NOW);
    expect(outcome.learned).not.toContain("c_ba");
  });

  it("ne recrée pas une carte existante : elle est révisée", () => {
    const prior = review(newCard("c_ba", new Date("2026-09-01")), "good", new Date("2026-09-01"));
    const outcome = completeLesson(l03, runWith([]), new Map([["c_ba", prior]]), NOW);
    expect(outcome.cards.find((c) => c.conceptId === "c_ba")?.reps).toBe(2);
    expect(outcome.learned).not.toContain("c_ba");
  });

  it("recordResult alimente bien les concepts du résultat", () => {
    // garde-fou d'intégration entre engine et progress
    const run = startLesson(l03, "s", NOW);
    expect(recordResult(run, { type: "unsupported", stepIndex: 0, conceptIds: ["c_ba"], explain: null, stepType: "fill_gap" }, { correct: true, nearMiss: false, graded: false, expected: "", explain: null }, 1).results[0]?.conceptIds).toEqual(["c_ba"]);
  });
});
