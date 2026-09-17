import {
  buildContentIndex,
  evaluate,
  newCard,
  review,
  sessionPhase,
  type ContentIndex,
  type Exercise,
  type ExerciseResponse,
  type PlacementSpec,
  type RawPackFiles,
  type SessionRun,
} from "@parlo/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../scripts/lib/load-pack.ts";
import { loadPack } from "./content.ts";
import { ParloDB, setDb } from "./db.ts";
import {
  completedLessons,
  currentSession,
  DEFAULT_PROFILE,
  finishSession,
  getBadges,
  getPlacement,
  getTotals,
  openSession,
  planning,
  saveLessonPart,
  saveProfile,
  savePlacement,
  submitSessionAnswer,
  type SessionRequest,
} from "./learner.ts";
import { exerciseFor } from "./session-store.ts";

/**
 * Critère d'acceptation Phase 0 (spec §15) : un invité termine une leçon hors
 * ligne, et sa progression est conservée après redémarrage. Phase 1 : la
 * séance complète (réveil, révisions, leçon) reprend exactement.
 */

const raw: RawPackFiles = toRaw(readPackFiles("vi-south"));
let dbName = "";

function restart(): void {
  setDb(new ParloDB(dbName));
}

function answerFor(ex: Exercise, right = true): ExerciseResponse {
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
      if (right) return { kind: "tokens", optionIds: ids };
      // Réponse fausse : un autre ordre que la cible. Les jetons peuvent se répéter (« tôi » deux
      // fois), donc on ne suppose pas qu'un échange suffit — on prend le premier ordre qui ne
      // reconstitue pas la phrase. `build_sentence` est un format de révision depuis la phase 9 :
      // sans ce cas, le helper répondait juste alors qu'on lui demandait de se tromper, et les
      // tests devenaient intermittents (le format est tiré au hasard par séance).
      const text = (order: string[]) => order.map((id) => ex.tokens.find((t) => t.id === id)?.text ?? "").join(" ");
      const swapped = ids.length > 1 ? [ids[1]!, ids[0]!, ...ids.slice(2)] : ids;
      const wrong = [swapped, [...ids].reverse()].find((order) => text(order) !== ex.target) ?? ids;
      return { kind: "tokens", optionIds: wrong };
    }
    case "speak_repeat":
    case "tone_produce":
    case "speak_answer":
    case "speak_roleplay":
      return { kind: "speech", score: null };
    // Appariement : les révisions riches en produisent depuis que l'interface sait les afficher (contrat phase6 §5).
    case "match_pairs":
      return { kind: "pairs", pairs: right ? ex.answer : ex.answer.map((p, i) => ({ leftId: p.leftId, rightId: ex.answer[(i + 1) % ex.answer.length]!.rightId })) };
    case "listen_transcribe":
    case "translate_to_vi":
      return { kind: "text", text: right ? (ex.accepted[0] ?? "") : "???" };
    case "translate_to_fr":
      return { kind: "text", text: right ? (ex.accepted.fr[0] ?? "") : "???" };
    case "dialogue_choice":
      return { kind: "path", turnIds: right ? ex.bestReplyIds : [] };
    case "game":
    case "unsupported":
      return { kind: "skip" };
    default:
      if (!("answerId" in ex)) return { kind: "skip" }; // type sans QCM : non joué ici
      return { kind: "choice", optionId: right ? ex.answerId : (ex.options.find((o) => o.id !== ex.answerId)?.id ?? "") };
  }
}

