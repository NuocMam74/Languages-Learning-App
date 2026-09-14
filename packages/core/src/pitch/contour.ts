import type { Tone } from "../types.ts";
import { DEFAULT_HOP_MS, analyzePitch, downsampleForPitch, type AnalyzeOptions, type PitchFrame } from "./yin.ts";

/**
 * Nettoyage d'une piste de F0 et conversion en courbe normalisée par locuteur.
 *
 * Chaîne (`cleanPitchTrack`) :
 *   1. voisement : f0 ≠ null, confiance ≥ minConfidence, RMS ≥ max(minRms, RMS max × 10^(silenceDb/20))
 *   2. suppression des îlots voisés trop courts (< minVoicedFrames)
 *   3. correction des sauts d'octave (repli ×2 / ÷2 vers la médiane locale puis globale)
 *   4. comblement des micro-trous (≤ maxGapFrames, interpolation log)
 *   5. lissage médian (5 trames) à l'intérieur de chaque îlot
 * puis `toSemitones` : demi-tons relatifs à la médiane du locuteur → un homme et une
 * femme qui font la même mélodie obtiennent la même courbe.
 */

export type Track = (number | null)[];

export interface ContourOptions {
  minConfidence?: number;
  silenceDb?: number;
  minRms?: number;
  minVoicedFrames?: number;
  maxGapFrames?: number;
  medianWindow?: number;
  octaveRadius?: number;
}

export const CONTOUR_DEFAULTS: Required<ContourOptions> = {
  minConfidence: 0.7,
  silenceDb: -30,
  minRms: 0.003,
  minVoicedFrames: 5,
  maxGapFrames: 2,
  medianWindow: 5,
  octaveRadius: 15,
};

export interface Contour {
  hopMs: number;
  /** Demi-tons relatifs à la médiane du locuteur ; null = non voisé. */
  st: Track;
  /** Médiane de F0 des trames voisées (Hz), null si rien de voisé. */
  medianHz: number | null;
  /** Part des trames voisées, dans [0, 1]. */
  voicedRatio: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function voicedValues(track: readonly (number | null)[]): number[] {
  return track.filter((v): v is number => v !== null);
}

export function medianHz(track: readonly (number | null)[]): number | null {
  const v = voicedValues(track);
  return v.length ? median(v) : null;
}

/** 1. Porte de voisement : confiance YIN + énergie. */
export function voicingGate(frames: readonly PitchFrame[], options: ContourOptions = {}): Track {
  const o = { ...CONTOUR_DEFAULTS, ...options };
  const maxRms = frames.reduce((m, f) => Math.max(m, f.rms), 0);
  const gate = Math.max(o.minRms, maxRms * 10 ** (o.silenceDb / 20));
  return frames.map((f) => (f.f0 !== null && f.confidence >= o.minConfidence && f.rms >= gate ? f.f0 : null));
}

/** Îlots voisés contigus, `end` exclu. */
export function voicedIslands(track: readonly (number | null)[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = -1;
  track.forEach((v, i) => {
    if (v !== null && start < 0) start = i;
    if (v === null && start >= 0) {
      out.push({ start, end: i });
      start = -1;
    }
  });
  if (start >= 0) out.push({ start, end: track.length });
  return out;
}

/** 2. Retire les îlots voisés plus courts que `minFrames`. */
export function removeShortIslands(track: readonly (number | null)[], minFrames: number): Track {
  const out = [...track];
  for (const { start, end } of voicedIslands(track)) if (end - start < minFrames) out.fill(null, start, end);
  return out;
}

/** 3. Corrige les erreurs d'octave (valeurs en Hz) par repli vers la médiane locale puis globale. */
export function correctOctaveJumps(track: readonly (number | null)[], radius = CONTOUR_DEFAULTS.octaveRadius): Track {
  const out = [...track];
  const fold = (value: number, ref: number, limit: number) => {
    let v = value;
    for (let k = 0; k < 2; k++) {
      const d = 12 * Math.log2(v / ref);
      if (d > limit && Math.abs(d - 12) < Math.abs(d)) v /= 2;
      else if (d < -limit && Math.abs(d + 12) < Math.abs(d)) v *= 2;
      else break;
    }
    return v;
  };
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v == null) continue;
    const neighbours: number[] = [];
    for (let j = Math.max(0, i - radius); j <= Math.min(out.length - 1, i + radius); j++) {
      const n = track[j];
      if (j !== i && n != null) neighbours.push(n);
    }
    if (neighbours.length >= 3) out[i] = fold(v, median(neighbours), 8);
  }
  const global = medianHz(out);
  if (global !== null) for (let i = 0; i < out.length; i++) if (out[i] != null) out[i] = fold(out[i]!, global, 10);
  return out;
}

