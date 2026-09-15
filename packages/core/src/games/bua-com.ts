import { canBuild } from "../content-checks.ts";
import { seededRandom, shuffle } from "../engine.ts";
import { compareAnswer, normalizeAnswer, stripTones } from "../text.ts";
import type { ConceptId, ContentIndex, LessonId, Localized } from "../types.ts";
import type { GameResult } from "./common.ts";

/**
 * Bữa cơm (le repas, spec §5.6.4) : construire la phrase avant que le plat
 * refroidisse. Les phrases viennent des étapes `build_sentence` des leçons
 * déjà vues ; on ajoute quelques jetons pièges. Le chrono est doux : la vapeur
 * s'éteint, le bonus de chaleur baisse, mais on peut toujours répondre.
 *
 * Logique pure et déterministe (même graine = même partie).
 */

export interface BuaComOptions {
  rounds: number;
  /** Temps « plat chaud » de base (ms). */
  baseMs: number;
  /** Temps ajouté par jeton de la phrase cible. */
  perTokenMs: number;
  /** Jetons pièges ajoutés : de min (1re manche) à max (dernière). */
  minExtra: number;
  maxExtra: number;
  /** Jetons affichés au plus (pour tenir dans la zone du pouce). */
  maxTokens: number;
}

export const BUA_COM_DEFAULTS: BuaComOptions = {
  rounds: 5,
  baseMs: 12_000,
  perTokenMs: 2_500,
  minExtra: 1,
  maxExtra: 2,
  maxTokens: 8,
};

export interface BuaComSource {
  lessonId: LessonId;
  stepIndex: number;
  target: string;
  tokens: string[];
  translation: Localized;
  audioConcept: ConceptId | null;
  explain: Localized | null;
  /** Rang de la leçon dans le parcours. */
  order: number;
}

export interface BuaComToken {
  id: string;
  text: string;
}

export interface BuaComRound {
  index: number;
  source: BuaComSource;
  tokens: BuaComToken[];
  /** Temps avant que le plat soit froid (ms). */
  hotMs: number;
}

export type BuaComVerdict = "correct" | "near" | "wrong";

export interface BuaComAnswer {
  round: number;
  tokenIds: string[];
  sentence: string;
  verdict: BuaComVerdict;
  elapsedMs: number;
}

export interface BuaComState {
  rounds: BuaComRound[];
  answers: BuaComAnswer[];
}

// ---------------------------------------------------------------------------
// Sources

function lessonOrder(content: ContentIndex): LessonId[] {
  return content.curriculum.units.flatMap((u) => u.lessons).filter((id) => content.lessons.has(id));
}

/**
 * Phrases jouables pour un pool de concepts : étapes `build_sentence` des
 * leçons qui partagent un concept avec le pool, jusqu'à l'horizon du pool
 * (la dernière leçon qui introduit l'un de ses concepts) — jamais une phrase
 * d'une leçon future. Les cibles en double sont retirées.
 */
export function buaComSources(content: ContentIndex, poolIds: readonly ConceptId[]): BuaComSource[] {
  const order = lessonOrder(content);
  const firstIntro = new Map<ConceptId, number>();
  order.forEach((id, i) => {
    for (const c of content.lessons.get(id)?.concepts ?? []) if (!firstIntro.has(c)) firstIntro.set(c, i);
  });
  const pool = new Set(poolIds);
  let horizon = -1;
  for (const id of pool) horizon = Math.max(horizon, firstIntro.get(id) ?? -1);

  const seen = new Set<string>();
  const out: BuaComSource[] = [];
  for (let i = 0; i <= horizon; i++) {
    const lesson = content.lessons.get(order[i] ?? "");
    if (!lesson || !lesson.concepts.some((c) => pool.has(c))) continue;
    lesson.steps.forEach((step, stepIndex) => {
      if (step.type !== "build_sentence") return;
      const key = normalizeAnswer(step.target);
      if (seen.has(key) || !canBuild(step.target, step.tokens)) return;
      seen.add(key);
      out.push({
        lessonId: lesson.id, stepIndex, target: step.target, tokens: [...step.tokens], translation: step.translation,
        audioConcept: step.audioConcept ?? null, explain: step.explain ?? null, order: i,
      });
    });
  }
  return out;
}

/** Nombre de jetons de la cible (plus il y en a, plus la phrase est longue). */
export function buaComTargetLength(source: Pick<BuaComSource, "target" | "tokens">): number {
  const goal = normalizeAnswer(source.target).split(" ").length;
  return Math.max(1, Math.min(source.tokens.length, goal));
}

/**
 * Jetons pièges : d'abord les voisins tonals d'un jeton de la phrase (má/mà),
 * puis les jetons d'une longueur proche pris aux autres phrases, puis le reste.
 * Jamais un jeton identique (après normalisation) à un jeton déjà présent.
 */
