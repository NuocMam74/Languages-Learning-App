import { describe, expect, it } from "vitest";
import { buildExercise, currentItem, evaluate, recordResult, type Exercise, type ExerciseResponse } from "./engine.ts";
import { XP_REVIEW } from "./progress.ts";
import { buildReviewExercise } from "./review.ts";
import { planSession } from "./session.ts";
import { conceptsToTeach, isPracticeRun, markTaught, recordReviewResult, reviewSeed, sessionItemsDone, sessionPhase, startSessionRun } from "./session-run.ts";
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

    // Découverte (contrat phase10 §1) : la leçon se présente avant de se pratiquer, une fois,
    // après le réveil et le rappel espacé. Ce n'est pas un item : rien n'est noté, et la barre de
    // progression ne bouge pas.
    expect(phase.kind).toBe("teach");
    if (phase.kind !== "teach") throw new Error(phase.kind);
    expect(phase.conceptIds).toEqual(conceptsToTeach(run, content));
    expect(phase.conceptIds.length).toBeGreaterThan(0);
    const doneBefore = sessionItemsDone(run);
    run = markTaught(run);
    expect(sessionItemsDone(run)).toBe(doneBefore);
    phase = sessionPhase(run, content);
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

describe("mode entraînement (contrat phase8 §2)", () => {
  const plan = planSession({ targetMinutes: 10, cards: [], nextLesson: l01, now: NOW });

  it("une séance ordinaire n'a pas de mode : le champ reste absent", () => {
    const run = startSessionRun({ plan, sessionId: "s", source: "lesson", lesson: l01, known: [], now: NOW });
    expect("mode" in run).toBe(false);
    expect(isPracticeRun(run)).toBe(false);
    // Snapshot écrit avant le contrat phase8 : relu comme une séance ordinaire.
    expect(isPracticeRun(JSON.parse(JSON.stringify(run)) as typeof run)).toBe(false);
  });

  it("marque la séance et survit à un aller-retour JSON", () => {
    const run = startSessionRun({ plan, sessionId: "p", source: "lesson", lesson: l01, known: [], now: NOW, mode: "practice" });
    expect(run.mode).toBe("practice");
    expect(isPracticeRun(run)).toBe(true);
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });

  it("ne change rien aux étapes ni à la file, et saute la découverte", () => {
    const normal = startSessionRun({ plan, sessionId: "s", source: "lesson", lesson: l01, known: [], now: NOW });
    const practice = startSessionRun({ plan, sessionId: "s", source: "lesson", lesson: l01, known: [], now: NOW, mode: "practice" });
    expect({ ...practice, mode: undefined }).toEqual({ ...normal, mode: undefined });
    // Seule différence de déroulé : on rejoue une leçon déjà terminée pour s'exercer, pas pour la
    // découvrir — la fiche serait un contresens (contrat phase10 §1).
    expect(sessionPhase(normal, content).kind).toBe("teach");
    expect(sessionPhase(practice, content).kind).toBe("new");
    // Une fois la fiche lue, les deux déroulés se rejoignent exactement.
    expect(sessionPhase(markTaught(normal), content).kind).toBe("new");
  });
});
