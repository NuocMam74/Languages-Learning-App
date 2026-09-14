/**
 * DTW (déformation temporelle dynamique) avec bande de Sakoe-Chiba, sur des courbes en demi-tons.
 *
 * Coût local : |a_i − b_j| (demi-tons, robuste aux valeurs aberrantes).
 * Pas autorisés : (i−1, j) et (i, j−1) de poids 1, (i−1, j−1) de poids 2 (« symmetric2 »).
 * La bande suit la diagonale « étirée » j ≈ i·(m−1)/(n−1), de demi-largeur
 * max(band × max(n, m), ⌈rapport des longueurs⌉) pour qu'un chemin existe toujours.
 */

export interface DtwOptions {
  /** Demi-largeur de bande en fraction de la plus longue séquence (défaut 0,25). */
  band?: number;
  /** Demi-largeur de bande en trames (prioritaire sur `band`). */
  bandFrames?: number;
}

export interface DtwResult {
  /** Somme pondérée des coûts sur le chemin optimal. */
  distance: number;
  /** distance / (n + m) : écart moyen en demi-tons. */
  normalizedDistance: number;
  /** Couples (i, j) du début à la fin. */
  path: [number, number][];
}

export const DEFAULT_DTW_BAND = 0.25;

export function dtw(a: ArrayLike<number>, b: ArrayLike<number>, options: DtwOptions = {}): DtwResult {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return { distance: Number.POSITIVE_INFINITY, normalizedDistance: Number.POSITIVE_INFINITY, path: [] };

  const ratio = Math.ceil(Math.max(n, m) / Math.min(n, m));
  const w = Math.max(1, ratio, options.bandFrames ?? Math.ceil((options.band ?? DEFAULT_DTW_BAND) * Math.max(n, m)));
  const slope = n > 1 ? (m - 1) / (n - 1) : 0;
  const lo = new Int32Array(n);
  const hi = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = n > 1 ? i * slope : m - 1;
    lo[i] = Math.max(0, Math.ceil(c - w));
    hi[i] = Math.min(m - 1, Math.floor(c + w));
  }
  if (n === 1) lo[0] = 0;

  const INF = Number.POSITIVE_INFINITY;
  const D = new Float64Array(n * m).fill(INF);
  const cost = (i: number, j: number) => Math.abs(a[i]! - b[j]!);
  for (let i = 0; i < n; i++) {
    for (let j = lo[i]!; j <= hi[i]!; j++) {
      const c = cost(i, j);
      if (i === 0 && j === 0) {
        D[0] = 2 * c;
        continue;
      }
      const up = i > 0 ? D[(i - 1) * m + j]! + c : INF;
      const left = j > 0 ? D[i * m + j - 1]! + c : INF;
      const diag = i > 0 && j > 0 ? D[(i - 1) * m + j - 1]! + 2 * c : INF;
      D[i * m + j] = Math.min(up, left, diag);
    }
  }

  const total = D[n * m - 1]!;
  if (!Number.isFinite(total)) return { distance: INF, normalizedDistance: INF, path: [] };

  const path: [number, number][] = [];
  let i = n - 1;
  let j = m - 1;
  path.push([i, j]);
  while (i > 0 || j > 0) {
    const c = cost(i, j);
    const diag = i > 0 && j > 0 ? D[(i - 1) * m + j - 1]! + 2 * c : INF;
    const up = i > 0 ? D[(i - 1) * m + j]! + c : INF;
    const left = j > 0 ? D[i * m + j - 1]! + c : INF;
    if (diag <= up && diag <= left) {
      i--;
      j--;
    } else if (up <= left) i--;
    else j--;
    path.push([i, j]);
  }
  path.reverse();
  // Pondération symétrique (pas diagonal ×2) normalisée par n + m : allonger le chemin
  // ne fait pas baisser l'écart moyen (sinon la DTW « dilue » les erreurs).
  return { distance: total, normalizedDistance: total / (n + m), path };
}

export interface ContourDtwResult extends DtwResult {
  /** Indices (dans les courbes d'origine) des trames voisées utilisées. */
  aIndex: number[];
  bIndex: number[];
}

/**
 * DTW entre deux courbes contenant des trames non voisées (null), ignorées.
 * Le chemin retourné est exprimé en indices des courbes d'origine.
 */
export function dtwContours(a: readonly (number | null)[], b: readonly (number | null)[], options: DtwOptions = {}): ContourDtwResult {
  const aIndex: number[] = [];
  const bIndex: number[] = [];
  const av: number[] = [];
  const bv: number[] = [];
  a.forEach((v, i) => {
    if (v !== null && Number.isFinite(v)) {
      aIndex.push(i);
      av.push(v);
    }
  });
  b.forEach((v, i) => {
    if (v !== null && Number.isFinite(v)) {
      bIndex.push(i);
      bv.push(v);
    }
  });
  const r = dtw(av, bv, options);
  return { ...r, path: r.path.map(([i, j]) => [aIndex[i]!, bIndex[j]!]), aIndex, bIndex };
}
