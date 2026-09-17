import { evaluate, sessionPhase, type ContentIndex, type Exercise, type ExerciseResponse, type RawPackFiles, type SessionRun } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import { loadPack } from "../content.ts";
import { db, ParloDB, setDb } from "../db.ts";
import { finishSession, getTotals, markSessionTaught, openSession, packCards, saveLessonPart, sessionPath, submitSessionAnswer } from "../learner.ts";
import { exerciseFor } from "../session-store.ts";

/**
 * Rejouer une leçon terminée en **mode entraînement** (contrat phase8 §2) :
 * le SRS reçoit les réponses, mais rien n'est recompté — ni XP, ni série, ni leçon acquise,
 * et ni `lesson_completed` ni `session_completed` ne sont émis.
 */

const raw: RawPackFiles = toRaw(readPackFiles("vi-south"));
const LESSON = "vi-south.u01.l01";
let dbName = "";

const onlineFetch = (() => Promise.resolve(new Response(JSON.stringify(raw)))) as typeof fetch;

function answerFor(ex: Exercise): ExerciseResponse {
  switch (ex.type) {
    case "build_sentence": {
      const words = ex.target.replace(/[.,!?]/g, "").split(" ");
      const ids: string[] = [];
      for (let i = 0; i < words.length; ) {
        const tok = ex.tokens.find((t) => !ids.includes(t.id) && t.text !== undefined && words.slice(i, i + t.text.split(" ").length).join(" ") === t.text);
        if (!tok?.text) return { kind: "skip" };
        ids.push(tok.id);
        i += tok.text.split(" ").length;
      }
      return { kind: "tokens", optionIds: ids };
    }
    case "speak_repeat":
    case "tone_produce":
    case "speak_answer":
    case "speak_roleplay":
      return { kind: "speech", score: null };
    case "match_pairs":
      return { kind: "pairs", pairs: ex.answer };
    case "listen_transcribe":
    case "translate_to_vi":
      return { kind: "text", text: ex.accepted[0] ?? "" };
    case "translate_to_fr":
      return { kind: "text", text: ex.accepted.fr[0] ?? "" };
    case "dialogue_choice":
      return { kind: "path", turnIds: ex.bestReplyIds };
    case "game":
    case "unsupported":
      return { kind: "skip" };
    default:
      return "answerId" in ex ? { kind: "choice", optionId: ex.answerId } : { kind: "skip" };
  }
}

async function play(content: ContentIndex, start: SessionRun): Promise<SessionRun> {
  let run = start;
  for (let guard = 0; guard < 200; guard++) {
    const phase = sessionPhase(run, content);
    if (phase.kind === "recap") return run;
    if (phase.kind === "save_lesson") {
      run = await saveLessonPart(content, run);
      continue;
    }
    // Fiche de découverte (contrat phase10 §1) : la première séance, normale, la présente ; la
    // reprise en entraînement la saute d'elle-même — c'est ce que vérifie le test suivant.
    if (phase.kind === "teach") {
      run = await markSessionTaught(content, run);
      continue;
    }
    const ex = exerciseFor(content, run, phase);
    if (!ex) throw new Error(`aucun exercice pour la phase ${phase.kind}`);
    run = await submitSessionAnswer(content, run, ex, evaluate(ex, answerFor(ex)), 1500);
  }
  throw new Error("la séance ne se termine pas");
}

const eventTypes = async () => (await db().outbox.toArray()).map((row) => row.event.type);

describe("rejouer une leçon en entraînement", () => {
  beforeEach(() => {
    dbName = `parlo-practice-${Math.random()}`;
    setDb(new ParloDB(dbName));
  });
  afterEach(async () => {
    await db().close();
    setDb(null);
  });

  it("n'ajoute ni XP ni progression, mais nourrit le SRS", async () => {
    const content = await loadPack("vi-south", onlineFetch);

    // 1. La leçon, pour de vrai.
    const first = await finishSession(content, await play(content, await openSession(content, { source: "lesson", lessonId: LESSON })));
    expect(first.practice).toBe(false);
    expect(first.xp).toBeGreaterThan(0);

    const xpAfterFirst = (await getTotals()).xp;
    const streakAfterFirst = (await getTotals()).streak.current;
    const progressAfterFirst = await db().lessonProgress.get(LESSON);
    const cardsAfterFirst = new Map((await packCards()).map((c) => [c.conceptId, c]));
    const typesAfterFirst = await eventTypes();
    expect(typesAfterFirst.filter((t) => t === "lesson_completed")).toHaveLength(1);
    expect(typesAfterFirst.filter((t) => t === "session_completed")).toHaveLength(1);
    expect(cardsAfterFirst.size).toBeGreaterThan(0);

    // 2. La même leçon, en entraînement.
    const run = await openSession(content, { source: "lesson", lessonId: LESSON, practice: true });
    expect(run.mode).toBe("practice");
    // Une séance d'entraînement interrompue reprend sur sa propre route.
    expect(sessionPath(run)).toBe(`/lecon/${LESSON}/entrainement`);

    const recap = await finishSession(content, await play(content, run));
    expect(recap.practice).toBe(true);
    expect(recap.xp).toBe(0);
    expect(recap.firstLesson).toBe(false);
    expect(recap.unitTest).toBeNull();

    // 3. Rien n'a été recompté.
    expect((await getTotals()).xp).toBe(xpAfterFirst);
    expect((await getTotals()).streak.current).toBe(streakAfterFirst);
    const progressAfter = await db().lessonProgress.get(LESSON);
    expect(progressAfter?.attempts).toBe(progressAfterFirst?.attempts);
    expect(progressAfter?.bestScore).toBe(progressAfterFirst?.bestScore);
    expect(progressAfter?.completedAt).toBe(progressAfterFirst?.completedAt);

    // 4. Les événements restent honnêtes : les réponses sont dites, la leçon n'est pas re-acquise.
    const types = await eventTypes();
    expect(types.filter((t) => t === "lesson_completed")).toHaveLength(1);
    expect(types.filter((t) => t === "session_completed")).toHaveLength(1);
    expect(types.filter((t) => t === "session_started")).toHaveLength(2);
    expect(types.filter((t) => t === "answer_submitted").length).toBeGreaterThan(typesAfterFirst.filter((t) => t === "answer_submitted").length);

    // 5. Le SRS a bien reçu les réponses : au moins une carte a été revue de nouveau.
    const cardsAfter = await packCards();
    expect(cardsAfter.some((card) => (cardsAfterFirst.get(card.conceptId)?.reps ?? 0) < card.reps)).toBe(true);
    // Et aucune carte nouvelle n'a été introduite par l'entraînement.
    expect(cardsAfter).toHaveLength(cardsAfterFirst.size);
  });

  it("ne reprend pas une séance ordinaire à la place d'un entraînement", async () => {
    const content = await loadPack("vi-south", onlineFetch);
    const normal = await openSession(content, { source: "lesson", lessonId: LESSON });
    expect(normal.mode).toBeUndefined();

    // La demande d'entraînement ne doit pas hériter du snapshot ordinaire (ni l'inverse).
    const practice = await openSession(content, { source: "lesson", lessonId: LESSON, practice: true });
    expect(practice.mode).toBe("practice");
    expect(practice.sessionId).not.toBe(normal.sessionId);

    const backToNormal = await openSession(content, { source: "lesson", lessonId: LESSON });
    expect(backToNormal.mode).toBeUndefined();
    expect(backToNormal.sessionId).not.toBe(practice.sessionId);
  });
});
