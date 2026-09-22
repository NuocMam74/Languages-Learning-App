import { buildContentIndex, evaluate, makeEvent, newCard, review, sessionPhase, type ContentIndex, type Exercise, type ExerciseResponse, type ParloEvent, type SessionRun } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../scripts/lib/load-pack.ts";
import { configureApi, setAccessToken } from "./api.ts";
import { getKv, ParloDB, setDb, setKv } from "./db.ts";
import {
  clearLearningData,
  completedLessons,
  finishSession,
  getBadges,
  getProfile,
  isLessonOpen,
  openSession,
  planning,
  saveLessonPart,
  sessionAvailability,
  setFreeze,
  submitSessionAnswer,
  DEFAULT_PROFILE,
  saveProfile,
} from "./learner.ts";
import { applyRestoredState } from "./restore.ts";
import { easierExercise, exerciseFor } from "./session-store.ts";
import { checkContentUpdate, loadPack } from "./content.ts";
import { ACCOUNT_KEY, QUARANTINE_REASON, SyncEngine } from "./sync.ts";

/** Contrat phase5-parcours côté client : séances vides, tests d'unité, gel, restauration, lots empoisonnés, déconnexion. */

const content: ContentIndex = buildContentIndex(toRaw(readPackFiles("vi-south")));
let d: ParloDB;

beforeEach(() => {
  d = new ParloDB(`parlo-phase5-${Math.random()}`);
  setDb(d);
});
afterEach(() => setDb(null));

function answer(ex: Exercise, right: boolean): ExerciseResponse {
  if (ex.type === "speak_repeat" || ex.type === "tone_produce") return { kind: "speech", score: right ? 90 : 10 };
  if (ex.type === "game" || ex.type === "unsupported") return { kind: "skip" };
  if (ex.type === "build_sentence") return { kind: "tokens", optionIds: right ? [] : [ex.tokens[0]!.id] };
  if (!("answerId" in ex)) return { kind: "skip" }; // types sans QCM (texte, paires, dialogue) : non joués ici
  return { kind: "choice", optionId: right ? ex.answerId : (ex.options.find((o) => o.id !== ex.answerId)?.id ?? "") };
}

async function play(start: SessionRun, right: boolean): Promise<SessionRun> {
  let run = start;
  for (let i = 0; i < 200; i++) {
    const phase = sessionPhase(run, content);
    if (phase.kind === "recap") break;
    if (phase.kind === "save_lesson") {
      run = await saveLessonPart(content, run);
      continue;
    }
    const ex = exerciseFor(content, run, phase)!;
    run = await submitSessionAnswer(content, run, ex, evaluate(ex, answer(ex, right)), 1500);
  }
  return run;
}

describe("séances vides (contrat phase5 §3)", () => {
  it("révision sans carte due : rien à ouvrir ; une séance sans item noté ne donne ni XP ni série", async () => {
    await saveProfile({ ...DEFAULT_PROFILE, onboardedAt: new Date().toISOString() });
    expect(await sessionAvailability(content, { source: "review" })).toBe("empty");
    expect(await sessionAvailability(content, { source: "daily" })).toBe("work");

    const run = await openSession(content, { source: "review" });
    const recap = await finishSession(content, run);
    expect(recap).toMatchObject({ empty: true, xp: 0 });
    expect(recap.streak.current).toBe(0);
    const types = (await d.outbox.toArray()).map((r) => r.event.type);
    expect(types).not.toContain("session_completed");
  });
});

