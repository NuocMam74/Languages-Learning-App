import { describe, expect, it } from "vitest";
import { buildExercise, currentItem, evaluate, recordResult, type Exercise, type ExerciseResponse } from "./engine.ts";
import { XP_REVIEW } from "./progress.ts";
import { buildReviewExercise } from "./review.ts";
import { planSession } from "./session.ts";
import { recordReviewResult, reviewSeed, sessionItemsDone, sessionPhase, startSessionRun } from "./session-run.ts";
import { newCard, review } from "./srs.ts";
import { loadPack } from "./testing/pack.ts";

const content = loadPack();
const NOW = new Date("2026-09-14T08:00:00Z");
const PAST = new Date("2026-09-01T08:00:00Z");
const l01 = content.lessons.get("vi-south.u01.l01")!;

const choice = (ex: Exercise, right: boolean): ExerciseResponse =>
  "answerId" in ex ? { kind: "choice", optionId: right ? ex.answerId : (ex.options.find((o) => o.id !== ex.answerId)?.id ?? "") } : { kind: "skip" };

describe("déroulé de séance", () => {
  const cards = ["c_ba", "c_anh"].map((id) => review(newCard(id, PAST), "good", PAST));
  const plan = planSession({ targetMinutes: 10, cards, nextLesson: l01, now: NOW });

  it("révisions, puis nouveau, puis mise en pratique (jeu), puis bilan", () => {
    let run = startSessionRun({ plan, sessionId: "s", source: "daily", lesson: l01, known: ["c_ba", "c_anh"], now: NOW });
    expect(sessionPhase(run, content).kind).toBe("review");

    // Une erreur : l'item revient en fin de révision.
    let phase = sessionPhase(run, content);
    if (phase.kind !== "review") throw new Error(phase.kind);
    let ex = buildReviewExercise(content, phase.item.conceptId, reviewSeed(run, phase.index));
    run = recordReviewResult(run, ex, evaluate(ex, choice(ex, false)), 1000);
    expect(run.reviewQueue).toHaveLength(3);
    expect(run.xp).toBe(0);

    while ((phase = sessionPhase(run, content)).kind === "review") {
      ex = buildReviewExercise(content, phase.item.conceptId, reviewSeed(run, phase.index));
      run = recordReviewResult(run, ex, evaluate(ex, choice(ex, true)), 1000);
    }
    expect(run.xp).toBe(XP_REVIEW); // seul le premier essai réussi rapporte
    expect(phase.kind).toBe("new");

    const kinds = new Set<string>();
    while ((phase = sessionPhase(run, content)).kind === "new" || phase.kind === "practice") {
      kinds.add(phase.kind);
      const lesson = run.lesson!;
      const step = buildExercise(content, l01, currentItem(lesson)!.stepIndex, run.sessionId);
      run = { ...run, lesson: recordResult(lesson, step, evaluate(step, { kind: "skip" }), 500) };
    }
    expect(kinds).toEqual(new Set(["new", "practice"]));
    expect(phase.kind).toBe("save_lesson");
    run = { ...run, lessonSaved: true };
    expect(sessionPhase(run, content).kind).toBe("recap");
    expect(sessionItemsDone(run)).toBe(3 + l01.steps.length);
  });

  it("séance de révision seule : pas de leçon", () => {
    const reviewPlan = planSession({ targetMinutes: 10, cards, nextLesson: null, now: NOW });
    const run = startSessionRun({ plan: reviewPlan, sessionId: "r", source: "review", lesson: l01, known: [], now: NOW });
    expect(run.lesson).toBeNull();
    expect(run.reviewQueue.map((i) => i.conceptId).sort()).toEqual(["c_anh", "c_ba"]);
  });

  it("survit à un aller-retour JSON", () => {
    const run = startSessionRun({ plan, sessionId: "s", source: "daily", lesson: l01, known: [], now: NOW });
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });
});
