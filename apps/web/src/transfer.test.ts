import { newCard } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, ParloDB, setDb } from "./db.ts";
import { readPrefs, writePrefs } from "./prefs.ts";
import { applyTransfer, buildTransfer, parseTransfer, summarize, TRANSFER_VERSION } from "./transfer.ts";

/**
 * Changer d'appareil (contrat phase17 §1). Ce qui est vérifié ici, c'est la promesse elle-même :
 * **ce qui sort d'un appareil rentre entier dans un autre**, et un fichier qu'on ne comprend pas
 * n'écrit jamais rien.
 */

const NOW = new Date("2026-03-01T10:00:00Z");
let dbName = "";

const card = (conceptId: string, over: Record<string, unknown> = {}) => ({
  ...newCard(conceptId, NOW),
  packCode: "vi-south",
  ...over,
});

const progress = (lessonId: string, over: Record<string, unknown> = {}) => ({
  lessonId,
  packCode: "vi-south",
  status: "completed" as const,
  bestScore: 1,
  mastered: true,
  attempts: 1,
  completedAt: NOW.toISOString(),
  ...over,
});

/** Un appareil qui a vécu : deux langues, des cartes, des leçons, une note, des réglages. */
async function seedDevice(): Promise<void> {
  const d = db();
  await d.srsCards.bulkPut([card("c_chao"), card("c_anh"), card("es_hola", { packCode: "es" })]);
  await d.lessonProgress.bulkPut([progress("vi-south.u01.l01"), progress("vi-south.u01.l02"), progress("es.u01.l01", { packCode: "es" })]);
  await d.kv.bulkPut([
    { key: "vi-south:totals", value: { xp: 2400, streak: { current: 12 } } },
    { key: "vi-south:profile", value: { dailyGoalMin: 10, displayName: "Lan" } },
    { key: "vi-south:guidesRead", value: ["g_construire_phrase"] },
    { key: "es:totals", value: { xp: 120 } },
    // Restent sur l'appareil : identité connectée et langue affichée.
    { key: "account", value: { email: "lan@parlo.app" } },
    { key: "activePack", value: "vi-south" },
  ]);
  await d.notes.bulkPut([
    { id: "n1", packCode: "vi-south", targetKind: "concept", targetId: "c_chao", text: "à revoir", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
  ]);
  writePrefs({ locale: "fr", theme: "dark", feedbackSounds: false, silent: true, dictation: false });
}

beforeEach(async () => {
  dbName = `parlo-transfer-${Math.random().toString(36).slice(2)}`;
  setDb(new ParloDB(dbName));
  await db().open();
  localStorage.clear();
});

afterEach(async () => {
  await db().delete();
  setDb(null);
});

describe("emporter son appareil", () => {
  it("le fichier contient la progression, les notes et les réglages", async () => {
    await seedDevice();
    const file = await buildTransfer(NOW);

    expect(file).toMatchObject({ app: "parlo", kind: "transfer", version: TRANSFER_VERSION, exportedAt: NOW.toISOString() });
    expect(file.tables.srsCards).toHaveLength(3);
    expect(file.tables.lessonProgress).toHaveLength(3);
    expect(file.tables.notes).toHaveLength(1);
    expect(file.prefs).toMatchObject({ theme: "dark", silent: true, feedbackSounds: false });
  });

  it("l'identité connectée et la langue affichée restent sur l'appareil", async () => {
    await seedDevice();
    const keys = (await buildTransfer(NOW)).tables.kv.map((r) => r.key);
    // Un fichier ne transporte pas une session : on se reconnecte de l'autre côté.
    expect(keys).not.toContain("account");
    expect(keys).not.toContain("activePack");
    expect(keys).toContain("vi-south:profile");
    expect(keys).toContain("vi-south:guidesRead");
  });

  it("le résumé se calcule, langue par langue", async () => {
    await seedDevice();
    const summary = summarize((await buildTransfer(NOW)).tables);
    expect(summary.packs).toEqual([
      { code: "es", xp: 120, lessons: 1, cards: 1 },
      { code: "vi-south", xp: 2400, lessons: 2, cards: 2 },
    ]);
    expect(summary).toMatchObject({ xp: 2520, lessons: 3, notes: 1 });
  });
});

describe("relire un fichier", () => {
  it("dit **pourquoi** il refuse, plutôt que « fichier invalide »", () => {
    expect(parseTransfer("pas du json")).toEqual({ error: "unreadable" });
    expect(parseTransfer(JSON.stringify({ app: "autre-chose" }))).toEqual({ error: "not_parlo" });
    // Un export RGPD n'est pas un transfert : il ne porte pas `kind`.
    expect(parseTransfer(JSON.stringify({ app: "parlo", exportedAt: "x", tables: {} }))).toEqual({ error: "not_parlo" });
    expect(parseTransfer(JSON.stringify({ app: "parlo", kind: "transfer", version: 99, tables: {} }))).toEqual({ error: "too_new" });
  });

  it("un fichier bien formé mais vide ne passe pas pour un transfert", () => {
    const empty = { app: "parlo", kind: "transfer", version: 1, exportedAt: "x", tables: { srsCards: [], lessonProgress: [], kv: [], notes: [] } };
    expect(parseTransfer(JSON.stringify(empty))).toEqual({ error: "empty" });
  });

  it("les lignes abîmées sont écartées, le reste passe", async () => {
    await seedDevice();
    const file = await buildTransfer(NOW);
    const damaged = { ...file, tables: { ...file.tables, srsCards: [...file.tables.srsCards, { rien: true }, null] } };
    const read = parseTransfer(JSON.stringify(damaged));
    expect("file" in read).toBe(true);
    if (!("file" in read)) return;
    expect(read.file.tables.srsCards).toHaveLength(3);
  });
});

describe("reposer sur un autre appareil", () => {
  it("un appareil neuf retrouve exactement l'état du fichier", async () => {
    await seedDevice();
    const text = JSON.stringify(await buildTransfer(NOW));

    // Appareil neuf : autre base, autres réglages.
    await db().delete();
    setDb(new ParloDB(`${dbName}-neuf`));
    await db().open();
    localStorage.clear();

    const read = parseTransfer(text);
    expect("file" in read).toBe(true);
    if (!("file" in read)) return;
    const summary = await applyTransfer(read.file);

    expect(summary).toMatchObject({ xp: 2520, lessons: 3, notes: 1 });
    expect(await db().srsCards.count()).toBe(3);
    expect(await db().lessonProgress.count()).toBe(3);
    expect((await db().kv.get("vi-south:profile"))?.value).toMatchObject({ displayName: "Lan" });
    expect((await db().kv.get("vi-south:guidesRead"))?.value).toEqual(["g_construire_phrase"]);
    expect((await db().notes.get("n1"))?.text).toBe("à revoir");
    expect(readPrefs()).toMatchObject({ theme: "dark", silent: true });
  });

  it("remplacer efface ce que l'appareil avait : c'est le geste d'un changement d'appareil", async () => {
    await seedDevice();
    const text = JSON.stringify(await buildTransfer(NOW));
    await db().delete();
    setDb(new ParloDB(`${dbName}-autre`));
    await db().open();
    // Cet appareil-ci a joué autre chose.
    await db().srsCards.put(card("c_ba"));
    await db().lessonProgress.put(progress("vi-south.u09.l01"));

    const read = parseTransfer(text);
    if (!("file" in read)) throw new Error("fichier refusé");
    await applyTransfer(read.file, "replace");

    expect(await db().srsCards.get("c_ba")).toBeUndefined();
    expect(await db().lessonProgress.get("vi-south.u09.l01")).toBeUndefined();
    expect(await db().srsCards.get("c_chao")).toBeDefined();
  });

  it("fusionner ne perd rien : on garde le plus avancé des deux côtés", async () => {
    await seedDevice();
    const text = JSON.stringify(await buildTransfer(NOW));
    await db().delete();
    setDb(new ParloDB(`${dbName}-joue`));
    await db().open();
    await db().srsCards.put(card("c_ba"));
    // Même leçon, jouée ici sans être maîtrisée : la maîtrise du fichier doit gagner.
    await db().lessonProgress.put(progress("vi-south.u01.l01", { mastered: false, bestScore: 0.4, attempts: 3 }));
    await db().kv.put({ key: "vi-south:totals", value: { xp: 5000 } });

    const read = parseTransfer(text);
    if (!("file" in read)) throw new Error("fichier refusé");
    await applyTransfer(read.file, "merge");

    // Rien de local n'a disparu.
    expect(await db().srsCards.get("c_ba")).toBeDefined();
    const merged = await db().lessonProgress.get("vi-south.u01.l01");
    expect(merged).toMatchObject({ mastered: true, bestScore: 1, attempts: 3 });
    // Les totaux ne descendent jamais.
    expect((await db().kv.get("vi-south:totals"))?.value).toMatchObject({ xp: 5000 });
  });

  it("l'aller-retour est fidèle : exporter, importer, réexporter donne le même fichier", async () => {
    await seedDevice();
    const first = await buildTransfer(NOW);
    await db().delete();
    setDb(new ParloDB(`${dbName}-retour`));
    await db().open();

    const read = parseTransfer(JSON.stringify(first));
    if (!("file" in read)) throw new Error("fichier refusé");
    await applyTransfer(read.file);
    const second = await buildTransfer(NOW);

    const sorted = (t: typeof first.tables) => ({
      srsCards: [...t.srsCards].sort((a, b) => a.conceptId.localeCompare(b.conceptId)),
      lessonProgress: [...t.lessonProgress].sort((a, b) => a.lessonId.localeCompare(b.lessonId)),
      kv: [...t.kv].sort((a, b) => a.key.localeCompare(b.key)),
      notes: [...t.notes].sort((a, b) => a.id.localeCompare(b.id)),
    });
    expect(sorted(second.tables)).toEqual(sorted(first.tables));
  });
});