describe("test d'unité (contrat phase5 §2)", () => {
  const unit1 = content.curriculum.units[0]!;
  const test = content.lessons.get(unit1.lessons.find((id) => content.lessons.get(id)?.kind === "unit_test")!)!;

  async function completeUnitExceptTest() {
    const now = new Date().toISOString();
    // `mastered: true` : les leçons de l'unité ont été **réussies**, c'est ce qui ouvre la suite
    // depuis le contrat phase10 §3 (terminer en se trompant n'ouvre plus rien).
    await d.lessonProgress.bulkPut(unit1.lessons.filter((id) => id !== test.id).map((lessonId) => ({ lessonId, packCode: "vi-south", status: "completed" as const, bestScore: 1, mastered: true, attempts: 1, completedAt: now })));
  }

  it("sous 0,7 : « Presque ! », l'unité suivante reste fermée et le test est reproposé ; réussi : la suite s'ouvre", async () => {
    await saveProfile({ ...DEFAULT_PROFILE, onboardedAt: new Date().toISOString() });
    await completeUnitExceptTest();
    expect(await isLessonOpen(content, test.id)).toBe(true);

    const failed = await finishSession(content, await play(await openSession(content, { source: "lesson", lessonId: test.id }), false));
    expect(failed.unitTest).toMatchObject({ lessonId: test.id, passed: false });
    expect(await completedLessons()).toContain(test.id);
    const afterFail = await planning(content, await getProfile());
    expect(afterFail.next?.id).toBe(test.id);
    expect(await isLessonOpen(content, "vi-south.u02.l01")).toBe(false);

    const passed = await finishSession(content, await play(await openSession(content, { source: "lesson", lessonId: test.id }), true));
    expect(passed.unitTest).toMatchObject({ passed: true });
    expect((await planning(content, await getProfile())).next?.id).toBe("vi-south.u02.l01");
  });

  it("garde de lien profond : une leçon d'une unité fermée n'est pas ouverte", async () => {
    expect(await isLessonOpen(content, "vi-south.u01.l01")).toBe(true);
    expect(await isLessonOpen(content, "vi-south.u24.l08")).toBe(false);
  });
});

describe("gel de la série (contrat phase5 §3)", () => {
  it("déclaration datée (frozenFrom) ; annulation = frozenUntil null", async () => {
    const now = new Date("2026-09-14T09:00:00");
    const frozen = await setFreeze(3, now);
    expect(frozen).toMatchObject({ frozenUntil: "2026-09-17", frozenFrom: "2026-09-14" });
    const cancelled = await setFreeze(0, now);
    expect(cancelled).toMatchObject({ frozenUntil: null, frozenFrom: null });
    const payloads = (await d.outbox.toArray()).filter((r) => r.event.type === "streak_frozen").map((r) => r.event.payload);
    expect(payloads).toEqual([{ frozenUntil: "2026-09-17", localDate: "2026-09-14" }, { frozenUntil: null, localDate: "2026-09-14" }]);
  });
});

