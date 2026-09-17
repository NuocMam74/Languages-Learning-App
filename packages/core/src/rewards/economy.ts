import type { ChestTier } from "./collection.ts";

/**
 * Les xu (contrat phase9 §2) : la seule monnaie, gagnée en apprenant, dépensée dans l'atelier.
 * Jamais achetable en euros, jamais perdue, jamais nécessaire pour continuer à apprendre — une
 * pièce d'atelier n'ouvre aucune leçon (spec §3 : zéro blocage).
 *
 * Les montants sont bornés : une séance très longue ne rapporte pas une fortune, et une séance
 * vide ne rapporte rien du tout.
 */

/** Plancher d'une séance terminée, avant l'XP. */
export const COINS_SESSION_BASE = 5;
/** Une séance sans faute vaut le détour. */
export const COINS_PERFECT_BONUS = 5;
/** Plafond d'une séance : au-delà, c'est du grind, pas de l'apprentissage. */
export const COINS_SESSION_MAX = 40;

/** Xu d'une séance terminée : le socle, l'XP au dixième, et le sans-faute. */
export function coinsForSession(input: { xp: number; perfect: boolean }): number {
  if (input.xp <= 0) return 0;
  const raw = COINS_SESSION_BASE + Math.floor(Math.max(0, input.xp) / 10) + (input.perfect ? COINS_PERFECT_BONUS : 0);
  return Math.min(COINS_SESSION_MAX, raw);
}

/** Plafond d'une partie de mini-jeu : les jeux nourrissent la collection, ils ne la remplacent pas. */
export const COINS_GAME_MAX = 20;

/** Xu d'une partie : 3 pour avoir joué, 8 de plus pour une partie réussie, un peu pour le score. */
export function coinsForGame(input: { correct: number; total: number; points: number; won: boolean }): number {
  if (input.total <= 0) return 0;
  return Math.min(COINS_GAME_MAX, 3 + (input.won ? 8 : 0) + Math.floor(Math.max(0, input.points) / 50));
}

/**
 * Monde du cursus terminé (contrat phase11 §3) : la plus grande boucle de progression de l'app, donc
 * la plus grosse récompense — des xu, un coffre de jade, et le paysage du monde pour l'atelier.
 */
export const WORLD_COMPLETION_COINS = 300;
export const WORLD_COMPLETION_CHEST: ChestTier = "jade";

export interface LevelReward {
  coins: number;
  chest: ChestTier | null;
}

/**
 * Récompense d'un niveau gagné : des xu qui suivent le niveau, un coffre tous les 5 niveaux et un
 * coffre de jade tous les 10. Monter de plusieurs niveaux d'un coup donne chaque palier.
 */
export function levelReward(level: number): LevelReward {
  const value = Math.max(1, Math.floor(level));
  return {
    coins: 20 + 5 * value,
    chest: value % 10 === 0 ? "jade" : value % 5 === 0 ? "lacquer" : null,
  };
}

/** Récompenses de tous les niveaux gagnés entre `before` (exclu) et `after` (inclus). */
export function levelRewards(before: number, after: number): { level: number; reward: LevelReward }[] {
  const out: { level: number; reward: LevelReward }[] = [];
  for (let level = Math.floor(before) + 1; level <= Math.floor(after); level++) out.push({ level, reward: levelReward(level) });
  return out;
}

/** Jalons de série qui donnent un coffre : le geste de revenir compte autant que le volume. */
export function streakChest(streakDays: number): ChestTier | null {
  if (streakDays <= 0) return null;
  if (streakDays % 30 === 0) return "jade";
  if (streakDays % 7 === 0) return "wood";
  return null;
}
