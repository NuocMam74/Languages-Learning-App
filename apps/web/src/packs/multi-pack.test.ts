import { buildContentIndex, emptyStreak, newCard, review, type ContentIndex, type ParloEvent } from "@parlo/core";
import { Dexie } from "dexie";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import { ACTIVE_PACK_KEY, ParloDB, setDb } from "../db.ts";
import {
  completedLessons,
  currentSession,
  DEFAULT_PROFILE,
  finishSession,
  getBadges,
  getProfile,
  getTotals,
  openSession,
  packCards,
  saveProfile,
} from "../learner.ts";
import { activePackCode, DEFAULT_PACK, setActivePackCode } from "./active.ts";
import { isOnboarded, loadActivePack, switchPack } from "./switch.ts";

/**
 * Plusieurs packs sur un même appareil (ADR 0006) : migration sans perte des données
 * Phase 0–2, progression séparée par pack, changement de langue journalisé.
 */

const vi: ContentIndex = buildContentIndex(toRaw(readPackFiles("vi-south")));
const es: ContentIndex = buildContentIndex(toRaw(readPackFiles("es")));
const PAST = new Date("2026-09-01T10:00:00Z");

beforeAll(() => {
  // Le build embarque tous les packs de content/ ; test-setup n'en déclare qu'un.
  (globalThis as { __PACKS__?: Record<string, number> }).__PACKS__ = { "vi-south": 1, es: 1 };
});

let dbName = "";
beforeEach(() => {
  dbName = `parlo-multipack-${Math.random()}`;
  setActivePackCode(DEFAULT_PACK);
});
afterEach(() => {
  setDb(null);
  setActivePackCode(DEFAULT_PACK);
});

/** Base telle que l'écrivait l'app avant la Phase 3 (schéma v1 ou v2), avec une progression réelle. */
async function seedLegacyDb(schemaVersion: 1 | 2) {
  const old = new Dexie(dbName);
  old.version(1).stores({ packs: "code", srsCards: "conceptId, due, state", lessonProgress: "lessonId", outbox: "id, occurredAt", snapshot: "key", kv: "key" });
  if (schemaVersion === 2) old.version(2).stores({ syncLog: "++seq, at" });
  await old.open();
  const lessonRun = (await (async () => {
    // Snapshot Phase 0 : une leçon interrompue.
    setDb(new ParloDB(`scratch-${Math.random()}`));
    const run = await openSession(vi, { source: "lesson", lessonId: "vi-south.u01.l02" }, PAST);
    setDb(null);
    return run.lesson;
  })())!;
  await old.table("srsCards").bulkPut(["c_ba", "c_anh", "c_chao"].map((id) => review(newCard(id, PAST), "good", PAST)));
  await old.table("lessonProgress").put({ lessonId: "vi-south.u01.l01", status: "completed", bestScore: 0.9, attempts: 1, completedAt: PAST.toISOString() });
  await old.table("snapshot").put({ key: "current", packCode: "vi-south", run: lessonRun, savedAt: PAST.toISOString() });
  const outboxEvent = { id: "0190d9a0-0000-7000-8000-000000000001", type: "badge_earned", occurredAt: PAST.toISOString(), schemaVersion: 1, payload: { badgeCode: "first_lesson" } };
  await old.table("outbox").put({ id: outboxEvent.id, occurredAt: outboxEvent.occurredAt, event: outboxEvent });
  await old.table("kv").bulkPut([
    { key: "profile", value: { ...DEFAULT_PROFILE, dailyGoalMin: 10, onboardedAt: PAST.toISOString() } },
    { key: "totals", value: { xp: 240, streak: { ...emptyStreak(), current: 3, longest: 5, lastActiveDate: "2026-09-01" } } },
    { key: "badges", value: [{ code: "first_lesson", earnedAt: PAST.toISOString() }] },
    { key: "toneLog", value: [true, false, true] },
    { key: "games.cho_noi.best", value: { points: 90, correct: 7, total: 10 } },
    { key: "account", value: { email: "a@b.c", displayName: "An", locale: "fr", linkedAt: PAST.toISOString() } },
    { key: "activity", value: { date: "2026-09-01", seconds: 300 } },
  ]);
  old.close();
  return lessonRun;
}

