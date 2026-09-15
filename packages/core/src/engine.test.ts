import { describe, expect, it } from "vitest";
import {
  buildExercise,
  currentItem,
  evaluate,
  isFinished,
  lessonScore,
  recordResult,
  SPEAK_PASS_SCORE,
  startLesson,
  TUTOR_NUDGE_AFTER,
  type Exercise,
  type ExerciseResponse,
} from "./engine.ts";
import { loadPack } from "./testing/pack.ts";
import type { Lesson } from "./types.ts";

const content = loadPack();
const NOW = new Date("2026-09-14T08:00:00Z");
const lesson = (id: string): Lesson => content.lessons.get(id)!;

/** Réponse juste pour un exercice donné (simule un élève parfait). */
function rightAnswer(ex: Exercise): ExerciseResponse {
  switch (ex.type) {
    case "build_sentence": {
      const ids: string[] = [];
      const used = new Set<string>();
      for (const word of ex.target.replace(/[.,!?]/g, "").split(" ")) {
        // Jetons de plusieurs mots (« cảm ơn ») : on consomme greedy.
        const tok = ex.tokens.find((t) => !used.has(t.id) && t.text !== undefined && ex.target.replace(/[.,!?]/g, "").includes(t.text) && t.text.split(" ")[0] === word);
        if (tok) {
          used.add(tok.id);
          ids.push(tok.id);
        }
      }
      return { kind: "tokens", optionIds: ids };
    }
    case "speak_repeat":
    case "tone_produce":
      return { kind: "speech", score: 85 };
    case "game":
      return { kind: "game", correct: 9, total: 10 };
    case "unsupported":
      return { kind: "skip" };
    default:
      return { kind: "choice", optionId: ex.answerId };
  }
}

function wrongAnswer(ex: Exercise): ExerciseResponse {
  if ("answerId" in ex) return { kind: "choice", optionId: ex.options.find((o) => o.id !== ex.answerId)?.id ?? "x" };
  if (ex.type === "build_sentence") return { kind: "tokens", optionIds: [] };
  if (ex.type === "speak_repeat" || ex.type === "tone_produce") return { kind: "speech", score: 10 };
  return { kind: "skip" };
}

describe("buildExercise", () => {
  it("construit toutes les étapes des leçons d'exemple", () => {
    for (const l of content.lessons.values()) {
      l.steps.forEach((step, i) => {
        const ex = buildExercise(content, l, i, "seed");
        expect(ex.type === "unsupported" ? ex.stepType : ex.type).toBe(step.type);
      });
    }
  });

  it("est déterministe pour une même graine (reprise exacte)", () => {
    const l = lesson("vi-south.u01.l02");
    expect(buildExercise(content, l, 1, "s1")).toEqual(buildExercise(content, l, 1, "s1"));
  });

  it("la bonne réponse figure toujours parmi les options", () => {
    for (const l of content.lessons.values()) {
      l.steps.forEach((_, i) => {
        const ex = buildExercise(content, l, i, `seed${i}`);
        if ("answerId" in ex) expect(ex.options.map((o) => o.id)).toContain(ex.answerId);
      });
    }
  });

  it("tone_identify : mả (hỏi) appartient à la classe hỏi/ngã", () => {
    const l = lesson("vi-south.u01.l01");
    const idx = l.steps.findIndex((s) => s.type === "tone_identify" && s.concept === "c_ma_tomb");
    const ex = buildExercise(content, l, idx, "x");
    if (ex.type !== "tone_identify") throw new Error("type inattendu");
    expect(ex.options).toHaveLength(5);
    expect(ex.options.find((o) => o.id === ex.answerId)?.tones).toEqual(["hoi", "nga"]);
  });
});

describe("evaluate", () => {
  const l03 = lesson("vi-south.u01.l03");
  const buildIdx = l03.steps.findIndex((s) => s.type === "build_sentence");
  const build = buildExercise(content, l03, buildIdx, "x");
  if (build.type !== "build_sentence") throw new Error("type inattendu");
  const idOf = (text: string) => build.tokens.find((t) => t.text === text)!.id;

  it("build_sentence juste", () => {
    const ev = evaluate(build, { kind: "tokens", optionIds: ["Đây", "là", "ba", "tôi"].map(idOf) });
    expect(ev).toMatchObject({ correct: true, graded: true });
  });

  it("build_sentence : bà au lieu de ba = presque (ton seul)", () => {
    const ev = evaluate(build, { kind: "tokens", optionIds: ["Đây", "là", "bà", "tôi"].map(idOf) });
    expect(ev).toMatchObject({ correct: false, nearMiss: true, expected: "Đây là ba tôi." });
    expect(ev.explain?.fr).toContain("Đây là");
  });

  it("speak_repeat sans micro : non noté, ne bloque pas", () => {
    const idx = l03.steps.findIndex((s) => s.type === "speak_repeat");
    const ex = buildExercise(content, l03, idx, "x");
    expect(evaluate(ex, { kind: "speech", score: null })).toMatchObject({ correct: true, graded: false });
  });

  it("speak_repeat noté : seuil SPEAK_PASS_SCORE, presque juste dans les 15 points", () => {
    const idx = l03.steps.findIndex((s) => s.type === "speak_repeat");
    const ex = buildExercise(content, l03, idx, "x");
    expect(evaluate(ex, { kind: "speech", score: SPEAK_PASS_SCORE })).toMatchObject({ correct: true, graded: true });
    expect(evaluate(ex, { kind: "speech", score: SPEAK_PASS_SCORE - 10 })).toMatchObject({ correct: false, nearMiss: true, graded: true });
  });

  describe("tone_produce", () => {
    const base = lesson("vi-south.u01.l01");
    const toneLesson: Lesson = { ...base, steps: [{ type: "tone_produce", concept: "c_ma_mom" }] };
    const ex = buildExercise(content, toneLesson, 0, "x");

    it("se construit (plus « unsupported ») avec le ton écrit du concept", () => {
      expect(ex).toMatchObject({ type: "tone_produce", conceptIds: ["c_ma_mom"], tone: "sac", pitchRef: null });
      if (ex.type !== "tone_produce") throw new Error("type inattendu");
      expect(ex.concept.vi).toBe("má");
    });

    it("évalué comme speak_repeat : score ≥ SPEAK_PASS_SCORE", () => {
      expect(evaluate(ex, { kind: "speech", score: 92 })).toMatchObject({ correct: true, graded: true, expected: "má" });
      expect(evaluate(ex, { kind: "speech", score: SPEAK_PASS_SCORE - 1 })).toMatchObject({ correct: false, nearMiss: true, graded: true });
      expect(evaluate(ex, { kind: "speech", score: 5 })).toMatchObject({ correct: false, nearMiss: false, graded: true });
    });

    it("micro refusé : non noté ; mauvaise forme de réponse : fausse", () => {
      expect(evaluate(ex, { kind: "speech", score: null })).toMatchObject({ correct: true, graded: false });
      expect(evaluate(ex, { kind: "choice", optionId: "x" })).toMatchObject({ correct: false, graded: false });
    });
  });

  it("carte culture : jamais notée", () => {
    const ex = buildExercise(content, l03, 0, "x");
    expect(evaluate(ex, wrongAnswer(ex))).toMatchObject({ correct: false, graded: false });
  });
});

