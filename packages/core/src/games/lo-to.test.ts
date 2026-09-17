import { describe, expect, it } from "vitest";
import type { Concept } from "../types.ts";
import {
  generateLoToCard,
  isLoToMarked,
  isLoToOver,
  LO_TO_POINTS,
  loToCall,
  loToLines,
  loToPool,
  loToResult,
  markLoTo,
  skipLoToCall,
  startLoTo,
  type LoToState,
} from "./lo-to.ts";

function concept(id: string, vi = id, audio = true): Concept {
  return {
    id, type: "word", vi, gloss: { fr: id }, reviewed: false,
    audio: audio ? [{ voice: "v", src: `audio/${id}.opus`, source: "native", speed: "natural" }] : [],
  } as Concept;
}

const nine = Array.from({ length: 9 }, (_, i) => concept(`c${i}`, `mot${i}`));

/** Touche toujours la bonne case. */
function solve(state: LoToState): LoToState {
  let s = state;
  while (!isLoToOver(s)) {
    const call = loToCall(s)!;
    s = markLoTo(s, s.cells.indexOf(call));
  }
  return s;
}

describe("Lô tô : pool et grille", () => {
  it("exige une piste audio et une forme écrite distincte", () => {
    const pool = loToPool([concept("a", "ba"), concept("b", "ba"), concept("c", "má", false), concept("d", "cá")]);
    expect(pool.map((c) => c.id)).toEqual(["a", "d"]);
  });

  it("n'accepte que l'audio natif quand on l'exige", () => {
    const tts = { ...concept("e", "em"), audio: [{ voice: "v", src: "a.opus", source: "tts", speed: "natural" }] } as Concept;
    expect(loToPool([tts], { requireNative: true })).toEqual([]);
    expect(loToPool([tts])).toHaveLength(1);
  });

  it("appelle chaque case une fois exactement", () => {
    const card = generateLoToCard(nine, "s");
    expect(card.cells).toHaveLength(9);
    expect([...card.calls].sort()).toEqual([...card.cells].sort());
  });

  it("est déterministe, et vide sous le minimum de cases", () => {
    expect(generateLoToCard(nine, "s")).toEqual(generateLoToCard(nine, "s"));
    expect(generateLoToCard(nine, "s")).not.toEqual(generateLoToCard(nine, "autre"));
    expect(generateLoToCard(nine.slice(0, 4), "s").cells).toEqual([]);
  });
});

describe("Lô tô : partie", () => {
  const card = generateLoToCard(nine, "partie");

  it("la bonne case avance l'appel", () => {
    const state = startLoTo(card);
    const next = markLoTo(state, state.cells.indexOf(loToCall(state)!));
    expect(next.index).toBe(1);
    expect(next.found).toHaveLength(1);
    expect(next.slips).toBe(0);
  });

  it("une mauvaise case compte un écart et fait manquer l'appel", () => {
    const state = startLoTo(card);
    const call = loToCall(state)!;
    const wrong = state.cells.findIndex((cell) => cell !== call);
    const next = markLoTo(state, wrong);
    expect(next.slips).toBe(1);
    expect(next.missed).toEqual([call]);
    expect(next.found).toEqual([]);
  });

  it("le temps écoulé manque l'appel sans compter d'écart", () => {
    const next = skipLoToCall(startLoTo(card));
    expect(next.missed).toHaveLength(1);
    expect(next.slips).toBe(0);
  });

  it("une case déjà marquée ne se retouche pas, et rien ne bouge après la fin", () => {
    const state = markLoTo(startLoTo(card), startLoTo(card).cells.indexOf(loToCall(startLoTo(card))!));
    const marked = state.cells.indexOf(state.found[0]!);
    expect(isLoToMarked(state, marked)).toBe(true);
    expect(markLoTo(state, marked)).toBe(state);
    const over = solve(startLoTo(card));
    expect(isLoToOver(over)).toBe(true);
    expect(loToCall(over)).toBeNull();
    expect(markLoTo(over, 0)).toBe(over);
    expect(skipLoToCall(over)).toBe(over);
  });

  it("compte les lignes, colonnes et diagonales d'une grille pleine", () => {
    const over = solve(startLoTo(card));
    // 3 rangées + 3 colonnes + 2 diagonales.
    expect(loToLines(over)).toHaveLength(8);
    const result = loToResult(over);
    expect(result).toMatchObject({ correct: 9, total: 9, lines: 8, fullCard: true });
    expect(result.points).toBe(9 * LO_TO_POINTS.cell + 8 * LO_TO_POINTS.line + LO_TO_POINTS.fullCard);
  });

  it("une case manquée casse sa ligne et sa colonne", () => {
    let state = startLoTo(card);
    // Rate le premier appel, réussit tout le reste.
    state = skipLoToCall(state);
    state = solve(state);
    const result = loToResult(state);
    expect(result.correct).toBe(8);
    expect(result.fullCard).toBe(false);
    expect(result.lines).toBeLessThan(8);
  });

  it("une partie sans rien toucher ne rapporte aucun point", () => {
    let state = startLoTo(card);
    while (!isLoToOver(state)) state = skipLoToCall(state);
    expect(loToResult(state)).toMatchObject({ correct: 0, points: 0, lines: 0 });
  });
});