describe("migration vers le schéma multi-pack (v3)", () => {
  for (const version of [1, 2] as const) {
    it(`depuis une base v${version} : aucune progression perdue, tout rattaché au pack d'origine`, async () => {
      const lessonRun = await seedLegacyDb(version);
      const d = new ParloDB(dbName);
      setDb(d);

      expect(await loadActivePack()).toBe("vi-south");
      expect(d.verno).toBe(3);

      expect(await completedLessons("vi-south")).toEqual(new Set(["vi-south.u01.l01"]));
      expect((await packCards("vi-south")).map((c) => c.conceptId).sort()).toEqual(["c_anh", "c_ba", "c_chao"]);
      expect((await d.srsCards.toArray()).every((c) => c.packCode === "vi-south")).toBe(true);
      expect(await completedLessons("es")).toEqual(new Set());

      expect((await getProfile()).onboardedAt).toBe(PAST.toISOString());
      expect(await getTotals()).toMatchObject({ xp: 240, streak: { current: 3, longest: 5 } });
      expect((await getBadges()).map((b) => b.code)).toEqual(["first_lesson"]);

      const keys = (await d.kv.toArray()).map((r) => r.key).sort();
      expect(keys).toEqual(["account", "activePack", "activity", "vi-south:badges", "vi-south:games.cho_noi.best", "vi-south:profile", "vi-south:toneLog", "vi-south:totals"]);

      // La leçon interrompue reprend exactement.
      const resumed = await currentSession(vi);
      expect(resumed?.lesson).toEqual(lessonRun);
      expect(await d.snapshot.get("current")).toBeUndefined();
      expect(await d.outbox.count()).toBe(1);
      if (version === 2) expect(await d.syncLog.count()).toBe(0);
    });
  }

  it("base neuve : pas de migration, pack par défaut, rien d'enregistré", async () => {
    const d = new ParloDB(dbName);
    setDb(d);
    expect(await loadActivePack()).toBe(DEFAULT_PACK);
    expect(await d.kv.get(ACTIVE_PACK_KEY)).toBeUndefined();
  });
});

describe("deux langues sur le même appareil", () => {
  it("progression, totaux, badges, profil et séance en cours séparés ; pack_switched journalisé", async () => {
    setDb(new ParloDB(dbName));
    await loadActivePack();

    // Vietnamien du Sud : onboarding puis une leçon.
    await switchPack("vi-south", PAST);
    await saveProfile({ ...DEFAULT_PROFILE, dailyGoalMin: 10, onboardedAt: PAST.toISOString() });
    const viRecap = await finishSession(vi, await openSession(vi, { source: "lesson", lessonId: "vi-south.u01.l01" }));
    const viInterrupted = await openSession(vi, { source: "lesson", lessonId: "vi-south.u01.l02" });

    // Espagnol : pas encore d'onboarding pour ce pack.
    expect(await switchPack("es")).toBe(true);
    expect(activePackCode()).toBe("es");
    expect(await isOnboarded("es")).toBe(false);
    expect((await getProfile()).onboardedAt).toBeNull();
    expect(await getTotals()).toMatchObject({ xp: 0 });
    await saveProfile({ ...DEFAULT_PROFILE, dailyGoalMin: 5, onboardedAt: new Date().toISOString() });
    const esRecap = await finishSession(es, await openSession(es, { source: "lesson", lessonId: "es.u01.l01" }));
    expect(esRecap.firstLesson).toBe(true);
    expect(esRecap.badges).toEqual(["first_lesson"]);

    expect(await completedLessons("es")).toEqual(new Set(["es.u01.l01"]));
    expect(await completedLessons("vi-south")).toEqual(new Set(["vi-south.u01.l01"]));
    expect((await packCards("es")).every((c) => c.conceptId.startsWith("c_es_"))).toBe(true);
    expect((await getTotals()).xp).toBe(esRecap.xp);
    expect(await currentSession(es)).toBeNull();

    // Retour au vietnamien, après redémarrage : tout est intact, la leçon interrompue aussi.
    await switchPack("vi-south");
    setDb(new ParloDB(dbName));
    expect(await loadActivePack()).toBe("vi-south");
    expect((await getTotals()).xp).toBe(viRecap.xp);
    expect((await getProfile()).dailyGoalMin).toBe(10);
    expect((await currentSession(vi))?.sessionId).toBe(viInterrupted.sessionId);
    expect((await getBadges()).map((b) => b.code)).toEqual(["first_lesson"]);

    const d = new ParloDB(dbName);
    setDb(d);
    const switches = (await d.outbox.toArray()).map((r) => r.event).filter((e): e is Extract<ParloEvent, { type: "pack_switched" }> => e.type === "pack_switched");
    expect(switches.map((e) => e.payload)).toEqual([
      { fromPack: null, toPack: "vi-south" },
      { fromPack: "vi-south", toPack: "es" },
      { fromPack: "es", toPack: "vi-south" },
    ]);
    // Les événements SRS gardent la forme du contrat (pas d'étiquette de stockage).
    const srs = (await d.outbox.toArray()).map((r) => r.event).filter((e) => e.type === "srs_card_updated");
    expect(srs.length).toBeGreaterThan(0);
    expect(srs.every((e) => e.type === "srs_card_updated" && !("packCode" in e.payload.card))).toBe(true);
    // Rester sur le même pack n'écrit rien.
    expect(await switchPack("vi-south")).toBe(false);
  });

  it("une carte réécrite sans étiquette (moteur SRS) garde son pack", async () => {
    const d = new ParloDB(dbName);
    setDb(d);
    setActivePackCode("es");
    await d.srsCards.put(newCard("c_es_hola", PAST));
    setActivePackCode("vi-south");
    await d.srsCards.put(review(newCard("c_es_hola", PAST), "good", PAST));
    expect((await d.srsCards.get("c_es_hola"))?.packCode).toBe("es");
    expect(await packCards("vi-south")).toEqual([]);
  });
});
