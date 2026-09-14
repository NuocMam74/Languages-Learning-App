import type { Tone } from "../types.ts";
import { median, rehop, type PitchReference, type Track } from "./contour.ts";
import { dtwContours, type DtwOptions } from "./dtw.ts";

/**
 * Score de prononciation tonale (karaoké tonal, SPEC §8.3).
 *
 * 1. Les deux courbes sont déjà en demi-tons relatifs à la médiane de leur locuteur.
 * 2. DTW (bande de Sakoe-Chiba 25 %, pas symétriques) sur les trames voisées, puis écart
 *    moyen d (demi-tons) compté des deux côtés du chemin (voir `pathDistance`).
 * 3. Recentrage : on retire le décalage médian (borné à ±1,5 st) observé le long du chemin,
 *    puis on refait la DTW. Corrige le biais de la médiane quand l'utilisateur tient une
 *    syllabe plus longtemps que la référence, sans masquer une forme de courbe fausse.
 * 4. Calibration linéaire : d ≤ 0,25 st → 100 ; d ≥ 2,2 st → 0 ; linéaire entre les deux
 *    (~51 points par demi-ton). Repères mesurés sur signaux synthétiques (score.test.ts),
 *    référence = ton descendant de 4,5 st :
 *      même courbe, autre voix/timbre/tempo/jitter/dérive/bruit : d ≈ 0,05–0,3 → 97–100
 *      chute deux fois trop faible (2 st)                         : d ≈ 0,45     → ~90
 *      ton plat                                                    : d ≈ 1,1      → ~55
 *      ton montant                                                 : d ≈ 2,2      → 0
 *    Critère Phase 2 (écart < 10 points entre deux prises) : tient tant que d varie de
 *    moins de 0,2 st d'une prise à l'autre. À recalibrer sur les premiers enregistrements réels
 *    (seuils exposés via `ScoreCalibration`).
 */

export type ToneIssue = "too_flat" | "not_low_enough" | "not_high_enough" | "no_dip" | "too_long";

export interface SyllableFeedback {
  index: number;
  tone: Tone;
  issue: ToneIssue | null;
  /** Écart moyen (st) sur les trames alignées de cette syllabe. */
  distance: number;
}

export interface PronunciationScore {
  /** 0–100. */
  score: number;
  /** Écart moyen en demi-tons après alignement (Infinity si rien de comparable). */
  distance: number;
  /** false si l'enregistrement utilisateur n'a pas assez de voisement pour être noté. */
  voiced: boolean;
  /** Chemin d'alignement [indice utilisateur, indice référence] (pour superposer les courbes). */
  path: [number, number][];
  /** Décalage (st) retiré à la courbe utilisateur avant l'alignement final. */
  offset: number;
  perSyllable?: SyllableFeedback[];
}

export interface ScoreCalibration {
  /** Écart moyen (st) en dessous duquel le score vaut 100. */
  perfectSt: number;
  /** Écart moyen (st) au-delà duquel le score vaut 0. */
  zeroSt: number;
}

export const SCORE_CALIBRATION: ScoreCalibration = { perfectSt: 0.25, zeroSt: 2.2 };

export interface ScoreOptions extends DtwOptions {
  calibration?: ScoreCalibration;
  /** Nombre minimal de trames voisées côté utilisateur (défaut 8 = 80 ms). */
  minVoicedFrames?: number;
  /** Marge (st) avant de signaler un défaut de hauteur (défaut 1,5). */
  issueMarginSt?: number;
}

export function distanceToScore(distance: number, calibration: ScoreCalibration = SCORE_CALIBRATION): number {
  if (!Number.isFinite(distance)) return 0;
  const { perfectSt, zeroSt } = calibration;
  const x = (distance - perfectSt) / (zeroSt - perfectSt);
  return Math.round(100 * Math.max(0, Math.min(1, 1 - x)));
}

/**
 * Écart moyen le long d'un chemin d'alignement, compté des deux côtés :
 *  - côté référence : pour chaque trame de référence, écart moyen à ses trames utilisateur alignées ;
 *  - côté utilisateur : idem pour chaque trame utilisateur.
 * On garde le maximum. Une moyenne sur le chemin seul se laisse « tricher » : la DTW peut
 * aligner toute une courbe plate sur le seul point où la référence croise zéro.
 */