describe("restauration depuis le compte (contrat phase5 §4)", () => {
  it("fusion : progression max, cartes mergeCards, badges union, profil inscrit sans onboarding", async () => {
    const t0 = new Date("2026-09-01T08:00:00Z");
    const local = review(newCard("c_ba", t0), "good", t0);
    await d.srsCards.put({ ...local, packCode: "vi-south" });
    await d.lessonProgress.put({ lessonId: "vi-south.u01.l01", packCode: "vi-south", status: "completed", bestScore: 0.9, attempts: 1, completedAt: t0.toISOString() });
    await setKv("badges", [{ code: "first_lesson", earnedAt: t0.toISOString() }]);

    let remote = review(newCard("c_ba", t0), "good", t0);
    remote = review(remote, "good", new Date("2026-09-05T08:00:00Z"));
    const { enrolled } = await applyRestoredState("vi-south", {
      profile: { motivation: "travel", dailyGoalMin: 10, reminderHour: 8 },
      placement: { levelEstimate: 1, entryLessonId: "vi-south.u03.l01" },
      lessonProgress: [
        { lessonId: "vi-south.u01.l01", bestScore: 0.5, attempts: 3, completedAt: t0.toISOString() },
        { lessonId: "vi-south.u01.l02", bestScore: 1, attempts: 1, completedAt: t0.toISOString() },
      ],
      srsCards: [remote, review(newCard("c_anh", t0), "good", t0)],
      badges: [{ code: "streak_7", earnedAt: t0.toISOString() }, { code: "challenge_lessons", earnedAt: t0.toISOString() }],
      streak: { current: 5, longest: 9, lastActiveDate: "2026-09-13", freezesAvailable: 1, frozenUntil: null },
      xpTotal: 700,
    });

    expect(enrolled).toBe(true);
    expect(await completedLessons()).toEqual(new Set(["vi-south.u01.l01", "vi-south.u01.l02"]));
    expect(await d.lessonProgress.get("vi-south.u01.l01")).toMatchObject({ bestScore: 0.9, attempts: 3 });
    expect((await d.srsCards.get("c_ba"))?.reps).toBe(2);
    expect(await d.srsCards.get("c_anh")).toMatchObject({ packCode: "vi-south" });
    expect((await getBadges()).map((b) => b.code)).toEqual(["first_lesson", "streak_7", "challenge_lessons"]);
    expect(await getProfile()).toMatchObject({ motivation: "travel", dailyGoalMin: 10, reminder: "morning" });
    expect((await getProfile()).onboardedAt).not.toBeNull();
    expect(await getKv("placement", null)).toMatchObject({ entryLessonId: "vi-south.u03.l01" });
    expect(await getKv("totals", null)).toMatchObject({ xp: 700, streak: { current: 5 } });
    // Rien n'est renvoyé au serveur : ces données en viennent.
    expect(await d.outbox.count()).toBe(0);
  });

  it("la maîtrise ne se perd pas à la restauration : sans elle, le parcours se reverrouille", async () => {
    const t0 = new Date("2026-09-01T08:00:00Z");
    // Maîtrisée ici, sans score parfait : seul l'appareil le sait — une reconnexion ne doit pas l'effacer.
    await d.lessonProgress.put({ lessonId: "vi-south.u01.l01", packCode: "vi-south", status: "completed", bestScore: 0.6, mastered: true, attempts: 2, completedAt: t0.toISOString() });

    await applyRestoredState("vi-south", {
      profile: null,
      placement: null,
      lessonProgress: [
        { lessonId: "vi-south.u01.l01", bestScore: 0.6, attempts: 2, completedAt: t0.toISOString() },
        // Maîtrisée sur l'autre appareil, jamais jouée ici : le serveur la rend.
        { lessonId: "vi-south.u01.l02", bestScore: 0.7, attempts: 1, completedAt: t0.toISOString(), mastered: true },
        // Compte d'avant le contrat phase25 §1 : le serveur ne sait pas. Un sans-faute l'implique.
        { lessonId: "vi-south.u01.l03", bestScore: 1, attempts: 1, completedAt: t0.toISOString() },
        // Terminée en se trompant, et rien qui dise la maîtrise : elle reste à refaire.
        { lessonId: "vi-south.u01.l04", bestScore: 0.5, attempts: 1, completedAt: t0.toISOString() },
      ],
      srsCards: [],
      badges: [],
      streak: { current: 1, longest: 1, lastActiveDate: "2026-09-13", freezesAvailable: 1, frozenUntil: null },
      xpTotal: 0,
    });

    const mastery = async (id: string) => (await d.lessonProgress.get(id))?.mastered;
    expect(await mastery("vi-south.u01.l01")).toBe(true);
    expect(await mastery("vi-south.u01.l02")).toBe(true);
    expect(await mastery("vi-south.u01.l03")).toBe(true);
    expect(await mastery("vi-south.u01.l04")).toBe(false);
  });
});

