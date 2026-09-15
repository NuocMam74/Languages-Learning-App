import { seededRandom, shuffle } from "../engine.ts";
import { heardClassOf, normalizeAnswer, stripTones, syllables, toneOf } from "../text.ts";
import type { Concept, ConceptId, Tone } from "../types.ts";

/**
 * Chợ nổi (marché flottant, spec §5.6.1) : des barques portent un mot écrit,
 * l'audio d'un des mots joue, on touche la bonne barque avant qu'elle sorte.
 *
 * Logique pure et déterministe (même graine = même partie). L'interface ne
 * fait qu'animer et appeler ces fonctions. Pas de vies : un raté compte, il
 * n'arrête rien (spec §3.3).
 */

export interface ChoNoiOptions {
  /** Nombre de manches (spec : 10 par défaut). */
  rounds: number;
  /** Durée maximale de la partie, en temps de jeu (ms). */
  durationMs: number;
  /** Barques par manche (cible comprise). */
  boats: number;
  /** Temps de traversée de la première manche (ms). */
  startTravelMs: number;
  /** Temps de traversée de la dernière manche (ms) : la vitesse augmente. */
  endTravelMs: number;
  /** Décalage de départ maximal d'une barque, en fraction de traversée. */
  maxStagger: number;
}

export const CHO_NOI_DEFAULTS: ChoNoiOptions = {
  rounds: 10,
  durationMs: 60_000,
  boats: 3,
  startTravelMs: 6_500,
  endTravelMs: 3_200,
  maxStagger: 0.3,
};

export interface ChoNoiBoat {
  conceptId: ConceptId;
  text: string;
  /** Couloir de la rivière (0 = le plus haut). */
  lane: number;
  /** Retard de départ, en fraction de traversée (0 ≤ stagger ≤ maxStagger). */
  stagger: number;
}

export interface ChoNoiRound {
  index: number;
  targetId: ConceptId;
  boats: ChoNoiBoat[];
  travelMs: number;
}

export interface ChoNoiAnswer {
  round: number;
  /** null = la barque est sortie sans être touchée. */
  chosen: ConceptId | null;
  correct: boolean;
  /** Temps de réaction depuis le début de la manche (ms de jeu). */
  reactionMs: number;
}

export interface ChoNoiState {
  rounds: ChoNoiRound[];
  answers: ChoNoiAnswer[];
  /** Temps de jeu écoulé (ms), manches terminées comprises. */
  elapsedMs: number;
  durationMs: number;
}

export interface ChoNoiResult {
  correct: number;
  total: number;
  points: number;
}

type HeardClasses = readonly (readonly Tone[])[];

// ---------------------------------------------------------------------------
// Pool

/**
 * Concepts jouables : un mot écrit distinct et, si `requireNative`, un audio
 * natif (en production, jamais de synthèse vocale pour un exercice de tons, §7.4).
 * Les doublons d'écriture sont retirés (deux barques « má » seraient ambiguës).
 */
