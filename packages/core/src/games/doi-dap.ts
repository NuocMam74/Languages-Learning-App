import type { GameResult } from "./common.ts";

/**
 * Đối đáp (la répartie, spec §5.6.5) : conversation chronométrée avec Cô Mai,
 * 6 tours, 20 s par réponse. Le score de fluidité fait foi côté serveur
 * (`POST /tutor/conversations/{id}/end`, contrat phase 3 §1) ; ces aides pures
 * servent au chrono doux et à une estimation locale d'affichage.
 */

export const DOI_DAP_DEFAULTS = {
  turns: 6,
  answerMs: 20_000,
} as const;

export interface TurnTimer {
  elapsedMs: number;
  remainingMs: number;
  /** Part du temps restant, 1 → 0. */
  ratio: number;
  expired: boolean;
  /** Secondes affichées (arrondi supérieur : « 1 s » jusqu'au bout). */
  seconds: number;
}

/** État du chrono d'un tour. `startedAt` et `now` en millisecondes. */
export function turnTimer(startedAt: number, now: number, limitMs: number = DOI_DAP_DEFAULTS.answerMs): TurnTimer {
  const elapsedMs = Math.max(0, now - startedAt);
  const remainingMs = Math.max(0, limitMs - elapsedMs);
  return {
    elapsedMs,
    remainingMs,
    ratio: limitMs > 0 ? remainingMs / limitMs : 0,
    expired: remainingMs === 0,
    seconds: Math.ceil(remainingMs / 1000),
  };
}

/** Nombre de mots d'un message (séparés par des espaces ; la ponctuation seule ne compte pas). */
export function countWords(text: string): number {
  return text
    .normalize("NFC")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export interface DoiDapTurn {
  responseMs: number;
  /** Le message a reçu une correction douce. */
  corrected: boolean;
}

/**
 * Estimation locale de la fluidité (0..100), affichée en attendant le serveur
 * ou s'il ne répond pas : 50 % tours répondus, 30 % rapidité, 20 % justesse.
 */
export function estimateDoiDapFluency(
  turns: readonly DoiDapTurn[],
  { totalTurns = DOI_DAP_DEFAULTS.turns, answerMs = DOI_DAP_DEFAULTS.answerMs }: { totalTurns?: number; answerMs?: number } = {},
): number {
  if (totalTurns <= 0 || turns.length === 0) return 0;
  const answered = turns.slice(0, totalTurns);
  const participation = answered.length / totalTurns;
  const speed = answered.reduce((sum, turn) => sum + Math.max(0, 1 - Math.max(0, turn.responseMs) / answerMs), 0) / answered.length;
  const accuracy = answered.filter((turn) => !turn.corrected).length / answered.length;
  // La rapidité et la justesse ne valent que pour les tours joués.
  const score = 100 * (0.5 * participation + participation * (0.3 * speed + 0.2 * accuracy));
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Résultat pour le moteur de séance et le record : la fluidité (0..100) devient
 * `correct` sur `total` tours (GAME_PASS_RATIO s'applique à ce ratio).
 */
export function doiDapResult(fluency: number, totalTurns: number = DOI_DAP_DEFAULTS.turns): GameResult {
  const points = Math.max(0, Math.min(100, Math.round(Number.isFinite(fluency) ? fluency : 0)));
  return { correct: Math.round((points / 100) * totalTurns), total: totalTurns, points };
}
