import { seededRandom, shuffle } from "../engine.ts";
import { normalizeAnswer } from "../text.ts";
import type { Concept, ConceptId } from "../types.ts";
import type { GameResult } from "./common.ts";

/**
 * Cà phê sữa đá (contrat phase9 §7) : le comptoir de rue. Un client commande deux à quatre choses,
 * on les sert **dans l'ordre**. Entraîne l'écoute d'une suite — donc l'ordre des mots, ce qu'aucun
 * autre jeu ne travaille : Chợ nổi fait un mot à la fois, Bữa cơm assemble une phrase écrite.
 *
 * Logique pure et déterministe. Une erreur termine la commande en cours, jamais la partie
 * (spec §3.3) : le client suivant arrive, et la commande ratée compte comme telle, sans plus.
 */

export interface CaPheOptions {
  /** Commandes d'une partie. */
  rounds: number;
  /** Bornes du nombre d'articles par commande. */
  minItems: number;
  maxItems: number;
  /** Articles proposés au comptoir (la commande comprise). */
  choices: number;
  /** En dessous, pas de partie. */
  minPool: number;
}

export const CA_PHE_DEFAULTS: CaPheOptions = { rounds: 5, minItems: 2, maxItems: 4, choices: 6, minPool: 6 };

/** Points par article bien servi, et par commande complète sans erreur. */
export const CA_PHE_POINTS = { item: 5, order: 15 } as const;

export interface CaPheOrder {
  /** Articles à servir, dans l'ordre. */
  items: ConceptId[];
  /** Articles du comptoir, mélangés (la commande et des voisins). */
  choices: ConceptId[];
}

export interface CaPheState {
  orders: CaPheOrder[];
  /** Commande en cours ; `orders.length` = partie finie. */
  index: number;
  /** Articles déjà servis pour la commande en cours. */
  served: ConceptId[];
  /** Commandes servies en entier sans erreur. */
  done: number;
  /** Commandes ratées. */
  failed: number;
  /** Articles bien servis, toutes commandes confondues. */
  items: number;
  /** La commande en cours vient d'être ratée : l'interface le montre, puis appelle `nextCaPhe`. */
  wrong: boolean;
}

/** Concepts servables : une forme écrite distincte et au moins une piste audio pour la commande. */
export function caPhePool(concepts: readonly Concept[], { requireNative = false }: { requireNative?: boolean } = {}): Concept[] {
  const seen = new Set<string>();
  return concepts.filter((concept) => {
    const word = normalizeAnswer(concept.vi);
    if (!word || seen.has(word)) return false;
    const tracks = requireNative ? concept.audio.filter((track) => track.source === "native") : concept.audio;
    if (tracks.length === 0) return false;
    seen.add(word);
    return true;
  });
}

/** Commandes d'une partie. Liste vide si le pool est trop petit. */
export function generateCaPheOrders(pool: readonly Concept[], seed: string, partial: Partial<CaPheOptions> = {}): CaPheOrder[] {
  const options = { ...CA_PHE_DEFAULTS, ...partial };
  if (pool.length < options.minPool) return [];
  const rand = seededRandom(`ca_phe:${seed}`);
  const ids = pool.map((concept) => concept.id);
  const choiceCount = Math.min(options.choices, ids.length);
  const maxItems = Math.min(options.maxItems, choiceCount);
  return Array.from({ length: options.rounds }, (_, round) => {
    const bag = shuffle(ids, rand);
    const count = options.minItems + Math.floor(rand() * Math.max(1, maxItems - options.minItems + 1));
    const items = bag.slice(0, Math.min(count, maxItems));
    // Le comptoir montre la commande et juste assez de voisins pour qu'il faille écouter.
    const extras = bag.slice(items.length, items.length + Math.max(0, choiceCount - items.length));
    void round;
    return { items, choices: shuffle([...items, ...extras], rand) };
  }).filter((order) => order.items.length >= options.minItems);
}

export function startCaPhe(orders: CaPheOrder[]): CaPheState {
  return { orders, index: 0, served: [], done: 0, failed: 0, items: 0, wrong: false };
}

export const isCaPheOver = (state: CaPheState): boolean => state.index >= state.orders.length;

export function caPheOrder(state: CaPheState): CaPheOrder | null {
  return isCaPheOver(state) ? null : (state.orders[state.index] ?? null);
}

/** Article attendu maintenant, null si la commande est finie ou ratée. */
export function caPheNext(state: CaPheState): ConceptId | null {
  const order = caPheOrder(state);
  if (!order || state.wrong) return null;
  return order.items[state.served.length] ?? null;
}

/**
 * Sert un article. Le bon avance la commande (et la termine si c'était le dernier) ; un mauvais
 * marque la commande ratée — l'interface montre l'erreur, puis appelle `nextCaPhe`.
 */
export function serveCaPhe(state: CaPheState, conceptId: ConceptId): CaPheState {
  const expected = caPheNext(state);
  const order = caPheOrder(state);
  if (expected === null || !order) return state;
  if (conceptId !== expected) return { ...state, wrong: true, failed: state.failed + 1 };
  const served = [...state.served, conceptId];
  const items = state.items + 1;
  if (served.length < order.items.length) return { ...state, served, items };
  return { ...state, served: [], items, done: state.done + 1, index: state.index + 1 };
}

/** Passe à la commande suivante après une erreur (ou un abandon de commande). */
export function nextCaPhe(state: CaPheState): CaPheState {
  if (isCaPheOver(state)) return state;
  return { ...state, index: state.index + 1, served: [], wrong: false };
}

export interface CaPheResult extends GameResult {
  /** Articles bien servis. */
  items: number;
}

/** Résultat : `correct` = commandes complètes, `total` = commandes de la partie. */
export function caPheResult(state: CaPheState): CaPheResult {
  return {
    correct: state.done,
    total: state.orders.length,
    points: state.items * CA_PHE_POINTS.item + state.done * CA_PHE_POINTS.order,
    items: state.items,
  };
}