export function pathDistance(user: readonly (number | null)[], ref: readonly (number | null)[], path: readonly [number, number][]): number {
  const side = (key: 0 | 1) => {
    const sums = new Map<number, { s: number; n: number }>();
    for (const p of path) {
      const e = Math.abs(user[p[0]]! - ref[p[1]]!);
      const acc = sums.get(p[key]) ?? { s: 0, n: 0 };
      acc.s += e;
      acc.n++;
      sums.set(p[key], acc);
    }
    let total = 0;
    for (const { s, n } of sums.values()) total += s / n;
    return total / Math.max(1, sums.size);
  };
  return Math.max(side(0), side(1));
}

type UserInput = Track | { st: Track; hopMs?: number };

export function scorePronunciation(user: UserInput, reference: PitchReference, options: ScoreOptions = {}): PronunciationScore {
  const calibration = options.calibration ?? SCORE_CALIBRATION;
  let st: Track = Array.isArray(user) ? user : user.st;
  const hop = Array.isArray(user) ? reference.hopMs : (user.hopMs ?? reference.hopMs);
  if (hop !== reference.hopMs) st = rehop(st, hop, reference.hopMs);

  const voicedCount = st.reduce<number>((n, v) => (v === null ? n : n + 1), 0);
  if (voicedCount < (options.minVoicedFrames ?? 8)) {
    return { score: 0, distance: Number.POSITIVE_INFINITY, voiced: false, path: [], offset: 0 };
  }

  const align = (track: Track) => {
    const r = dtwContours(track, reference.st, options);
    return { path: r.path, distance: r.path.length ? pathDistance(track, reference.st, r.path) : Number.POSITIVE_INFINITY };
  };
  let result = align(st);
  let offset = 0;
  if (result.path.length) {
    const candidate = Math.max(-1.5, Math.min(1.5, median(result.path.map(([i, j]) => st[i]! - reference.st[j]!))));
    if (Math.abs(candidate) > 0.05) {
      const shifted = st.map((v) => (v === null ? null : v - candidate));
      const second = align(shifted);
      if (second.distance <= result.distance) {
        st = shifted;
        result = second;
        offset = candidate;
      }
    }
  }

  const out: PronunciationScore = {
    score: distanceToScore(result.distance, calibration),
    distance: result.distance,
    voiced: true,
    path: result.path,
    offset,
  };
  if (reference.syllables?.length) out.perSyllable = syllableFeedback(st, reference, result.path, options.issueMarginSt ?? 1.5);
  return out;
}

/* ------------------------------------------------------------------ */
/* Diagnostics par syllabe                                             */
/* ------------------------------------------------------------------ */

interface Shape {
  lo: number;
  hi: number;
  mean: number;
  startV: number;
  endV: number;
  /** endV − startV : négatif = descendant. */
  change: number;
  /** Profondeur du creux central sous le plus bas des deux bords (≥ 0 si creux). */
  dip: number;
  /** Étendue temporelle en trames. */
  span: number;
}

function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx]!;
}

function shapeOf(values: readonly number[], span: number): Shape {
  const sorted = [...values].sort((a, b) => a - b);
  const edge = Math.max(1, Math.round(values.length * 0.2));
  const avg = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const startV = avg(values.slice(0, edge));
  const endV = avg(values.slice(-edge));
  const middle = values.slice(Math.floor(values.length * 0.2), Math.ceil(values.length * 0.8));
  const midMin = middle.length ? Math.min(...middle) : Math.min(startV, endV);
  return {
    lo: percentile(sorted, 0.1),
    hi: percentile(sorted, 0.9),
    mean: avg(values),
    startV,
    endV,
    change: endV - startV,
    dip: Math.min(startV, endV) - midMin,
    span,
  };
}

