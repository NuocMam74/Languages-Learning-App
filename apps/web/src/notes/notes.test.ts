import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, ParloDB, setDb, type NoteRow } from "../db.ts";
import { exportLocalData } from "../learner.ts";
import { exportFilename, notesJson, notesMarkdown, type NoteExportItem } from "./export.ts";
import { groupByTarget, MAX_NOTE_LENGTH, readNotes, removeNote, targetKey, writeNote } from "./store.ts";

/**
 * Notes personnelles (contrat phase8 §3) : migration Dexie sans perte, écriture locale, export.
 */

let dbName = "";

beforeEach(() => {
  dbName = `parlo-notes-${Math.random()}`;
  setDb(new ParloDB(dbName));
});
afterEach(async () => {
  await db().close();
  setDb(null);
});

const NOW = new Date("2026-09-14T08:00:00Z");
const LATER = new Date("2026-09-15T09:30:00Z");

describe("migration de la base", () => {
  it("ajoute `notes` à une base existante sans rien perdre", async () => {
    // Base telle qu'elle existait avant le contrat phase8 (version 4), avec des données réelles.
    setDb(null);
    const legacy = new Dexie(dbName);
    legacy.version(1).stores({ packs: "code", srsCards: "conceptId, due, state", lessonProgress: "lessonId", outbox: "id, occurredAt", snapshot: "key", kv: "key" });
    legacy.version(2).stores({ syncLog: "++seq, at" });
    legacy.version(3).stores({ srsCards: "conceptId, due, state, packCode", lessonProgress: "lessonId, packCode" });
    legacy.version(4).stores({ units: "key, [code+version], code", offlineUnits: "key, code, lastUsedAt" });
    await legacy.open();
    await legacy.table("srsCards").put({ conceptId: "c_ba", packCode: "vi-south", due: NOW.toISOString(), stability: 3, difficulty: 5, scheduledDays: 1, learningSteps: 0, reps: 2, lapses: 0, state: "review", lastReview: NOW.toISOString() });
    await legacy.table("lessonProgress").put({ lessonId: "vi-south.u01.l01", packCode: "vi-south", status: "completed", bestScore: 0.9, attempts: 1, completedAt: NOW.toISOString() });
    await legacy.table("kv").put({ key: "vi-south:totals", value: { xp: 120 } });
    await legacy.table("outbox").put({ id: "e1", occurredAt: NOW.toISOString(), event: { id: "e1", type: "badge_earned", occurredAt: NOW.toISOString(), schemaVersion: 1, payload: { badgeCode: "first_lesson" } } });
    expect(legacy.verno).toBe(4);
    legacy.close();

    // Ouverture par l'app d'aujourd'hui : la version monte, tout est encore là, `notes` existe.
    const upgraded = new ParloDB(dbName);
    setDb(upgraded);
    await upgraded.open();
    // Pas d'égalité stricte sur le numéro : chaque table ajoutée le fait monter, et ce test parle
    // de migration, pas de comptage de versions. Ce qui compte, c'est qu'elle ait monté.
    expect(upgraded.verno).toBeGreaterThanOrEqual(5);
    expect((await upgraded.srsCards.get("c_ba"))?.reps).toBe(2);
    expect((await upgraded.lessonProgress.get("vi-south.u01.l01"))?.bestScore).toBe(0.9);
    expect((await upgraded.kv.get("vi-south:totals"))?.value).toEqual({ xp: 120 });
    expect(await upgraded.outbox.count()).toBe(1);
    expect(await upgraded.notes.count()).toBe(0);
    // Les tables ajoutées depuis le sont aussi, et vides : une base ancienne ne perd rien et
    // n'invente rien (favoris, contrat phase18 §1).
    expect(await upgraded.favorites.count()).toBe(0);

    // Et la table neuve est utilisable tout de suite.
    const note = await writeNote({ target: { kind: "concept", id: "c_ba" }, text: "café glacé" }, "vi-south", NOW);
    expect(await upgraded.notes.get(note!.id)).toEqual(note);
  });
});