/** Joue `n` items (ou jusqu'au bilan), en enregistrant la leçon au passage comme le fait l'app. */
async function play(content: ContentIndex, start: SessionRun, n = Infinity, right = true): Promise<SessionRun> {
  let run = start;
  for (let i = 0; i < n; ) {
    const phase = sessionPhase(run, content);
    if (phase.kind === "recap") break;
    if (phase.kind === "save_lesson") {
      run = await saveLessonPart(content, run);
      continue;
    }
    const ex = exerciseFor(content, run, phase)!;
    run = await submitSessionAnswer(content, run, ex, evaluate(ex, answerFor(ex, right)), 1500);
    i++;
  }
  return run;
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

    const run = await play(content, await openSession(content, { source: "lesson", lessonId: lesson.id }));
    const recap = await finishSession(content, run);
    expect(recap.xp).toBeGreaterThan(0);
    expect(recap.firstLesson).toBe(true);
    expect(recap.badges).toEqual(["first_lesson"]);

    restart();
    const d = new ParloDB(dbName);
    setDb(d);
    expect(await completedLessons()).toEqual(new Set([lesson.id]));
    expect((await getTotals()).xp).toBe(recap.xp);
    expect((await getTotals()).streak.current).toBe(1);
    expect(await d.srsCards.count()).toBe(lesson.review.srsIntroduce.length);
    expect(await currentSession(content)).toBeNull();
    expect((await getBadges()).map((b) => b.code)).toEqual(["first_lesson"]);

    const types = (await d.outbox.toArray()).map((r) => r.event.type);
    expect(types[0]).toBe("session_started");
    expect(types).toContain("answer_submitted");
    expect(types.slice(-3)).toEqual(["lesson_completed", "session_completed", "badge_earned"]);
  });

  it("reprend exactement là où la leçon a été interrompue", async () => {
    const content = buildContentIndex(raw);
    const request: SessionRequest = { source: "lesson", lessonId: "vi-south.u01.l02" };
    const run = await play(content, await openSession(content, request), 3);

    restart();
    const resumed = await openSession(content, request);
    expect(resumed).toEqual(run);
    expect(resumed.lesson?.cursor).toBe(3);
    // Même graine : les options réapparaissent dans le même ordre.
    expect(exerciseFor(content, resumed, sessionPhase(resumed, content))).toEqual(exerciseFor(content, run, sessionPhase(run, content)));
  });

  it("reprend un snapshot de la Phase 0 (leçon seule)", async () => {
    const content = buildContentIndex(raw);
    const d = new ParloDB(dbName);
    setDb(d);
    const lessonRun = (await openSession(content, { source: "lesson", lessonId: "vi-south.u01.l01" })).lesson!;
    await d.snapshot.put({ key: "current", packCode: content.pack.code, run: lessonRun, savedAt: new Date().toISOString() });
    const resumed = await openSession(content, { source: "lesson", lessonId: "vi-south.u01.l01" });
    expect(resumed.lesson).toEqual(lessonRun);
  });
});