/** 4. Comble les trous non voisés d'au plus `maxGap` trames entre deux trames voisées (interpolation en log). */
export function bridgeGaps(track: readonly (number | null)[], maxGap: number): Track {
  const out = [...track];
  const islands = voicedIslands(track);
  for (let k = 1; k < islands.length; k++) {
    const a = islands[k - 1]!;
    const b = islands[k]!;
    const gap = b.start - a.end;
    if (gap < 1 || gap > maxGap) continue;
    const la = Math.log(track[a.end - 1]!);
    const lb = Math.log(track[b.start]!);
    for (let g = 1; g <= gap; g++) out[a.end - 1 + g] = Math.exp(la + ((lb - la) * g) / (gap + 1));
  }
  return out;
}

/** 5. Filtre médian (fenêtre impaire) appliqué à l'intérieur de chaque îlot voisé. */
export function medianSmooth(track: readonly (number | null)[], window = CONTOUR_DEFAULTS.medianWindow): Track {
  const half = Math.max(0, Math.floor(window / 2));
  const out = [...track];
  for (const { start, end } of voicedIslands(track)) {
    for (let i = start; i < end; i++) {
      const lo = Math.max(start, i - half);
      const hi = Math.min(end, i + half + 1);
      out[i] = median(track.slice(lo, hi) as number[]);
    }
  }
  return out;
}

/** Chaîne complète de nettoyage : trames YIN → F0 (Hz) propre. */
export function cleanPitchTrack(frames: readonly PitchFrame[], options: ContourOptions = {}): Track {
  const o = { ...CONTOUR_DEFAULTS, ...options };
  let t = voicingGate(frames, o);
  t = removeShortIslands(t, o.minVoicedFrames);
  t = correctOctaveJumps(t, o.octaveRadius);
  t = bridgeGaps(t, o.maxGapFrames);
  t = medianSmooth(t, o.medianWindow);
  return removeShortIslands(t, o.minVoicedFrames);
}

/** Hz → demi-tons relatifs à `refHz` (par défaut la médiane des trames voisées). */
export function toSemitones(track: readonly (number | null)[], refHz?: number): Track {
  const ref = refHz ?? medianHz(track);
  if (ref === null || !(ref > 0)) return track.map(() => null);
  return track.map((v) => (v === null ? null : 12 * Math.log2(v / ref)));
}

export function contourFromFrames(frames: readonly PitchFrame[], hopMs = DEFAULT_HOP_MS, options: ContourOptions = {}): Contour {
  const hz = cleanPitchTrack(frames, options);
  const med = medianHz(hz);
  const voiced = voicedValues(hz).length;
  return { hopMs, st: toSemitones(hz), medianHz: med, voicedRatio: hz.length ? voiced / hz.length : 0 };
}

export type ExtractOptions = AnalyzeOptions & ContourOptions & { targetRate?: number };

/** Signal PCM mono → courbe normalisée (décimation ~16 kHz, YIN 40 ms / 10 ms, nettoyage, demi-tons). */
export function extractContour(signal: Float32Array, sampleRate: number, options: ExtractOptions = {}): Contour {
  const ds = downsampleForPitch(signal, sampleRate, options.targetRate);
  const frames = analyzePitch(ds.signal, ds.sampleRate, options);
  return contourFromFrames(frames, options.hopMs ?? DEFAULT_HOP_MS, options);
}

/* ------------------------------------------------------------------ */
/* Normalisation temporelle                                            */
/* ------------------------------------------------------------------ */

/** Retire les trames non voisées en tête et en queue. */
export function trimUnvoiced(track: readonly (number | null)[]): { offset: number; track: Track } {
  let a = 0;
  let b = track.length;
  while (a < b && track[a] === null) a++;
  while (b > a && track[b - 1] === null) b--;
  return { offset: a, track: track.slice(a, b) };
}

/**
 * Rééchantillonne une courbe sur `length` points (interpolation linéaire entre
 * trames voisées ; un point tombant entre une trame voisée et une non voisée prend la plus proche).
 */
export function resampleContour(track: readonly (number | null)[], length: number): Track {
  if (length <= 0 || track.length === 0) return [];
  if (track.length === 1) return Array.from({ length }, () => track[0] ?? null);
  const out: Track = [];
  for (let k = 0; k < length; k++) {
    const x = length === 1 ? 0 : (k * (track.length - 1)) / (length - 1);
    const i = Math.floor(x);
    const f = x - i;
    const a = track[i] ?? null;
    const b = track[Math.min(i + 1, track.length - 1)] ?? null;
    if (a !== null && b !== null) out.push(a + (b - a) * f);
    else out.push(f < 0.5 ? a : b);
  }
  return out;
}

/** Change le pas temporel d'une courbe (ex. 10 ms → 20 ms). */
export function rehop(track: readonly (number | null)[], fromHopMs: number, toHopMs: number): Track {
  if (fromHopMs === toHopMs) return [...track];
  return resampleContour(track, Math.max(1, Math.round((track.length * fromHopMs) / toHopMs)));
}

/* ------------------------------------------------------------------ */
/* Format de référence                                                 */
/* ------------------------------------------------------------------ */

export interface PitchSyllable {
  /** Début en ms depuis la première trame de `st`. */
  start: number;
  /** Fin (exclue) en ms. */
  end: number;
  tone: Tone;
}