describe("écriture des notes", () => {
  it("crée, relit et modifie une note sans changer sa date de création", async () => {
    const created = (await writeNote({ target: { kind: "concept", id: "c_ba" }, text: "  trois tons  " }, "vi-south", NOW))!;
    expect(created.text).toBe("trois tons"); // espaces de bord retirés
    expect(created.packCode).toBe("vi-south");
    expect(created.createdAt).toBe(NOW.toISOString());
    expect(created.updatedAt).toBe(NOW.toISOString());

    const edited = (await writeNote({ id: created.id, target: { kind: "concept", id: "c_ba" }, text: "à dire vite" }, "vi-south", LATER))!;
    expect(edited.id).toBe(created.id);
    expect(edited.createdAt).toBe(NOW.toISOString());
    expect(edited.updatedAt).toBe(LATER.toISOString());
    expect(await readNotes("vi-south")).toEqual([edited]);
  });

  it("vider une note existante la supprime ; une note vide ne se crée pas", async () => {
    const created = (await writeNote({ target: { kind: "free", id: null }, text: "essai" }, "vi-south", NOW))!;
    expect(await writeNote({ id: created.id, target: { kind: "free", id: null }, text: "   " }, "vi-south", LATER)).toBeNull();
    expect(await readNotes("vi-south")).toEqual([]);
    expect(await writeNote({ target: { kind: "free", id: null }, text: "" }, "vi-south", NOW)).toBeNull();
    expect(await db().notes.count()).toBe(0);
  });

  it("borne la longueur d'une note", async () => {
    const note = (await writeNote({ target: { kind: "free", id: null }, text: "a".repeat(MAX_NOTE_LENGTH + 500) }, "vi-south", NOW))!;
    expect(note.text).toHaveLength(MAX_NOTE_LENGTH);
  });

  it("chaque langue a ses notes, et le tri va du plus récent au plus ancien", async () => {
    await writeNote({ target: { kind: "concept", id: "c_ba" }, text: "vietnamien" }, "vi-south", NOW);
    const recent = (await writeNote({ target: { kind: "lesson", id: "vi-south.u01.l01" }, text: "leçon 1" }, "vi-south", LATER))!;
    await writeNote({ target: { kind: "free", id: null }, text: "espagnol" }, "es", NOW);

    const vi = await readNotes("vi-south");
    expect(vi).toHaveLength(2);
    expect(vi[0]!.id).toBe(recent.id);
    expect((await readNotes("es")).map((n) => n.text)).toEqual(["espagnol"]);
  });

  it("supprime une note et groupe les autres par cible", async () => {
    const a = (await writeNote({ target: { kind: "concept", id: "c_ba" }, text: "un" }, "vi-south", NOW))!;
    await writeNote({ target: { kind: "concept", id: "c_ba" }, text: "deux" }, "vi-south", LATER);
    await writeNote({ target: { kind: "free", id: null }, text: "libre" }, "vi-south", NOW);

    await removeNote(a.id);
    const rest = await readNotes("vi-south");
    expect(rest).toHaveLength(2);
    const groups = groupByTarget(rest);
    expect(groups.get(targetKey({ kind: "concept", id: "c_ba" }))).toHaveLength(1);
    expect(groups.get(targetKey({ kind: "free", id: null }))).toHaveLength(1);
  });

  it("voyage dans l'export local RGPD, et n'écrit jamais d'événement à synchroniser", async () => {
    await writeNote({ target: { kind: "concept", id: "c_ba" }, text: "secret" }, "vi-south", NOW);
    const dump = await exportLocalData(NOW);
    expect(dump.tables.notes).toHaveLength(1);
    expect(dump.tables.notes[0]!.text).toBe("secret");
    // Minimisation (spec §14) : rien ne part au serveur.
    expect(await db().outbox.count()).toBe(0);
  });
});

describe("export des notes", () => {
  const note = (patch: Partial<NoteRow>): NoteRow => ({
    id: "n1", packCode: "vi-south", targetKind: "concept", targetId: "c_ca_phe",
    text: "toujours avec du lait concentré", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...patch,
  });

  const items: NoteExportItem[] = [
    { note: note({}), title: "cà phê — café", detail: "Unité 1 — Premiers mots" },
    { note: note({ id: "n2", targetKind: "free", targetId: null, text: "demander « ít đường »" }), title: "Note libre" },
  ];
  const head = {
    title: "Mes notes — Vietnamien du Sud",
    exportedAt: "Exporté le 14 septembre 2026",
    updatedLabels: ["Modifiée le 14 septembre 2026", "Modifiée le 14 septembre 2026"],
  };

  it("le Markdown cite la source de chaque note", () => {
    const md = notesMarkdown(items, head);
    expect(md).toContain("# Mes notes — Vietnamien du Sud");
    expect(md).toContain("Exporté le 14 septembre 2026");
    expect(md).toContain("## cà phê — café");
    expect(md).toContain("*Unité 1 — Premiers mots*");
    expect(md).toContain("toujours avec du lait concentré");
    expect(md).toContain("## Note libre");
    expect(md).toContain("demander « ít đường »");
    expect(md.endsWith("\n")).toBe(true);
    // L'ordre des notes est celui de la liste, chaque note sous son titre.
    expect(md.indexOf("## cà phê")).toBeLessThan(md.indexOf("## Note libre"));
  });

  it("un export vide reste un document lisible", () => {
    expect(notesMarkdown([], { ...head, updatedLabels: [] })).toBe("# Mes notes — Vietnamien du Sud\n\nExporté le 14 septembre 2026\n");
  });

  it("le JSON garde la cible et les dates, et cite la source", () => {
    const json = notesJson(items, { packCode: "vi-south", exportedAt: NOW.toISOString() });
    expect(json.app).toBe("parlo");
    expect(json.packCode).toBe("vi-south");
    expect(json.notes).toHaveLength(2);
    expect(json.notes[0]).toEqual({
      id: "n1", targetKind: "concept", targetId: "c_ca_phe",
      source: { title: "cà phê — café", detail: "Unité 1 — Premiers mots" },
      text: "toujours avec du lait concentré", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    });
    expect(json.notes[1]!.source).toEqual({ title: "Note libre" });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("nomme les fichiers par la date d'export", () => {
    expect(exportFilename(NOW.toISOString(), "md")).toBe("parlo-notes-2026-09-14.md");
    expect(exportFilename(NOW.toISOString(), "json")).toBe("parlo-notes-2026-09-14.json");
  });
});
