import { buildContentIndex, newCard, review, type ContentIndex, type RawPackFiles, type SrsCard } from "@parlo/core";
import { describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import {
  byPos,
  byTheme,
  conceptState,
  daysUntilDue,
  grammarEntries,
  HARD_LAPSES,
  matchesFilter,
  matchesSearch,
  searchKey,
  seenConcepts,
  seenDialogues,
  seenUnits,
  POS_ORDER,
} from "./library.ts";

/**
 * Sélection « tout ce qui a été vu » (contrat phase8 §2) sur le vrai contenu du pack :
 * la bibliothèque doit refléter la progression, pas un catalogue.
 */

const raw: RawPackFiles = toRaw(readPackFiles("vi-south"));
const content: ContentIndex = buildContentIndex(raw);
const NOW = new Date("2026-09-14T08:00:00Z");
const PAST = new Date("2026-08-01T08:00:00Z");

const firstUnit = content.curriculum.units[0]!;
const l01 = content.lessons.get(firstUnit.lessons[0]!)!;
const l02 = content.lessons.get(firstUnit.lessons[1]!)!;

const card = (conceptId: string, at: Date, patch: Partial<SrsCard> = {}): SrsCard => ({ ...review(newCard(conceptId, at), "good", at), ...patch });

describe("recherche sans accents ni tons", () => {
  it("ignore les tons, les diacritiques, la casse et la ponctuation", () => {
    expect(searchKey("cà phê")).toBe("ca phe");
    expect(searchKey("Đâu?")).toBe("dau");
    expect(searchKey("  Chị  ơi !  ")).toBe("chi oi");
  });

  it("trouve un mot tonal par sa forme nue, et l'inverse", () => {
    expect(matchesSearch("ca phe", ["cà phê"])).toBe(true);
    expect(matchesSearch("cà phê", ["ca phe"])).toBe(true);
    expect(matchesSearch("PHE", ["cà phê"])).toBe(true);
    expect(matchesSearch("the", ["cà phê"])).toBe(false);
  });

  it("cherche aussi dans le sens et l'équivalent du Nord, et une requête vide garde tout", () => {
    expect(matchesSearch("cafe", [undefined, "café (boisson)"])).toBe(true);
    expect(matchesSearch("", ["n'importe quoi"])).toBe(true);
    expect(matchesSearch("   ", ["n'importe quoi"])).toBe(true);
  });
});

describe("état d'un mot", () => {
  it("sans carte, ou carte neuve : nouveau", () => {
    expect(conceptState(null, NOW)).toBe("new");
    expect(conceptState(newCard("c", NOW), NOW)).toBe("new");
  });

  it("échéance passée : à revoir ; échéance à venir : planifié", () => {
    expect(conceptState(card("c", PAST), NOW)).toBe("due");
    expect(conceptState({ ...card("c", NOW), due: new Date("2026-09-20T08:00:00Z").toISOString() }, NOW)).toBe("scheduled");
  });

  it("deux rechutes ou plus : difficile, même si la carte est due", () => {
    const hard = { ...card("c", PAST), lapses: HARD_LAPSES };
    expect(conceptState(hard, NOW)).toBe("hard");
    // Le filtre « à revoir » ne doit pas cacher un mot difficile qui est aussi dû.
    expect(matchesFilter({ card: hard }, "due", NOW)).toBe(true);
    expect(matchesFilter({ card: hard }, "hard", NOW)).toBe(true);
    expect(matchesFilter({ card: hard }, "mastered", NOW)).toBe(false);
  });

  it("stable et sans rechute : maîtrisé", () => {
    const mastered = { ...card("c", NOW), state: "review" as const, stability: 30, lapses: 0, due: new Date("2026-10-14T08:00:00Z").toISOString() };
    expect(conceptState(mastered, NOW)).toBe("mastered");
    expect(matchesFilter({ card: mastered }, "mastered", NOW)).toBe(true);
    expect(matchesFilter({ card: null }, "new", NOW)).toBe(true);
    expect(matchesFilter({ card: null }, "all", NOW)).toBe(true);
  });

  it("compte les jours entiers jusqu'à l'échéance", () => {
    expect(daysUntilDue({ ...card("c", PAST) }, NOW)).toBe(0);
    expect(daysUntilDue({ ...card("c", NOW), due: new Date("2026-09-16T08:00:00Z").toISOString() }, NOW)).toBe(2);
  });
});

describe("concepts vus", () => {
  it("rien de terminé, aucune carte : bibliothèque vide (et pas le catalogue)", () => {
    expect(seenConcepts(content, { completed: new Set(), cards: [], now: NOW })).toEqual([]);
    expect(content.concepts.size).toBeGreaterThan(0);
  });

  it("une leçon terminée apporte ses concepts, avec leur unité et leur leçon", () => {
    const entries = seenConcepts(content, { completed: new Set([l01.id]), cards: [], now: NOW });
    expect(entries.map((e) => e.conceptId).sort()).toEqual([...new Set([...l01.review.srsIntroduce, ...l01.concepts])].sort());
    for (const entry of entries) {
      expect(entry.unit).toBe(l01.unit);
      expect(entry.lessonId).toBe(l01.id);
      expect(entry.state).toBe("new"); // aucune carte : jamais travaillé
    }
  });

  it("une carte SRS suffit, même sans leçon terminée (placement)", () => {
    const known = l02.review.srsIntroduce[0]!;
    const entries = seenConcepts(content, { completed: new Set(), cards: [card(known, PAST)], now: NOW });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.conceptId).toBe(known);
    expect(entries[0]!.lessonId).toBeNull();
    expect(entries[0]!.unit).toBe(l02.unit);
    expect(entries[0]!.state).toBe("due");
  });

  it("ne compte jamais deux fois un concept partagé par deux leçons", () => {
    const entries = seenConcepts(content, { completed: new Set([l01.id, l02.id]), cards: [card(l01.concepts[0]!, PAST)], now: NOW });
    expect(new Set(entries.map((e) => e.conceptId)).size).toBe(entries.length);
    expect(entries.find((e) => e.conceptId === l01.concepts[0])?.card).not.toBeNull();
  });

  it("ordonne par unité du cursus, et ne rend que des unités réellement vues", () => {
    const entries = seenConcepts(content, { completed: new Set([l01.id]), cards: [], now: NOW });
    const order = content.curriculum.units.map((u) => u.id);
    const ranks = entries.map((e) => order.indexOf(e.unit));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(seenUnits(content, entries)).toEqual([l01.unit]);
  });

  it("ignore une carte dont le concept n'existe plus dans le contenu", () => {
    const entries = seenConcepts(content, { completed: new Set(), cards: [card("concept-supprime", PAST)], now: NOW });
    expect(entries).toEqual([]);
  });
});