export function choNoiPool(concepts: readonly Concept[], { requireNative }: { requireNative: boolean }): Concept[] {
  const seen = new Set<string>();
  return concepts.filter((c) => {
    const key = normalizeAnswer(c.vi);
    if (!key || seen.has(key)) return false;
    if (requireNative && !c.audio.some((a) => a.source === "native")) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Ce que l'oreille distingue : la base sans tons + la classe auditive de chaque
 * syllabe. Au Sud hỏi et ngã partagent une classe : « mả » et « mã » ont la même
 * clé et ne doivent jamais être opposés (§7.1).
 * Pack sans système tonal (ADR 0006) : les accents écrits ne sont pas une information
 * sonore fiable (es « si » / « sí »), deux formes qui ne diffèrent que par eux partagent
 * la même clé — choix prudent : on ne les oppose jamais à l'oreille.
 */
export function heardKey(text: string, heardClasses?: HeardClasses): string {
  const parts = syllables(text);
  if (!heardClasses) return parts.map((s) => stripTones(s)).join(" ");
  return parts.map((s) => `${stripTones(s)}:${heardClassOf(toneOf(s), heardClasses)}`).join(" ");
}

function toneless(text: string): string {
  return stripTones(normalizeAnswer(text));
}

/**
 * Distracteurs : d'abord les voisins tonals (même base sans tons), puis même
 * type de concept, puis le reste. Jamais deux barques que l'oreille du Sud
 * confondrait.
 */
export function pickChoNoiDistractors(
  target: Concept,
  pool: readonly Concept[],
  count: number,
  rand: () => number,
  heardClasses?: HeardClasses,
): Concept[] {
  const base = toneless(target.vi);
  const candidates = pool.filter((c) => c.id !== target.id);
  const tiers = [
    candidates.filter((c) => toneless(c.vi) === base),
    candidates.filter((c) => toneless(c.vi) !== base && c.type === target.type),
    candidates.filter((c) => toneless(c.vi) !== base && c.type !== target.type),
  ];
  const keys = new Set([heardKey(target.vi, heardClasses)]);
  const out: Concept[] = [];
  for (const tier of tiers) {
    for (const c of shuffle(tier, rand)) {
      if (out.length >= count) return out;
      const key = heardKey(c.vi, heardClasses);
      if (keys.has(key)) continue;
      keys.add(key);
      out.push(c);
    }
  }
  return out;
}

/** Courbe de vitesse : traversée linéairement plus courte de la 1re à la dernière manche. */
export function choNoiTravelMs(round: number, options: ChoNoiOptions = CHO_NOI_DEFAULTS): number {
  const { rounds, startTravelMs, endTravelMs } = options;
  if (rounds <= 1) return startTravelMs;
  const t = Math.min(1, Math.max(0, round / (rounds - 1)));
  return Math.round(startTravelMs + (endTravelMs - startTravelMs) * t);
}

/**
 * Génère toutes les manches. Il faut au moins 2 concepts distinguables à
 * l'oreille ; sinon la liste est vide (l'interface propose de passer).
 */
export function generateChoNoiRounds(
  pool: readonly Concept[],
  seed: string,
  partial: Partial<ChoNoiOptions> = {},
  heardClasses?: HeardClasses,
): ChoNoiRound[] {
  const options = { ...CHO_NOI_DEFAULTS, ...partial };
  const rand = seededRandom(`cho_noi:${seed}`);
  const playable = pool.filter((c) => pickChoNoiDistractors(c, pool, 1, () => 0, heardClasses).length > 0);
  if (playable.length === 0) return [];

  const rounds: ChoNoiRound[] = [];
  let deck: Concept[] = [];
  let previous: ConceptId | null = null;
  for (let index = 0; index < options.rounds; index++) {
    if (deck.length === 0) deck = shuffle(playable, rand);
    // Pas deux fois la même cible d'affilée quand on peut l'éviter.
    let pos = deck.findIndex((c) => c.id !== previous);
    if (pos < 0) pos = 0;
    const [target] = deck.splice(pos, 1) as [Concept];
    previous = target.id;

    const distractors = pickChoNoiDistractors(target, pool, options.boats - 1, rand, heardClasses);
    const concepts = shuffle([target, ...distractors], rand);
    const lanes = shuffle(concepts.map((_, i) => i), rand);
    const boats = concepts.map((c, i) => ({
      conceptId: c.id,
      text: c.vi,
      lane: lanes[i] ?? i,
      // Départs légèrement décalés : les barques ne s'alignent pas en rang d'oignons.
      stagger: Math.round(rand() * options.maxStagger * 1000) / 1000,
    }));
    rounds.push({ index, targetId: target.id, boats, travelMs: choNoiTravelMs(index, options) });
  }
  return rounds;
}

// ---------------------------------------------------------------------------
// Partie

export function startChoNoi(rounds: ChoNoiRound[], durationMs = CHO_NOI_DEFAULTS.durationMs): ChoNoiState {
  return { rounds, answers: [], elapsedMs: 0, durationMs };
}

export function currentChoNoiRound(state: ChoNoiState): ChoNoiRound | null {
  if (isChoNoiOver(state)) return null;
  return state.rounds[state.answers.length] ?? null;
}

export function isChoNoiOver(state: ChoNoiState): boolean {
  return state.answers.length >= state.rounds.length || state.elapsedMs >= state.durationMs;
}

/** Ajoute du temps de jeu (l'interface ne compte pas les pauses ni l'onglet caché). */
export function tickChoNoi(state: ChoNoiState, dtMs: number): ChoNoiState {
  return { ...state, elapsedMs: state.elapsedMs + Math.max(0, dtMs) };
}

/** Position d'une barque dans sa traversée : < 0 pas encore entrée, ≥ 1 sortie. */
export function choNoiBoatProgress(boat: ChoNoiBoat, round: ChoNoiRound, roundElapsedMs: number): number {
  return (roundElapsedMs - boat.stagger * round.travelMs) / round.travelMs;
}

/** Fin de manche par sortie de la cible : le moment où elle quitte l'écran. */
export function choNoiRoundDeadlineMs(round: ChoNoiRound): number {
  const target = round.boats.find((b) => b.conceptId === round.targetId);
  return round.travelMs * (1 + (target?.stagger ?? 0));
}

/** Enregistre la réponse de la manche courante (une seule touche par manche). */
export function answerChoNoi(state: ChoNoiState, chosen: ConceptId | null, reactionMs: number): ChoNoiState {
  const round = currentChoNoiRound(state);
  if (!round) return state;
  const answer: ChoNoiAnswer = { round: round.index, chosen, correct: chosen === round.targetId, reactionMs: Math.max(0, Math.round(reactionMs)) };
  return { ...state, answers: [...state.answers, answer] };
}

/** Points d'une bonne réponse : 10, + jusqu'à 5 selon la rapidité. */
export function choNoiPoints(answer: ChoNoiAnswer, round: ChoNoiRound | undefined): number {
  if (!answer.correct) return 0;
  const deadline = round ? choNoiRoundDeadlineMs(round) : 1;
  const speed = 1 - Math.min(1, answer.reactionMs / deadline);
  return 10 + Math.round(5 * speed);
}

/** Résultat pour le moteur : {correct, total} = manches jouées (évaluées par GAME_PASS_RATIO). */
export function choNoiResult(state: ChoNoiState): ChoNoiResult {
  const correct = state.answers.filter((a) => a.correct).length;
  const points = state.answers.reduce((sum, a) => sum + choNoiPoints(a, state.rounds[a.round]), 0);
  return { correct, total: state.answers.length, points };
}

export interface ChoNoiBest {
  points: number;
  correct: number;
  total: number;
}

/** Meilleur score : on garde le plus de points (à égalité, le meilleur ratio). */
export function betterChoNoiBest(previous: ChoNoiBest | null, result: ChoNoiResult): ChoNoiBest {
  const next = { points: result.points, correct: result.correct, total: result.total };
  if (!previous) return next;
  if (result.points !== previous.points) return result.points > previous.points ? next : previous;
  const ratio = (r: { correct: number; total: number }) => (r.total ? r.correct / r.total : 0);
  return ratio(next) > ratio(previous) ? next : previous;
}