/**
 * Règles par classe de ton (contours du Sud) :
 *  - ngang (plat, médium)            : trop bas → not_high_enough
 *  - huyền (bas, descendant)         : minimum trop haut → not_low_enough ; chute < 40 % → too_flat
 *  - sắc (montant)                   : maximum trop bas → not_high_enough ; montée < 40 % → too_flat
 *  - hỏi / ngã (fusionnés : creux-remontée) : creux absent → no_dip ; minimum trop haut → not_low_enough
 *  - nặng (bas, bref, descendant/glottal)   : > 1,6× la durée → too_long ; minimum trop haut → not_low_enough
 *  - toutes : > 2× la durée de référence (+ 50 ms) → too_long
 */
export function diagnoseTone(tone: Tone, user: Shape, ref: Shape, margin: number): ToneIssue | null {
  switch (tone) {
    case "huyen":
      if (user.lo > ref.lo + margin) return "not_low_enough";
      if (ref.change < -1 && user.change > ref.change * 0.4) return "too_flat";
      break;
    case "sac":
      if (user.hi < ref.hi - margin) return "not_high_enough";
      if (ref.change > 1 && user.change < ref.change * 0.4) return "too_flat";
      break;
    case "hoi":
    case "nga":
      if (ref.dip > 0.8 && user.dip < Math.max(0.3, ref.dip * 0.35)) return "no_dip";
      if (user.lo > ref.lo + margin) return "not_low_enough";
      break;
    case "nang":
      if (user.span > ref.span * 1.6 + 3) return "too_long";
      if (user.lo > ref.lo + margin) return "not_low_enough";
      break;
    case "ngang":
      if (user.mean < ref.mean - margin) return "not_high_enough";
      break;
  }
  if (user.span > ref.span * 2 + 5) return "too_long";
  return null;
}

function syllableFeedback(user: Track, reference: PitchReference, path: readonly [number, number][], margin: number): SyllableFeedback[] {
  return (reference.syllables ?? []).map((syl, index) => {
    const from = Math.floor(syl.start / reference.hopMs);
    const to = Math.ceil(syl.end / reference.hopMs);
    const pairs = path.filter(([, j]) => j >= from && j < to);
    const userIdx = [...new Set(pairs.map(([i]) => i))].sort((a, b) => a - b);
    const refIdx = [...new Set(pairs.map(([, j]) => j))].sort((a, b) => a - b);
    const distance = pairs.length ? pairs.reduce((s, [i, j]) => s + Math.abs(user[i]! - reference.st[j]!), 0) / pairs.length : Number.POSITIVE_INFINITY;
    if (userIdx.length < 2 || refIdx.length < 2) return { index, tone: syl.tone, issue: null, distance };
    const u = shapeOf(userIdx.map((i) => user[i]!), userIdx.at(-1)! - userIdx[0]! + 1);
    const r = shapeOf(refIdx.map((j) => reference.st[j]!), refIdx.at(-1)! - refIdx[0]! + 1);
    return { index, tone: syl.tone, issue: diagnoseTone(syl.tone, u, r, margin), distance };
  });
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

const TONE_LABEL: Record<"fr" | "en", Record<Tone, string>> = {
  fr: { ngang: "ton plat", huyen: "ton descendant", sac: "ton montant", hoi: "ton plongeant", nga: "ton plongeant", nang: "ton lourd" },
  en: { ngang: "level tone", huyen: "falling tone", sac: "rising tone", hoi: "dipping tone", nga: "dipping tone", nang: "heavy tone" },
};

const ISSUE_LABEL: Record<"fr" | "en", Record<ToneIssue, string>> = {
  fr: { too_flat: "trop plat", not_low_enough: "pas assez bas", not_high_enough: "pas assez haut", no_dip: "sans creux", too_long: "trop long" },
  en: { too_flat: "too flat", not_low_enough: "not low enough", not_high_enough: "not high enough", no_dip: "missing the dip", too_long: "too long" },
};

/** Indication ciblée, ex. « Ton descendant pas assez bas sur « mà » ». */
export function toneHint(issue: ToneIssue, tone: Tone, syllable: string, locale: string = "fr"): string {
  const l = locale === "en" ? "en" : "fr";
  const text = `${TONE_LABEL[l][tone]} ${ISSUE_LABEL[l][issue]}`;
  const where = l === "fr" ? ` sur « ${syllable} »` : ` on “${syllable}”`;
  return text.charAt(0).toUpperCase() + text.slice(1) + where;
}
