import { buildContentIndex, buildExercise, currentItem, evaluate, isFinished, type ContentIndex, type Exercise, type ExerciseResponse, type RawPackFiles } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../scripts/lib/load-pack.ts";
import { loadPack } from "./content.ts";
import { ParloDB, setDb } from "./db.ts";
import { completedLessons, currentSnapshot, finishLesson, getTotals, openLesson, submitAnswer } from "./learner.ts";

/**
 * Critère d'acceptation Phase 0 (spec §15) : un invité termine une leçon hors
 * ligne, et sa progression est conservée après redémarrage.
 */

const raw: RawPackFiles = toRaw(readPackFiles("vi-south"));
let dbName = "";

function restart(): void {
  setDb(new ParloDB(dbName));
}

function answerFor(ex: Exercise): ExerciseResponse {
  switch (ex.type) {
    case "build_sentence": {
      const words = ex.target.replace(/[.,!?]/g, "").split(" ");
      const ids: string[] = [];
      for (let i = 0; i < words.length; ) {
        const tok = ex.tokens.find((t) => !ids.includes(t.id) && t.text !== undefined && words.slice(i, i + t.text.split(" ").length).join(" ") === t.text);
        if (!tok?.text) throw new Error(`jeton introuvable pour ${words[i]}`);
        ids.push(tok.id);
        i += tok.text.split(" ").length;
      }
      return { kind: "tokens", optionIds: ids };
    }
    case "speak_repeat":
      return { kind: "speech", score: null };
    case "game":
    case "unsupported":
      return { kind: "skip" };
    default:
      return { kind: "choice", optionId: ex.answerId };
  }
}

const offlineFetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
const onlineFetch = (() => Promise.resolve(new Response(JSON.stringify(raw)))) as typeof fetch;

describe("parcours invité hors ligne", () => {
  beforeEach(() => {
    dbName = `parlo-test-${Math.random()}`;
    restart();
  });
  afterEach(() => setDb(null));

  it("charge le contenu une fois en ligne, puis sans réseau", async () => {
    await loadPack("vi-south", onlineFetch);
    restart();
    const content = await loadPack("vi-south", offlineFetch);
    expect(content.lessons.has("vi-south.u01.l01")).toBe(true);
  });

  it("termine une leçon hors ligne et retrouve tout après redémarrage", async () => {
    await loadPack("vi-south", onlineFetch);
    restart();
    const content: ContentIndex = await loadPack("vi-south", offlineFetch);
    const lesson = content.lessons.get("vi-south.u01.l01")!;

    let run = await openLesson(content, lesson.id);
    while (!isFinished(run)) {
      const ex = buildExercise(content, lesson, currentItem(run)!.stepIndex, run.sessionId);
      run = await submitAnswer(content.pack.code, run, ex, evaluate(ex, answerFor(ex)), 1800);
    }
    const recap = await finishLesson(content, run);
    expect(recap.xp).toBeGreaterThan(0);

    restart();
    const d = new ParloDB(dbName);
    setDb(d);
    expect(await completedLessons()).toEqual(new Set([lesson.id]));
    expect((await getTotals()).xp).toBe(recap.xp);
    expect((await getTotals()).streak.current).toBe(1);
    expect(await d.srsCards.count()).toBe(lesson.review.srsIntroduce.length);
    expect(await currentSnapshot()).toBeUndefined();

    const types = (await d.outbox.toArray()).map((r) => r.event.type);
    expect(types[0]).toBe("session_started");
    expect(types).toContain("answer_submitted");
    expect(types.slice(-2)).toEqual(["lesson_completed", "session_completed"]);
  });

  it("reprend exactement là où la leçon a été interrompue", async () => {
    const content = buildContentIndex(raw);
    const lesson = content.lessons.get("vi-south.u01.l02")!;
    let run = await openLesson(content, lesson.id);
    for (let i = 0; i < 3; i++) {
      const ex = buildExercise(content, lesson, currentItem(run)!.stepIndex, run.sessionId);
      run = await submitAnswer(content.pack.code, run, ex, evaluate(ex, answerFor(ex)), 1000);
    }

    restart();
    const resumed = await openLesson(content, lesson.id);
    expect(resumed).toEqual(run);
    expect(resumed.cursor).toBe(3);
    // Même graine : les options réapparaissent dans le même ordre.
    expect(buildExercise(content, lesson, 3, resumed.sessionId)).toEqual(buildExercise(content, lesson, 3, run.sessionId));
  });
});