describe("séance du jour", () => {
  const PAST = new Date(Date.now() - 30 * 86_400_000);

  beforeEach(async () => {
    dbName = `parlo-daily-${Math.random()}`;
    restart();
    await saveProfile({ ...DEFAULT_PROFILE, dailyGoalMin: 10, onboardedAt: PAST.toISOString() });
  });
  afterEach(() => setDb(null));

  async function seedDue(d: ParloDB, ids: string[]) {
    await d.srsCards.bulkPut(ids.map((id) => review(newCard(id, PAST), "good", PAST)));
  }

  it("révisions puis leçon : reprise exacte à travers les blocs, SRS et événements", async () => {
    const content = buildContentIndex(raw);
    const d = new ParloDB(dbName);
    setDb(d);
    await seedDue(d, ["c_ba", "c_anh", "c_chao"]);
    const before = new Map((await d.srsCards.toArray()).map((c) => [c.conceptId, c]));

    const plan = (await planning(content, { ...DEFAULT_PROFILE, dailyGoalMin: 10 })).daily;
    expect(plan.blocks.map((b) => b.kind)).toEqual(["review", "new", "recap"]);

    let run = await openSession(content, { source: "daily" });
    expect(run.reviewQueue).toHaveLength(3);

    // 1) Interruption au milieu des révisions.
    run = await play(content, run, 2);
    restart();
    let resumed = await openSession(content, { source: "daily" });
    expect(resumed).toEqual(run);
    expect(sessionPhase(resumed, content).kind).toBe("review");
    expect(exerciseFor(content, resumed, sessionPhase(resumed, content))).toEqual(exerciseFor(content, run, sessionPhase(run, content)));

    // 2) Interruption dans la leçon.
    run = await play(content, resumed, 1 + 2);
    expect(sessionPhase(run, content).kind).toBe("new");
    expect(run.lesson?.cursor).toBe(2);
    restart();
    resumed = await openSession(content, { source: "daily" });
    expect(resumed).toEqual(run);

    // 3) Fin de la séance jusqu'au bilan.
    const daily = await play(content, resumed);
    expect(daily.lessonSaved).toBe(true);
    const recap = await finishSession(content, daily);
    expect(recap.source).toBe("daily");
    expect(recap.xp).toBeGreaterThanOrEqual(3 * 5 + 20);
    expect(recap.reviewed.sort()).toEqual(["c_anh", "c_ba", "c_chao"]);
    expect(recap.reviewedWell.sort()).toEqual(["c_anh", "c_ba", "c_chao"]);
    expect(recap.learned.length).toBeGreaterThan(0);

    const db2 = new ParloDB(dbName);
    setDb(db2);
    for (const id of ["c_ba", "c_anh", "c_chao"]) {
      expect((await db2.srsCards.get(id))!.reps).toBeGreaterThan(before.get(id)!.reps);
    }
    const events = (await db2.outbox.toArray()).map((r) => r.event);
    const reviewAnswers = events.filter((e) => e.type === "answer_submitted" && e.payload.lessonId === null);
    expect(reviewAnswers.length).toBeGreaterThanOrEqual(3);
    expect(events.filter((e) => e.type === "srs_card_updated").length).toBeGreaterThanOrEqual(3);
    expect(await currentSession(content)).toBeNull();
  });

  it("une autre demande (leçon choisie sur la carte) ne reprend pas la séance du jour", async () => {
    const content = buildContentIndex(raw);
    const d = new ParloDB(dbName);
    setDb(d);
    await seedDue(d, ["c_ba"]);
    const daily = await openSession(content, { source: "daily" });
    const other = await openSession(content, { source: "lesson", lessonId: "vi-south.u01.l01" });
    expect(other.sessionId).not.toBe(daily.sessionId);
    restart();
    expect((await currentSession(content))?.source).toBe("lesson");
  });

  it("révision seule : uniquement les cartes dues, plafonnées par la durée", async () => {
    const content = buildContentIndex(raw);
    const d = new ParloDB(dbName);
    setDb(d);
    await seedDue(d, ["c_ba", "c_anh"]);
    const run = await openSession(content, { source: "review" });
    expect(run.lesson).toBeNull();
    const recap = await finishSession(content, await play(content, run, Infinity, false));
    expect(recap.source).toBe("review");
    expect(recap.reviewed.sort()).toEqual(["c_anh", "c_ba"]);
    expect(recap.reviewedWell).toEqual([]);
    // Une erreur relance l'item une fois : 2 cartes → 4 réponses.
    const answers = (await d.outbox.toArray()).filter((r) => r.event.type === "answer_submitted");
    expect(answers).toHaveLength(4);
  });
});

describe("placement", () => {
  beforeEach(() => {
    dbName = `parlo-placement-${Math.random()}`;
    restart();
  });
  afterEach(() => setDb(null));

  it("enregistre le niveau, les cartes de départ, l'événement, et déplace le point d'entrée", async () => {
    const content = buildContentIndex(raw);
    const spec = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "content", "vi-south", "placement.json"), "utf8")) as PlacementSpec;
    const { nextPlacementItem } = await import("@parlo/core");
    const answers: { itemId: string; correct: boolean }[] = [];
    for (let item = nextPlacementItem(spec, answers); item; item = nextPlacementItem(spec, answers)) answers.push({ itemId: item.id, correct: true });

    const { result, entry } = await savePlacement(content, spec, answers);
    expect(result.levelEstimate).toBe(3);
    expect(entry).not.toBeNull();
    expect((await getPlacement())?.entryLessonId).toBe(entry!.id);

    const d = new ParloDB(dbName);
    setDb(d);
    expect(await d.srsCards.count()).toBe(result.knownConceptIds.length);
    const events = (await d.outbox.toArray()).map((r) => r.event);
    expect(events.at(-1)).toMatchObject({ type: "placement_completed", payload: { levelEstimate: 3, entryLessonId: entry!.id, total: 8 } });

    const plans = await planning(content, DEFAULT_PROFILE);
    expect(plans.next?.id).toBe(entry!.id);
    expect(plans.unlocked.has("vi-south.u01.l01")).toBe(entry!.id !== "vi-south.u01.l01");
  });
});
