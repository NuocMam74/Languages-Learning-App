import { describe, expect, it } from "vitest";
import { recordResult, startLesson, type LessonRun, type StepResult } from "./engine.ts";
import { capSessionTotals, completeLesson, conceptRating, levelForXp, levelName, XP_NEW_ITEM, xpForLevel } from "./progress.ts";
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

describe("niveaux de profil et plafonds (contrat phase5 §3)", () => {
  it("XP requise : 25·(L−1)·(L+2)", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(50)).toBe(63_700);
    expect(levelForXp(0)).toEqual({ value: 1, xpIntoLevel: 0, xpForNext: 100 });
    expect(levelForXp(99).value).toBe(1);
    expect(levelForXp(100)).toEqual({ value: 2, xpIntoLevel: 0, xpForNext: 150 });
    expect(levelForXp(710).value).toBe(5);
    expect(levelForXp(1_000_000)).toEqual({ value: 50, xpIntoLevel: 1_000_000 - 63_700, xpForNext: 0 });
  });

  it("nom par tranche de 5 niveaux", () => {
    const names = Array.from({ length: 10 }, (_, i) => `n${i}`);
    expect(levelName(names, 1)).toBe("n0");
    expect(levelName(names, 5)).toBe("n0");
    expect(levelName(names, 6)).toBe("n1");
    expect(levelName(names, 50)).toBe("n9");
    expect(levelName(undefined, 3)).toBeNull();
  });

  it("plafonds : écrêtage, jamais de rejet", () => {
    expect(capSessionTotals({ xpGained: 5000, itemsCount: 500, durationMs: 30 * 86_400_000 })).toEqual({ xpGained: 1000, itemsCount: 200, durationMs: 4 * 3_600_000 });
    expect(capSessionTotals({ xpGained: 200, itemsCount: 2, durationMs: 60_000 })).toEqual({ xpGained: 80, itemsCount: 2, durationMs: 60_000 });
    expect(capSessionTotals({ xpGained: 20, itemsCount: 0, durationMs: -5 })).toEqual({ xpGained: 20, itemsCount: 0, durationMs: 0 });
  });
});
