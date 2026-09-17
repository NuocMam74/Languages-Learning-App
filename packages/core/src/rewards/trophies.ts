import type { Counters, Metric } from "./counters.ts";

/**
 * Trophées (contrat phase9 §2) : des **paliers de volume**, à côté des badges qui restent des
 * jalons nommés (spec §5.4). Huit familles, trois paliers — cuivre, argent, or.
 *
 * Un trophée gagné ne se perd jamais, et son évaluation ne dépend que des compteurs cumulés :
 * la même entrée donne toujours la même sortie (aucune horloge, aucun hasard).
 */

export const TROPHY_FAMILIES = ["sessions", "xp", "games", "perfect", "missions", "words", "streak", "tones"] as const;
export type TrophyFamily = (typeof TROPHY_FAMILIES)[number];

export const TROPHY_TIERS = [1, 2, 3] as const;
export type TrophyTier = (typeof TROPHY_TIERS)[number];

/** Xu versés par palier (contrat §2 : la pièce ne s'achète jamais avec de l'argent réel). */
export const TROPHY_COINS: Record<TrophyTier, number> = { 1: 25, 2: 60, 3: 150 };

/**
 * Source de chaque famille. `streak` ne vient pas des compteurs (la série a son propre module) et
 * `words` compte les mots connus du SRS : les deux arrivent par `TrophyInput`.
 */
type TrophySource = { from: "counter"; metric: Metric } | { from: "streak" } | { from: "words" };

interface TrophyFamilyDef {
  source: TrophySource;
  /** Seuils des trois paliers, croissants. */
  targets: readonly [number, number, number];
}

const FAMILIES: Record<TrophyFamily, TrophyFamilyDef> = {
  sessions: { source: { from: "counter", metric: "sessions" }, targets: [10, 50, 200] },
  xp: { source: { from: "counter", metric: "xp" }, targets: [1_000, 10_000, 50_000] },
  games: { source: { from: "counter", metric: "gameWins" }, targets: [5, 30, 120] },
  perfect: { source: { from: "counter", metric: "perfectLessons" }, targets: [3, 15, 60] },
  missions: { source: { from: "counter", metric: "missions" }, targets: [5, 30, 120] },
  words: { source: { from: "words" }, targets: [100, 300, 1_000] },
  streak: { source: { from: "streak" }, targets: [14, 60, 180] },
  tones: { source: { from: "counter", metric: "toneItems" }, targets: [100, 500, 2_000] },
};

export interface Trophy {
  /** `sessions_t2`, `words_t3`… */
  code: string;
  family: TrophyFamily;
  tier: TrophyTier;
  target: number;
  coins: number;
}

export const trophyCode = (family: TrophyFamily, tier: TrophyTier) => `${family}_t${tier}`;

/** Tous les trophées, dans un ordre stable (famille, puis palier). */
export const TROPHIES: readonly Trophy[] = TROPHY_FAMILIES.flatMap((family) =>
  // Le tuple de seuils est parcouru dans l'ordre : le palier est sa position, pas un index calculé.
  FAMILIES[family].targets.map((target, index) => {
    const tier = TROPHY_TIERS[index] ?? 3;
    return { code: trophyCode(family, tier), family, tier, target, coins: TROPHY_COINS[tier] };
  }),
);

const BY_CODE = new Map(TROPHIES.map((trophy) => [trophy.code, trophy]));
export const trophyByCode = (code: string): Trophy | null => BY_CODE.get(code) ?? null;

export interface TrophyInput {
  totals: Counters;
  /** Meilleure série atteinte (jamais la série courante seule : un trophée ne se reperd pas). */
  bestStreak: number;
  /** Mots connus (cartes SRS au-delà de `new`). */
  knownWords: number;
}

/** Valeur courante de la famille : ce que la barre de progression affiche. */
export function trophyValue(family: TrophyFamily, input: TrophyInput): number {
  const source = FAMILIES[family].source;
  if (source.from === "streak") return input.bestStreak;
  if (source.from === "words") return input.knownWords;
  return input.totals[source.metric] ?? 0;
}

/** Trophées nouvellement gagnés, dans l'ordre de `TROPHIES` (paliers inférieurs d'abord). */
export function evaluateTrophies(input: TrophyInput, earned: ReadonlySet<string>): Trophy[] {
  return TROPHIES.filter((trophy) => !earned.has(trophy.code) && trophyValue(trophy.family, input) >= trophy.target);
}

/** Palier le plus haut atteint dans une famille (0 = aucun) : ce que le médaillon montre. */
export function trophyTierOf(family: TrophyFamily, earned: ReadonlySet<string>): 0 | TrophyTier {
  let best: 0 | TrophyTier = 0;
  for (const tier of TROPHY_TIERS) if (earned.has(trophyCode(family, tier))) best = tier;
  return best;
}

/** Prochain palier d'une famille, ou null si l'or est déjà là. */
export function nextTrophy(family: TrophyFamily, earned: ReadonlySet<string>): Trophy | null {
  return TROPHIES.find((trophy) => trophy.family === family && !earned.has(trophy.code)) ?? null;
}