export function pickBuaComDistractors(source: BuaComSource, others: readonly BuaComSource[], count: number, rand: () => number): string[] {
  if (count <= 0) return [];
  const present = new Set(source.tokens.map(normalizeAnswer));
  const tonelessPresent = new Set([...present].map(stripTones));
  const candidates = new Map<string, string>();
  for (const other of others) {
    if (other === source) continue;
    for (const tok of other.tokens) {
      const key = normalizeAnswer(tok);
      if (key && !present.has(key) && !candidates.has(key)) candidates.set(key, tok);
    }
  }
  const all = [...candidates.entries()];
  const words = (s: string) => s.split(" ").length;
  const tiers = [
    all.filter(([k]) => tonelessPresent.has(stripTones(k))),
    all.filter(([k]) => !tonelessPresent.has(stripTones(k)) && words(k) === 1),
    all.filter(([k]) => !tonelessPresent.has(stripTones(k)) && words(k) > 1),
  ];
  const out: string[] = [];
  for (const tier of tiers) {
    for (const [, text] of shuffle(tier, rand)) {
      if (out.length >= count) return out;
      out.push(text);
    }
  }
  return out;
}

export function buaComHotMs(source: Pick<BuaComSource, "target" | "tokens">, options: BuaComOptions = BUA_COM_DEFAULTS): number {
  return options.baseMs + options.perTokenMs * buaComTargetLength(source);
}

/**
 * Manches : on privilégie les phrases des leçons les plus récentes du pool,
 * on tire au sort parmi elles, puis on ordonne de la plus courte à la plus longue.
 */
export function generateBuaComRounds(sources: readonly BuaComSource[], seed: string, partial: Partial<BuaComOptions> = {}): BuaComRound[] {
  const options = { ...BUA_COM_DEFAULTS, ...partial };
  const rand = seededRandom(`bua_com:${seed}`);
  if (sources.length === 0 || options.rounds <= 0) return [];

  const recent = [...sources].sort((a, b) => b.order - a.order || a.stepIndex - b.stepIndex).slice(0, options.rounds * 2);
  const chosen = shuffle(recent, rand)
    .slice(0, options.rounds)
    .sort((a, b) => buaComTargetLength(a) - buaComTargetLength(b) || a.order - b.order || a.stepIndex - b.stepIndex);

  return chosen.map((source, index) => {
    const t = chosen.length <= 1 ? 0 : index / (chosen.length - 1);
    const wanted = Math.round(options.minExtra + (options.maxExtra - options.minExtra) * t);
    const room = Math.max(0, options.maxTokens - source.tokens.length);
    const extra = pickBuaComDistractors(source, sources, Math.min(wanted, room), rand);
    const texts = shuffle([...source.tokens, ...extra], rand);
    return {
      index,
      source,
      tokens: texts.map((text, i) => ({ id: `r${index}t${i}`, text })),
      hotMs: buaComHotMs(source, options),
    };
  });
}

// ---------------------------------------------------------------------------
// Partie

export function startBuaCom(rounds: BuaComRound[]): BuaComState {
  return { rounds, answers: [] };
}

export function currentBuaComRound(state: BuaComState): BuaComRound | null {
  return state.rounds[state.answers.length] ?? null;
}

export function isBuaComOver(state: BuaComState): boolean {
  return state.answers.length >= state.rounds.length;
}

/** Chaleur du plat (1 = fumant, 0 = froid) : simple décroissance linéaire. */
export function buaComWarmth(round: Pick<BuaComRound, "hotMs">, elapsedMs: number): number {
  if (round.hotMs <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - elapsedMs / round.hotMs));
}

export function buaComSentence(round: BuaComRound, tokenIds: readonly string[]): string {
  const byId = new Map(round.tokens.map((t) => [t.id, t.text]));
  return tokenIds.map((id) => byId.get(id) ?? "").filter(Boolean).join(" ");
}

/** Même comparaison que l'exercice build_sentence : une erreur de ton seule est « presque ». */
export function judgeBuaCom(round: BuaComRound, tokenIds: readonly string[]): BuaComVerdict {
  const match = compareAnswer(buaComSentence(round, tokenIds), [round.source.target]);
  return match.kind === "correct" ? "correct" : match.kind === "tone_only" ? "near" : "wrong";
}

/** Sert l'assiette de la manche courante (une seule réponse par manche ; le froid ne bloque rien). */
export function answerBuaCom(state: BuaComState, tokenIds: readonly string[], elapsedMs: number): BuaComState {
  const round = currentBuaComRound(state);
  if (!round) return state;
  const answer: BuaComAnswer = {
    round: round.index,
    tokenIds: [...tokenIds],
    sentence: buaComSentence(round, tokenIds),
    verdict: judgeBuaCom(round, tokenIds),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
  };
  return { ...state, answers: [...state.answers, answer] };
}

/** Points : 10 + jusqu'à 5 si le plat est encore chaud ; « presque » (ton seul) : 4. */
export function buaComPoints(answer: BuaComAnswer, round: BuaComRound | undefined): number {
  if (answer.verdict === "near") return 4;
  if (answer.verdict !== "correct") return 0;
  return 10 + Math.round(5 * (round ? buaComWarmth(round, answer.elapsedMs) : 0));
}

export function buaComResult(state: BuaComState): GameResult {
  return {
    correct: state.answers.filter((a) => a.verdict === "correct").length,
    total: state.answers.length,
    points: state.answers.reduce((sum, a) => sum + buaComPoints(a, state.rounds[a.round]), 0),
  };
}
