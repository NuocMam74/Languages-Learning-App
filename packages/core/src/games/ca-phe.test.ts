import { describe, expect, it } from "vitest";
import type { Concept } from "../types.ts";
import {
  CA_PHE_DEFAULTS,
  CA_PHE_POINTS,
  caPheNext,
  caPheOrder,
  caPhePool,
  caPheResult,
  generateCaPheOrders,
  isCaPheOver,
  nextCaPhe,
  serveCaPhe,
  startCaPhe,
  type CaPheState,
} from "./ca-phe.ts";

function concept(id: string, vi = id, audio = true): Concept {
  return {
    id, type: "word", vi, gloss: { fr: id }, reviewed: false,
    audio: audio ? [{ voice: "v", src: `audio/${id}.opus`, source: "native", speed: "natural" }] : [],
  } as Concept;
}

const pool = Array.from({ length: 8 }, (_, i) => concept(`c${i}`, `mon${i}`));

/** Sert toute la partie sans se tromper. */
function solve(state: CaPheState): CaPheState {
  let s = state;
  while (!isCaPheOver(s)) {
    const next = caPheNext(s);
    s = next === null ? nextCaPhe(s) : serveCaPhe(s, next);
  }
  return s;
}

describe("Cà phê : comptoir", () => {
  it("exige audio et forme écrite distincte", () => {
    expect(caPhePool([concept("a", "cà phê"), concept("b", "cà phê"), concept("c", "trà", false)]).map((c) => c.id)).toEqual(["a"]);
  });

  it("génère le bon nombre de commandes, déterministes", () => {
    const orders = generateCaPheOrders(pool, "s");
    expect(orders).toHaveLength(CA_PHE_DEFAULTS.rounds);
    expect(orders).toEqual(generateCaPheOrders(pool, "s"));
    expect(orders).not.toEqual(generateCaPheOrders(pool, "autre"));
  });

  it("chaque commande tient dans les bornes et est servable depuis le comptoir", () => {
    for (const order of generateCaPheOrders(pool, "bornes")) {
      expect(order.items.length).toBeGreaterThanOrEqual(CA_PHE_DEFAULTS.minItems);
      expect(order.items.length).toBeLessThanOrEqual(CA_PHE_DEFAULTS.maxItems);
      expect(order.choices.length).toBeLessThanOrEqual(CA_PHE_DEFAULTS.choices);
      for (const item of order.items) expect(order.choices).toContain(item);
      // Il faut écouter : le comptoir propose plus que la commande.
      expect(order.choices.length).toBeGreaterThan(order.items.length);
    }
  });

  it("pas de partie sous le pool minimal", () => {
    expect(generateCaPheOrders(pool.slice(0, 3), "s")).toEqual([]);
  });
});

describe("Cà phê : service", () => {
  const orders = generateCaPheOrders(pool, "service");

  it("servir dans l'ordre termine la commande et passe à la suivante", () => {
    let state = startCaPhe(orders);
    const first = caPheOrder(state)!;
    for (const item of first.items) state = serveCaPhe(state, item);
    expect(state.index).toBe(1);
    expect(state.done).toBe(1);
    expect(state.items).toBe(first.items.length);
    expect(state.served).toEqual([]);
  });

  it("un article hors ordre rate la commande, sans arrêter la partie", () => {
    const state = startCaPhe(orders);
    const order = caPheOrder(state)!;
    const wrong = order.choices.find((id) => id !== order.items[0])!;
    const failed = serveCaPhe(state, wrong);
    expect(failed.wrong).toBe(true);
    expect(failed.failed).toBe(1);
    expect(failed.done).toBe(0);
    // Tant que l'erreur est affichée, plus rien ne se sert.
    expect(caPheNext(failed)).toBeNull();
    expect(serveCaPhe(failed, order.items[0]!)).toBe(failed);
    const resumed = nextCaPhe(failed);
    expect(resumed.index).toBe(1);
    expect(resumed.wrong).toBe(false);
    expect(isCaPheOver(resumed)).toBe(false);
  });

  it("le bon deuxième article ne compte pas si le premier était faux", () => {
    let state = startCaPhe(orders);
    const order = caPheOrder(state)!;
    // Le deuxième article servi en premier : c'est une erreur, même s'il est dans la commande.
    if (order.items.length > 1) {
      state = serveCaPhe(state, order.items[1]!);
      expect(state.wrong).toBe(true);
      expect(state.items).toBe(0);
    }
  });

  it("une partie parfaite compte articles et commandes", () => {
    const over = solve(startCaPhe(orders));
    const totalItems = orders.reduce((sum, order) => sum + order.items.length, 0);
    const result = caPheResult(over);
    expect(result).toMatchObject({ correct: orders.length, total: orders.length, items: totalItems });
    expect(result.points).toBe(totalItems * CA_PHE_POINTS.item + orders.length * CA_PHE_POINTS.order);
  });

  it("une partie ratée d'un bout à l'autre ne rapporte rien", () => {
    let state = startCaPhe(orders);
    while (!isCaPheOver(state)) {
      const order = caPheOrder(state)!;
      const wrong = order.choices.find((id) => id !== order.items[0]);
      state = nextCaPhe(wrong ? serveCaPhe(state, wrong) : state);
    }
    expect(caPheResult(state)).toMatchObject({ correct: 0, points: 0, items: 0 });
    expect(nextCaPhe(state)).toBe(state);
  });
});