describe("déroulé de leçon", () => {
  it("un élève parfait termine en une passe avec un score de 1", () => {
    const l = lesson("vi-south.u01.l01");
    let run = startLesson(l, "sess", NOW);
    while (!isFinished(run)) {
      const item = currentItem(run)!;
      const ex = buildExercise(content, l, item.stepIndex, run.sessionId);
      run = recordResult(run, ex, evaluate(ex, rightAnswer(ex)), 2000);
    }
    expect(run.results).toHaveLength(l.steps.length);
    expect(lessonScore(run)).toBe(1);
  });

  it("une erreur relance l'étape une fois en fin de leçon, jamais plus", () => {
    const l = lesson("vi-south.u01.l01");
    let run = startLesson(l, "sess", NOW);
    const fail = (stepIndex: number) => {
      const ex = buildExercise(content, l, stepIndex, run.sessionId);
      run = recordResult(run, ex, evaluate(ex, wrongAnswer(ex)), 2000);
    };
    fail(currentItem(run)!.stepIndex); // culture : non notée, pas de relance
    expect(run.queue).toHaveLength(l.steps.length);
    fail(currentItem(run)!.stepIndex); // paire minimale ratée : relancée
    expect(run.queue).toHaveLength(l.steps.length + 1);
    expect(run.queue.at(-1)).toEqual({ stepIndex: 1, attempt: 2 });

    while (!isFinished(run)) fail(currentItem(run)!.stepIndex);
    expect(run.queue.filter((q) => q.stepIndex === 1)).toHaveLength(2);
    expect(lessonScore(run)).toBe(0);
  });

  it(`Cô Mai intervient après ${TUTOR_NUDGE_AFTER} erreurs consécutives sur un concept`, () => {
    const l = lesson("vi-south.u01.l01");
    let run = startLesson(l, "sess", NOW);
    const momSteps = l.steps.flatMap((s, i) => {
      const ex = buildExercise(content, l, i, "sess");
      return ex.conceptIds.length === 1 && ex.conceptIds[0] === "c_ma_mom" && ex.type !== "game" ? [i] : [];
    });
    expect(momSteps.length).toBeGreaterThanOrEqual(TUTOR_NUDGE_AFTER);
    for (const stepIndex of momSteps.slice(0, TUTOR_NUDGE_AFTER)) {
      run = { ...run, queue: [...run.queue.slice(0, run.cursor), { stepIndex, attempt: 1 }, ...run.queue.slice(run.cursor)] };
      const ex = buildExercise(content, l, stepIndex, "sess");
      run = recordResult(run, ex, evaluate(ex, wrongAnswer(ex)), 1000);
    }
    expect(run.tutorNudge).toBe("c_ma_mom");
  });

  it("un mini-jeu raté n'est pas relancé, mais son résultat est noté", () => {
    const l = lesson("vi-south.u01.l01");
    const gameIdx = l.steps.findIndex((s) => s.type === "game");
    let run = startLesson(l, "sess", NOW);
    run = { ...run, cursor: run.queue.findIndex((q) => q.stepIndex === gameIdx) };
    const ex = buildExercise(content, l, gameIdx, "sess");
    const ev = evaluate(ex, { kind: "game", correct: 2, total: 10 });
    expect(ev).toMatchObject({ correct: false, graded: true });
    const next = recordResult(run, ex, ev, 30_000);
    expect(next.queue).toHaveLength(run.queue.length);
    expect(next.results.at(-1)).toMatchObject({ stepIndex: gameIdx, correct: false, graded: true });
  });

  it("l'état survit à un aller-retour JSON (sauvegarde locale)", () => {
    const l = lesson("vi-south.u01.l02");
    let run = startLesson(l, "sess", NOW);
    const ex = buildExercise(content, l, 0, "sess");
    run = recordResult(run, ex, evaluate(ex, rightAnswer(ex)), 1500);
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });
});