/** Courbe de référence stockée dans `content/<pack>/pitch/<id>.json`. */
export interface PitchReference {
  v: 1;
  hopMs: number;
  /** Demi-tons relatifs à la médiane du locuteur, arrondis à 0,1 ; null = non voisé. */
  st: Track;
  syllables?: PitchSyllable[];
}

const TONES: readonly Tone[] = ["ngang", "huyen", "sac", "hoi", "nga", "nang"];

export class PitchReferenceError extends Error {
  override name = "PitchReferenceError";
}

const round1 = (x: number) => Math.round(x * 10) / 10 || 0;

/**
 * Découpe une courbe en syllabes à partir des îlots voisés. Si l'on trouve plus
 * d'îlots que de syllabes, les îlots séparés par les plus petits silences sont fusionnés ;
 * s'il y en a moins, la segmentation est impossible → undefined.
 */
export function segmentSyllables(track: readonly (number | null)[], tones: readonly Tone[], hopMs: number): PitchSyllable[] | undefined {
  if (tones.length === 0) return undefined;
  const islands = voicedIslands(track);
  if (islands.length < tones.length) return undefined;
  while (islands.length > tones.length) {
    let best = 1;
    for (let k = 2; k < islands.length; k++) {
      if (islands[k]!.start - islands[k - 1]!.end < islands[best]!.start - islands[best - 1]!.end) best = k;
    }
    islands[best - 1] = { start: islands[best - 1]!.start, end: islands[best]!.end };
    islands.splice(best, 1);
  }
  return islands.map((isl, i) => ({ start: isl.start * hopMs, end: isl.end * hopMs, tone: tones[i]! }));
}

/** Construit une référence compacte : non-voisé de tête/queue retiré, valeurs arrondies à 0,1 st. */
export function toPitchReference(contour: Pick<Contour, "hopMs" | "st">, tones?: readonly Tone[]): PitchReference {
  const { track } = trimUnvoiced(contour.st);
  if (track.length === 0) throw new PitchReferenceError("courbe entièrement non voisée");
  const st = track.map((v) => (v === null ? null : round1(v)));
  const ref: PitchReference = { v: 1, hopMs: contour.hopMs, st };
  const syllables = tones ? segmentSyllables(st, tones, contour.hopMs) : undefined;
  if (syllables) ref.syllables = syllables;
  return ref;
}

export function serializePitchReference(ref: PitchReference): string {
  const clean: PitchReference = { v: 1, hopMs: ref.hopMs, st: ref.st.map((v) => (v === null ? null : round1(v))) };
  if (ref.syllables) clean.syllables = ref.syllables.map((s) => ({ start: s.start, end: s.end, tone: s.tone }));
  return JSON.stringify(parsePitchReference(clean));
}

/** Parseur strict : rejette toute clé inconnue, toute valeur hors bornes, toute incohérence. */
export function parsePitchReference(input: unknown): PitchReference {
  const fail = (msg: string): never => {
    throw new PitchReferenceError(`référence de hauteur invalide : ${msg}`);
  };
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      fail("JSON illisible");
    }
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return fail("objet attendu");
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!["v", "hopMs", "st", "syllables"].includes(key)) fail(`clé inconnue « ${key} »`);
  if (obj.v !== 1) fail("v doit valoir 1");
  const hopMs = obj.hopMs;
  if (typeof hopMs !== "number" || !Number.isFinite(hopMs) || hopMs <= 0 || hopMs > 100) return fail("hopMs hors bornes");
  if (!Array.isArray(obj.st) || obj.st.length === 0 || obj.st.length > 100_000) return fail("st doit être un tableau non vide");
  const st: Track = obj.st.map((v, i) => {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 48) return fail(`st[${i}] invalide`);
    return v;
  });
  if (!st.some((v) => v !== null)) fail("aucune trame voisée");
  const ref: PitchReference = { v: 1, hopMs, st };
  if (obj.syllables !== undefined) {
    if (!Array.isArray(obj.syllables)) return fail("syllables doit être un tableau");
    const total = st.length * hopMs;
    let prevEnd = 0;
    ref.syllables = obj.syllables.map((s, i) => {
      if (typeof s !== "object" || s === null || Array.isArray(s)) return fail(`syllables[${i}] : objet attendu`);
      const r = s as Record<string, unknown>;
      for (const key of Object.keys(r)) if (!["start", "end", "tone"].includes(key)) fail(`syllables[${i}] : clé inconnue « ${key} »`);
      const { start, end, tone } = r;
      if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return fail(`syllables[${i}] : bornes numériques attendues`);
      if (start < prevEnd || end <= start || end > total + 1e-6) return fail(`syllables[${i}] : bornes incohérentes`);
      if (typeof tone !== "string" || !TONES.includes(tone as Tone)) return fail(`syllables[${i}] : ton inconnu`);
      prevEnd = end;
      return { start, end, tone: tone as Tone };
    });
  }
  return ref;
}
