import { seededRandom, shuffle } from "../engine.ts";
import { normalizeAnswer } from "../text.ts";
import type { Concept, ConceptId } from "../types.ts";

/**
 * Nhớ mặt (mémoire, spec §5.6.6) : grille 4×4 de cartes retournées, paires
 * image ↔ audio (ou image ↔ mot écrit en mode silencieux / sans audio).
 *
 * Logique pure et déterministe (même graine = même grille). L'interface ne fait
 * qu'animer le retournement et appeler ces fonctions. Pas de chrono, pas de vies.
 */

/** Face « son » d'une paire : l'audio du mot, ou le mot écrit. */
export type NhoMatMode = "audio" | "text";

export interface NhoMatOptions {
  /** Paires visées (4×4 → 8). */
  pairs: number;
  /** En dessous, pas de partie (l'interface propose de passer). */
  minPairs: number;
}

export const NHO_MAT_DEFAULTS: NhoMatOptions = { pairs: 8, minPairs: 3 };

export interface NhoMatCard {
  /** Identifiant stable : `${conceptId}:image` ou `${conceptId}:audio|text`. */
  key: string;
  conceptId: ConceptId;
  face: "image" | NhoMatMode;
}

export interface NhoMatState {
  cards: NhoMatCard[];
  /** Indices des cartes retournées du coup en cours (0, 1 ou 2). */
  open: number[];
  /** Concepts dont la paire est trouvée, dans l'ordre. */
  matched: ConceptId[];
  /** Coups joués (une paire de cartes retournées = un coup). */
  moves: number;
  /** Indices déjà vus au moins une fois. */
  seen: number[];
  /** Oublis par concept : la carte jumelle avait déjà été vue et n'a pas été choisie. */
  slips: Record<ConceptId, number>;
}

export interface NhoMatResult {
  /** Paires trouvées sans oubli (→ moteur : correct / total). */
  correct: number;
  total: number;
  points: number;
  moves: number;
}

// ---------------------------------------------------------------------------
// Pool et grille

/**
 * Concepts jouables : une image, un mot écrit distinct, une image distincte et,
 * en mode audio, au moins une piste (native exigée si `requireNative`).
 */
export function nhoMatPool(concepts: readonly Concept[], { mode, requireNative = false }: { mode: NhoMatMode; requireNative?: boolean }): Concept[] {
  const words = new Set<string>();
  const images = new Set<string>();
  return concepts.filter((c) => {
    if (!c.image) return false;
    const word = normalizeAnswer(c.vi);
    if (!word || words.has(word) || images.has(c.image)) return false;
    if (mode === "audio") {
      const tracks = requireNative ? c.audio.filter((a) => a.source === "native") : c.audio;
      if (tracks.length === 0) return false;
    }
    words.add(word);
    images.add(c.image);
    return true;
  });
}

/** Grille mélangée : `pairs` concepts tirés du pool, deux cartes chacun. Vide si le pool est trop petit. */
export function generateNhoMatDeck(pool: readonly Concept[], seed: string, mode: NhoMatMode, partial: Partial<NhoMatOptions> = {}): NhoMatCard[] {
  const options = { ...NHO_MAT_DEFAULTS, ...partial };
  const rand = seededRandom(`nho_mat:${seed}`);
  const count = Math.min(options.pairs, pool.length);
  if (count < options.minPairs) return [];
  const chosen = shuffle(pool, rand).slice(0, count);
  const cards = chosen.flatMap((c): NhoMatCard[] => [
    { key: `${c.id}:image`, conceptId: c.id, face: "image" },
    { key: `${c.id}:${mode}`, conceptId: c.id, face: mode },
  ]);
  return shuffle(cards, rand);
}

/** Colonnes de la grille : 4 dès 8 cartes (4×4 pour 8 paires), sinon 3. */
export function nhoMatColumns(cardCount: number): number {
  return cardCount >= 8 ? 4 : 3;
}

// ---------------------------------------------------------------------------
// Partie

export function startNhoMat(cards: NhoMatCard[]): NhoMatState {
  return { cards, open: [], matched: [], moves: 0, seen: [], slips: {} };
}

export function isNhoMatOver(state: NhoMatState): boolean {
  return state.cards.length > 0 && state.matched.length * 2 >= state.cards.length;
}

/** Deux cartes ouvertes qui ne vont pas ensemble : l'interface les montre, puis appelle `hideNhoMat`. */
export function nhoMatMismatch(state: NhoMatState): boolean {
  if (state.open.length !== 2) return false;
  const [a, b] = state.open as [number, number];
  return state.cards[a]?.conceptId !== state.cards[b]?.conceptId;
}

export function canFlipNhoMat(state: NhoMatState, index: number): boolean {
  const card = state.cards[index];
  if (!card || isNhoMatOver(state)) return false;
  if (state.open.length >= 2 || state.open.includes(index)) return false;
  return !state.matched.includes(card.conceptId);
}

function partnerIndex(state: NhoMatState, index: number): number {
  const card = state.cards[index];
  return state.cards.findIndex((c, i) => i !== index && c.conceptId === card?.conceptId);
}

/**
 * Retourne une carte. Au deuxième retournement, le coup est compté : paire
 * trouvée (les cartes restent visibles) ou non (elles restent ouvertes jusqu'à
 * `hideNhoMat`). Un retournement impossible renvoie l'état tel quel.
 */
export function flipNhoMat(state: NhoMatState, index: number): NhoMatState {
  if (!canFlipNhoMat(state, index)) return state;
  const open = [...state.open, index];
  if (open.length === 1) {
    return { ...state, open, seen: state.seen.includes(index) ? state.seen : [...state.seen, index] };
  }

  const [first, second] = open as [number, number];
  const a = state.cards[first]!;
  const b = state.cards[second]!;
  const seenBefore = new Set(state.seen);
  const slips = { ...state.slips };
  const seen = seenBefore.has(second) ? state.seen : [...state.seen, second];
  if (a.conceptId === b.conceptId) {
    return { ...state, open: [], matched: [...state.matched, a.conceptId], moves: state.moves + 1, seen, slips };
  }
  // Oubli : la jumelle de la première carte avait déjà été vue, et on ne l'a pas prise.
  if (seenBefore.has(partnerIndex(state, first))) slips[a.conceptId] = (slips[a.conceptId] ?? 0) + 1;
  // Oubli aussi : la deuxième carte était connue, sa jumelle aussi, et on l'a ouverte quand même.
  if (seenBefore.has(second) && seenBefore.has(partnerIndex(state, second))) slips[b.conceptId] = (slips[b.conceptId] ?? 0) + 1;
  return { ...state, open, moves: state.moves + 1, seen, slips };
}

/** Referme les deux cartes d'un coup raté. */
export function hideNhoMat(state: NhoMatState): NhoMatState {
  return nhoMatMismatch(state) ? { ...state, open: [] } : state;
}

/**
 * Résultat : `correct` = paires trouvées sans oubli, `total` = paires de la
 * grille. Points : 10 par paire + 5 par coup économisé sous 2 × paires.
 */
export function nhoMatResult(state: NhoMatState): NhoMatResult {
  const total = state.cards.length / 2;
  const correct = state.matched.filter((id) => !state.slips[id]).length;
  const bonus = Math.max(0, total * 2 - state.moves) * 5;
  return { correct, total, points: state.matched.length * 10 + (isNhoMatOver(state) ? bonus : 0), moves: state.moves };
}
