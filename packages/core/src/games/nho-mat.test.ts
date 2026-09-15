import { describe, expect, it } from "vitest";
import { loadPack } from "../testing/pack.ts";
import type { Concept } from "../types.ts";
import {
  canFlipNhoMat,
  flipNhoMat,
  generateNhoMatDeck,
  hideNhoMat,
  isNhoMatOver,
  nhoMatColumns,
  nhoMatMismatch,
  nhoMatPool,
  nhoMatResult,
  startNhoMat,
  type NhoMatState,
} from "./nho-mat.ts";

const content = loadPack();
const concepts = [...content.concepts.values()];

function concept(id: string, vi: string, image?: string, audio = true): Concept {
  return {
    id, type: "word", vi, gloss: { fr: id }, reviewed: false,
    audio: audio ? [{ voice: "v", src: `audio/${id}.opus`, source: "native", speed: "natural" }] : [],
    ...(image ? { image } : {}),
  } as Concept;
}

/** Joue parfaitement : chaque paire du premier coup. */
function solve(state: NhoMatState): NhoMatState {
  let s = state;
  for (const id of new Set(s.cards.map((c) => c.conceptId))) {
    const [a, b] = s.cards.flatMap((c, i) => (c.conceptId === id ? [i] : []));
    s = flipNhoMat(flipNhoMat(s, a!), b!);
  }
  return s;
}

describe("Nhớ mặt : pool et grille", () => {
  it("garde les concepts avec image, mot et image distincts, audio exigé en mode audio", () => {
    const pool = [
      concept("a", "chó", "img/dog.svg"),
      concept("b", "Chó", "img/dog2.svg"), // même mot
      concept("c", "mèo", "img/dog.svg"), // même image
      concept("d", "cá"), // pas d'image
      concept("e", "gà", "img/chicken.svg", false), // pas d'audio
    ];
    expect(nhoMatPool(pool, { mode: "audio" }).map((c) => c.id)).toEqual(["a"]);
    expect(nhoMatPool(pool, { mode: "text" }).map((c) => c.id)).toEqual(["a", "e"]);
  });

  it("le pack réel fournit au moins 8 paires jouables", () => {
    expect(nhoMatPool(concepts, { mode: "audio", requireNative: true }).length).toBeGreaterThanOrEqual(8);
  });

  it("grille 4×4 déterministe : 8 paires, chaque concept deux fois (image + son)", () => {
    const pool = nhoMatPool(concepts, { mode: "audio" });
    const deck = generateNhoMatDeck(pool, "seed-1", "audio");
    expect(deck).toHaveLength(16);
    expect(generateNhoMatDeck(pool, "seed-1", "audio")).toEqual(deck);
    expect(generateNhoMatDeck(pool, "seed-2", "audio")).not.toEqual(deck);
    const byConcept = new Map<string, typeof deck>();
    for (const card of deck) byConcept.set(card.conceptId, [...(byConcept.get(card.conceptId) ?? []), card]);
    expect(byConcept.size).toBe(8);
    for (const cards of byConcept.values()) expect(cards.map((c) => c.face).sort()).toEqual(["audio", "image"]);
    expect(new Set(deck.map((c) => c.key)).size).toBe(16);
    expect(nhoMatColumns(deck.length)).toBe(4);
  });

  it("mode texte, petit pool : moins de paires ; trop petit : aucune partie", () => {
    const pool = [concept("a", "chó", "i/a"), concept("b", "mèo", "i/b"), concept("c", "gà", "i/c"), concept("d", "cá", "i/d")];
    const deck = generateNhoMatDeck(pool, "s", "text");
    expect(deck).toHaveLength(8);
    expect(deck.some((c) => c.face === "text")).toBe(true);
    expect(generateNhoMatDeck(pool.slice(0, 2), "s", "text")).toEqual([]);
  });
});

describe("Nhớ mặt : partie", () => {
  const pool = nhoMatPool(concepts, { mode: "audio" });
  const deck = generateNhoMatDeck(pool, "partie", "audio");

  it("partie parfaite : 8 coups, 8/8, points maximum", () => {
    const end = solve(startNhoMat(deck));
    expect(isNhoMatOver(end)).toBe(true);
    expect(end.moves).toBe(8);
    expect(nhoMatResult(end)).toEqual({ correct: 8, total: 8, points: 80 + 8 * 5, moves: 8 });
  });

  it("coup raté : les cartes restent ouvertes, plus de retournement, puis se referment", () => {
    let s = startNhoMat(deck);
    const first = 0;
    const other = s.cards.findIndex((c) => c.conceptId !== s.cards[first]!.conceptId);
    s = flipNhoMat(s, first);
    expect(flipNhoMat(s, first)).toBe(s); // même carte : ignoré
    s = flipNhoMat(s, other);
    expect(s.moves).toBe(1);
    expect(nhoMatMismatch(s)).toBe(true);
    const third = s.cards.findIndex((_, i) => i !== first && i !== other);
    expect(canFlipNhoMat(s, third)).toBe(false);
    s = hideNhoMat(s);
    expect(s.open).toEqual([]);
    expect(canFlipNhoMat(s, third)).toBe(true);
  });

  it("oubli : ignorer une jumelle déjà vue enlève la paire des « correct »", () => {
    let s = startNhoMat(deck);
    const a = 0;
    const partner = s.cards.findIndex((c, i) => i !== a && c.conceptId === s.cards[a]!.conceptId);
    const strangers = s.cards.flatMap((c, i) => (c.conceptId !== s.cards[a]!.conceptId ? [i] : []));
    // Coup 1 : a + inconnue (découverte, pas un oubli).
    s = hideNhoMat(flipNhoMat(flipNhoMat(s, a), strangers[0]!));
    expect(s.slips).toEqual({});
    // Coup 2 : la jumelle + une autre inconnue… la jumelle de `partner` (a) était vue : oubli.
    const otherStranger = strangers.find((i) => i !== strangers[0] && s.cards[i]!.conceptId !== s.cards[strangers[0]!]!.conceptId)!;
    s = hideNhoMat(flipNhoMat(flipNhoMat(s, partner), otherStranger));
    expect(s.slips[s.cards[a]!.conceptId]).toBe(1);
    const end = solve(s);
    const result = nhoMatResult(end);
    expect(result.total).toBe(8);
    expect(result.correct).toBeLessThan(8);
    expect(result.moves).toBe(end.moves);
    expect(canFlipNhoMat(end, 0)).toBe(false);
  });
});