describe("lot empoisonné (contrat phase5 §4)", () => {
  it("500 : le lot est scindé ; l'événement fautif est mis en quarantaine après 3 échecs, les autres passent", async () => {
    setAccessToken("tok");
    await setKv(ACCOUNT_KEY, { email: "a@b.c", displayName: "A", locale: "fr", linkedAt: "2026-09-01T00:00:00Z" });
    const events = Array.from({ length: 6 }, (_, i) => makeEvent("session_started", { sessionId: `s${i}`, source: "lesson", plannedSeconds: 60 }));
    await d.outbox.bulkPut(events.map((e) => ({ id: e.id, occurredAt: e.occurredAt, event: e })));
    const bad = events[3]!.id;
    const batches: number[] = [];
    configureApi({
      base: "/api",
      fetch: async (url, init) => {
        if (!url.endsWith("/me/events")) return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
        const sent = (JSON.parse(String(init?.body)) as { events: ParloEvent[] }).events;
        batches.push(sent.length);
        if (sent.some((e) => e.id === bad)) return new Response(JSON.stringify({ detail: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ accepted: sent.map((e) => e.id), rejected: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    const engine = new SyncEngine({ isOnline: () => true, baseDelayMs: 1 });
    expect((await engine.flush({ force: true })).status).toBe("error");
    expect((await d.outbox.toArray()).map((r) => r.id)).toEqual(events.slice(3).map((e) => e.id));
    expect((await engine.flush({ force: true })).status).toBe("error");
    const third = await engine.flush({ force: true });
    expect(third).toMatchObject({ status: "ok", rejected: 1 });
    expect(await d.outbox.count()).toBe(0);
    expect(await d.syncLog.toArray()).toEqual([expect.objectContaining({ eventId: bad, reason: QUARANTINE_REASON })]);
    expect(batches[0]).toBe(6);
    setAccessToken(null);
  });
});

describe("boucle de retour (spec §4.5)", () => {
  it("après 3 erreurs : exercice plus facile (image, ou 2 options)", async () => {
    const lesson = content.lessons.get("vi-south.u01.l01")!;
    const run = await openSession(content, { source: "lesson", lessonId: lesson.id });
    for (const id of lesson.concepts.slice(0, 5)) {
      const easier = easierExercise(content, run, id);
      if (!easier) continue;
      expect(["listen_pick_image", "listen_pick_text"]).toContain(easier.type);
      if (easier.type === "listen_pick_text") expect(easier.options.length).toBeLessThanOrEqual(2);
      expect("answerId" in easier && easier.options.some((o) => o.id === easier.answerId)).toBe(true);
    }
  });
});

describe("contenu mis à jour sans rebuild (contrat phase5 §6)", () => {
  const raw = toRaw(readPackFiles("vi-south"));
  const bundleV = (version: number) => ({ ...raw, pack: { ...raw.pack, version }, mediaIndex: [], exams: [], placement: null, games: {} });
  const fetcher = (version: number) =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/manifest")) return new Response(JSON.stringify({ code: "vi-south", version, baseUrl: `/content/vi-south/v${version}/` }), { headers: { "Content-Type": "application/json" } });
      if (u.endsWith(`/v${version}/bundle.json`)) return new Response(JSON.stringify(bundleV(version)), { headers: { "Content-Type": "application/json" } });
      return new Response("", { status: 404 });
    }) as typeof fetch;

  it("nouvelle version : téléchargée et appliquée ; séance commencée sur l'ancienne : mise en attente, reprise possible", async () => {
    await d.packs.put({ code: "vi-south", version: 1, files: bundleV(1), fetchedAt: "" });
    expect(await checkContentUpdate("vi-south", fetcher(1))).toBe("none");

    // Séance en cours sur la version 1 : la version 2 attend.
    const v1 = await loadPack("vi-south", fetcher(1));
    const run = await openSession(v1, { source: "lesson", lessonId: "vi-south.u01.l01" });
    expect(run.contentVersion).toBe(1);
    expect(await checkContentUpdate("vi-south", fetcher(2))).toBe("pending");
    expect((await loadPack("vi-south", fetcher(2))).pack.version).toBe(1);

    // Séance terminée : la version en attente est appliquée au prochain chargement.
    await d.snapshot.clear();
    expect((await loadPack("vi-south", fetcher(2))).pack.version).toBe(2);
    expect(await checkContentUpdate("vi-south", fetcher(3))).toBe("applied");
    expect((await d.packs.get("vi-south"))?.version).toBe(3);
  });
});

describe("déconnexion (contrat phase5 §4)", () => {
  it("efface progression, cartes, outbox et réglages du compte ; garde les packs et la langue active", async () => {
    await d.packs.put({ code: "vi-south", version: 1, files: toRaw(readPackFiles("vi-south")), fetchedAt: "" });
    await d.kv.put({ key: "activePack", value: "vi-south" });
    await setKv(ACCOUNT_KEY, { email: "a@b.c" });
    await saveProfile({ ...DEFAULT_PROFILE, onboardedAt: "2026-09-01" });
    await d.lessonProgress.put({ lessonId: "vi-south.u01.l01", packCode: "vi-south", status: "completed", bestScore: 1, attempts: 1, completedAt: "" });
    await d.srsCards.put({ ...newCard("c_ba", new Date()), packCode: "vi-south" });
    const e = makeEvent("session_started", { sessionId: "x", source: "lesson", plannedSeconds: 1 });
    await d.outbox.put({ id: e.id, occurredAt: e.occurredAt, event: e });

    await clearLearningData();
    expect(await d.lessonProgress.count()).toBe(0);
    expect(await d.srsCards.count()).toBe(0);
    expect(await d.outbox.count()).toBe(0);
    expect((await getProfile()).onboardedAt).toBeNull();
    expect(await getKv(ACCOUNT_KEY, null)).toBeNull();
    expect(await d.kv.get("activePack")).toMatchObject({ value: "vi-south" });
    expect(await d.packs.count()).toBe(1);
  });
});
