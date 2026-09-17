import { seededRandom, shuffle } from "../engine.ts";
import { normalizeAnswer } from "../text.ts";
import type { Concept, ConceptId } from "../types.ts";
import type { GameResult } from "./common.ts";

/**
 * Lô tô (contrat phase9 §7) : le loto des fêtes de rue du Sud. Une grille de mots écrits, une voix
 * qui appelle, une case à toucher. Entraîne la reconnaissance à l'oreille sur un vocabulaire large
 * — et le fait vite, parce qu'il faut chercher dans la grille.
 *
 * Logique pure et déterministe (même graine = même grille et même ordre d'appel). Pas de vies :
 * une case manquée revient une fois en fin de partie, elle n'interrompt rien (spec §3.3).
 */

export interface LoToOptions {
  rows: number;
  cols: number;
  /** En dessous, pas de partie : l'interface propose de passer. */
  minCells: number;
}

export const LO_TO_DEFAULTS: LoToOptions = { rows: 3, cols: 3, minCells: 6 };

/** Points par case trouvée, par ligne complétée, et pour une grille entière sans faute. */
export const LO_TO_POINTS = { cell: 10, line: 20, fullCard: 30 } as const;

export interface LoToCard {
  /** Cases de la grille, dans l'ordre de lecture. */
  cells: ConceptId[];
  /** Ordre des appels : toutes les cases, mélangées. */
  calls: ConceptId[];
  cols: number;
}

export interface LoToState {
  cells: ConceptId[];
  calls: ConceptId[];
  cols: number;
  /** Appel en cours (index dans `calls`) ; `calls.length` = partie finie. */
  index: number;
  /** Cases trouvées, dans l'ordre. */
  found: ConceptId[];
  /** Appels manqués (mauvaise case ou temps écoulé). */
  missed: ConceptId[];
  /** Mauvaises cases touchées, tous appels confondus. */
  slips: number;
}

/**
 * Concepts jouables : une piste audio (native si exigée) et une forme écrite distincte — deux cases
 * qui se lisent pareil rendraient l'appel injouable.
 */
export function loToPool(concepts: readonly Concept[], { requireNative = false }: { requireNative?: boolean } = {}): Concept[] {
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

/** Grille et ordre d'appel. Grille vide si le pool est trop petit. */
export function generateLoToCard(pool: readonly Concept[], seed: string, partial: Partial<LoToOptions> = {}): LoToCard {
  const options = { ...LO_TO_DEFAULTS, ...partial };
  const rand = seededRandom(`lo_to:${seed}`);
  const capacity = options.rows * options.cols;
  const count = Math.min(capacity, pool.length);
  if (count < options.minCells) return { cells: [], calls: [], cols: options.cols };
  const cells = shuffle(pool, rand).slice(0, count).map((concept) => concept.id);
  // La grille garde ses colonnes même incomplète : 3 colonnes pour 6 à 9 cases.
  return { cells, calls: shuffle(cells, rand), cols: options.cols };
}

export function startLoTo(card: LoToCard): LoToState {
  return { cells: card.cells, calls: card.calls, cols: card.cols, index: 0, found: [], missed: [], slips: 0 };
}

export const isLoToOver = (state: LoToState): boolean => state.index >= state.calls.length;

/** Concept appelé maintenant, null si la partie est finie. */
export function loToCall(state: LoToState): ConceptId | null {
  return isLoToOver(state) ? null : (state.calls[state.index] ?? null);
}

/** Case déjà marquée (trouvée ou définitivement manquée) : elle ne se touche plus. */
export function isLoToMarked(state: LoToState, cellIndex: number): boolean {
  const cell = state.cells[cellIndex];
  return cell !== undefined && (state.found.includes(cell) || state.missed.includes(cell));
}

/**
 * Touche une case pour l'appel en cours. La bonne case avance l'appel ; une mauvaise case compte un
 * écart et fait manquer l'appel — on n'insiste pas, le mot reviendra.
 */
export function markLoTo(state: LoToState, cellIndex: number): LoToState {
  const call = loToCall(state);
  const cell = state.cells[cellIndex];
  if (call === null || cell === undefined || isLoToMarked(state, cellIndex)) return state;
  if (cell === call) return { ...state, index: state.index + 1, found: [...state.found, call] };
  return { ...state, index: state.index + 1, missed: [...state.missed, call], slips: state.slips + 1 };
}

/** Temps écoulé sur un appel : il est manqué, sans écart compté (personne n'a rien touché). */
export function skipLoToCall(state: LoToState): LoToState {
  const call = loToCall(state);
  return call === null ? state : { ...state, index: state.index + 1, missed: [...state.missed, call] };
}

/** Indices des lignes complètes (rangées, colonnes, et diagonales si la grille est carrée). */
export function loToLines(state: LoToState): number[][] {
  const { cells, cols, found } = state;
  const rows = Math.ceil(cells.length / cols);
  const complete = new Set(found);
  const lines: number[][] = [];
  const take = (indices: number[]) => {
    if (indices.length > 1 && indices.every((i) => cells[i] !== undefined && complete.has(cells[i]))) lines.push(indices);
  };
  for (let row = 0; row < rows; row++) {
    take(Array.from({ length: cols }, (_, col) => row * cols + col).filter((i) => i < cells.length));
  }
  for (let col = 0; col < cols; col++) {
    take(Array.from({ length: rows }, (_, row) => row * cols + col).filter((i) => i < cells.length));
  }
  if (cells.length === rows * cols && rows === cols) {
    take(Array.from({ length: rows }, (_, i) => i * cols + i));
    take(Array.from({ length: rows }, (_, i) => i * cols + (cols - 1 - i)));
  }
  return lines;
}

export interface LoToResult extends GameResult {
  lines: number;
  /** Grille entière trouvée. */
  fullCard: boolean;
}

/**
 * Résultat : `correct` = cases trouvées, `total` = appels de la partie. Points : la case, la ligne,
 * et la grille complète.
 */
export function loToResult(state: LoToState): LoToResult {
  const lines = loToLines(state).length;
  const fullCard = state.found.length === state.cells.length && state.cells.length > 0;
  return {
    correct: state.found.length,
    total: state.calls.length,
    points: state.found.length * LO_TO_POINTS.cell + lines * LO_TO_POINTS.line + (fullCard ? LO_TO_POINTS.fullCard : 0),
    lines,
    fullCard,
  };
}
