/** Types partagés par les mini-jeux : résultat pour le moteur et meilleur score (onglet Jeux). */

export interface GameResult {
  /** Réussites notées (→ {kind: "game", correct, total} pour le moteur). */
  correct: number;
  total: number;
  points: number;
}

export interface GameBest {
  points: number;
  correct: number;
  total: number;
}

/** Meilleur score : le plus de points, à égalité le meilleur ratio. Renvoie `previous` (même référence) s'il reste meilleur. */
export function betterGameBest(previous: GameBest | null, result: GameResult): GameBest {
  const next = { points: result.points, correct: result.correct, total: result.total };
  if (!previous) return next;
  if (result.points !== previous.points) return result.points > previous.points ? next : previous;
  const ratio = (r: { correct: number; total: number }) => (r.total ? r.correct / r.total : 0);
  return ratio(next) > ratio(previous) ? next : previous;
}