describe("grammaire, culture et dialogues", () => {
  it("ne livre les explications que des leçons terminées", () => {
    expect(grammarEntries(content, new Set())).toEqual([]);
    const entries = grammarEntries(content, new Set([l01.id]));
    for (const entry of entries) {
      expect(entry.unit).toBe(l01.unit);
      expect(entry.body.fr.trim()).not.toBe("");
      expect(["explain", "note", "culture"]).toContain(entry.kind);
    }
    // Chaque carte sait à quoi rattacher une note personnelle.
    for (const entry of entries) expect(entry.target.id).not.toBe("");
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it("ne cite que les dialogues joués par une leçon terminée", () => {
    expect(seenDialogues(content, new Set())).toEqual([]);
    const all = seenDialogues(content, new Set(content.lessons.keys()));
    for (const id of all) expect(content.dialogues.has(id)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("index par catégorie grammaticale et par thème (contrat phase14 §2)", () => {
  const seen = seenConcepts(content, { completed: new Set([l01.id, l02.id]), cards: [], now: NOW });

  it("chaque concept du pack porte une catégorie, sauf les tons et les sons", () => {
    const orphans = [...content.concepts.values()].filter((c) => !c.pos && c.type !== "tone" && c.type !== "sound");
    expect(orphans.map((c) => c.vi)).toEqual([]);
  });

  it("range les mots vus dans leur catégorie, et compte le reste du pack comme « à découvrir »", () => {
    const shelves = byPos(content, seen);
    expect(shelves.length).toBeGreaterThan(0);
    // L'ordre d'affichage est celui du contrat, pas celui de la découverte.
    expect(shelves.map((s) => s.key)).toEqual(POS_ORDER.filter((pos) => shelves.some((s) => s.key === pos)));

    for (const shelf of shelves) {
      for (const entry of shelf.entries) expect(content.concepts.get(entry.conceptId)!.pos).toBe(shelf.key);
    }
    // Aucun mot vu n'est perdu en route, et rien n'est compté deux fois.
    const placed = shelves.flatMap((s) => s.entries.map((e) => e.conceptId));
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length).toBe(seen.filter((e) => content.concepts.get(e.conceptId)?.pos).length);
  });

  it("« à découvrir » ne compte que ce qui n'a pas été vu", () => {
    const shelves = byPos(content, seen);
    const total = shelves.reduce((n, s) => n + s.entries.length + s.toCome, 0);
    expect(total).toBe([...content.concepts.values()].filter((c) => c.pos).length);
  });

  it("par thème : les unités du cursus, dans l'ordre, y compris celles pas encore ouvertes", () => {
    const shelves = byTheme(content, seen);
    const order = content.curriculum.units.map((u) => u.id);
    expect(shelves.map((s) => s.key)).toEqual(order.filter((id) => shelves.some((s) => s.key === id)));
    // La première unité est entamée ; une unité lointaine ne montre que son nombre.
    const first = shelves.find((s) => s.key === firstUnit.id)!;
    expect(first.entries.length).toBeGreaterThan(0);
    const later = shelves.filter((s) => s.entries.length === 0);
    expect(later.length).toBeGreaterThan(0);
    for (const shelf of later) expect(shelf.toCome).toBeGreaterThan(0);
  });
});
