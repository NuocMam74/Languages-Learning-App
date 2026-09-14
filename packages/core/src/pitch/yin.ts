/**
 * Estimation de F0 par YIN (de Cheveigné & Kawahara, 2002).
 *
 * TypeScript pur : aucune dépendance DOM ni Node, utilisable dans un AudioWorklet,
 * un Web Worker, le navigateur ou Node (pipeline audio hors ligne).
 *
 * Étapes : fonction de différence → différence moyenne cumulée normalisée (CMND)
 * → seuil absolu (premier creux sous le seuil, puis descente au minimum local)
 * → interpolation parabolique → f0 = sampleRate / tau.
 */

export const DEFAULT_MIN_F0 = 70;
export const DEFAULT_MAX_F0 = 500;
export const DEFAULT_YIN_THRESHOLD = 0.12;
/** Au-delà de cette valeur de CMND (si aucun creux sous le seuil), la trame est déclarée non voisée. */
export const DEFAULT_MAX_APERIODICITY = 0.35;
export const DEFAULT_WINDOW_MS = 40;
export const DEFAULT_HOP_MS = 10;
/** Fréquence d'analyse visée : largement suffisante pour 70–500 Hz, et 9× moins coûteuse qu'à 48 kHz. */
export const DEFAULT_ANALYSIS_RATE = 16_000;

export interface YinOptions {
  minF0?: number;
  maxF0?: number;
  threshold?: number;
  maxAperiodicity?: number;
}

export interface PitchEstimate {
  /** Fréquence fondamentale en Hz, ou null si la trame n'est pas voisée. */
  f0: number | null;
  /** 1 − CMND au creux retenu, dans [0, 1] (1 = parfaitement périodique). */
  confidence: number;
}

export interface PitchFrame extends PitchEstimate {
  /** Centre de la trame, en secondes depuis le début du signal. */
  time: number;
  /** Énergie RMS de la trame (échelle du signal, 1 = pleine échelle). */
  rms: number;
}

export interface FramingOptions {
  windowMs?: number;
  hopMs?: number;
}

export type AnalyzeOptions = YinOptions & FramingOptions;

/** Estimateur réutilisable (aucune allocation par trame : adapté au temps réel). */
export class YinEstimator {
  readonly sampleRate: number;
  readonly frameLength: number;
  readonly tauMin: number;
  readonly tauMax: number;
  private readonly threshold: number;
  private readonly maxAperiodicity: number;
  private readonly cmnd: Float64Array;

  constructor(sampleRate: number, frameLength: number, options: YinOptions = {}) {
    const minF0 = options.minF0 ?? DEFAULT_MIN_F0;
    const maxF0 = options.maxF0 ?? DEFAULT_MAX_F0;
    if (!(sampleRate > 0) || !(minF0 > 0) || !(maxF0 > minF0)) throw new RangeError("YIN : paramètres invalides");
    this.sampleRate = sampleRate;
    this.frameLength = frameLength;
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxF0));
    this.tauMax = Math.ceil(sampleRate / minF0);
    // Fenêtre d'intégration W = N − tauMax : il faut au moins ~1,5 période de la F0 la plus basse.
    if (frameLength - this.tauMax < this.tauMax * 0.5 || this.tauMax + 1 >= frameLength) {
      throw new RangeError(`YIN : trame de ${frameLength} échantillons trop courte pour F0 min ${minF0} Hz`);
    }
    this.threshold = options.threshold ?? DEFAULT_YIN_THRESHOLD;
    this.maxAperiodicity = options.maxAperiodicity ?? DEFAULT_MAX_APERIODICITY;
    this.cmnd = new Float64Array(this.tauMax + 2);
  }

  /** Estime la F0 de `frameLength` échantillons de `signal` à partir de `offset`. */
  estimate(signal: ArrayLike<number>, offset = 0): PitchEstimate {
    const { tauMin, tauMax, cmnd } = this;
    const w = this.frameLength - tauMax;
    if (offset < 0 || offset + this.frameLength > signal.length) throw new RangeError("YIN : trame hors du signal");

    // 1–2. Fonction de différence et CMND en une passe.
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < w; j++) {
        const delta = signal[offset + j]! - signal[offset + j + tau]!;
        sum += delta * delta;
      }
      running += sum;
      cmnd[tau] = running > 1e-20 ? (sum * tau) / running : 1;
    }

    // 3. Seuil absolu : premier creux sous le seuil, puis descente jusqu'au minimum local.
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau]! < this.threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1]! < cmnd[tau]!) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let min = tauMin;
      for (let tau = tauMin + 1; tau <= tauMax; tau++) if (cmnd[tau]! < cmnd[min]!) min = tau;
      const confidence = clamp01(1 - cmnd[min]!);
      // Un minimum collé aux bornes n'est pas un vrai creux périodique.
      if (cmnd[min]! > this.maxAperiodicity || min === tauMax) return { f0: null, confidence };
      best = min;
    }
    // Creux en bordure basse encore descendant : F0 au-delà de maxF0.
    if (best === tauMin && cmnd[tauMin - 1]! < cmnd[tauMin]!) return { f0: null, confidence: clamp01(1 - cmnd[best]!) };

    // 4. Interpolation parabolique autour du creux.
    let shift = 0;
    if (best > 1 && best < tauMax) {
      const a = cmnd[best - 1]!;
      const b = cmnd[best]!;
      const c = cmnd[best + 1]!;
      const denom = a - 2 * b + c;
      if (denom > 0) shift = Math.max(-1, Math.min(1, (0.5 * (a - c)) / denom));
    }
    return { f0: this.sampleRate / (best + shift), confidence: clamp01(1 - cmnd[best]!) };
  }
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function rmsOf(signal: ArrayLike<number>, offset: number, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const v = signal[offset + i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, length));
}

export interface FrameLayout {
  windowSamples: number;
  /** Pas exact (fractionnaire) en échantillons ; le début de la trame i est round(i × hop). */
  hopSamples: number;
  count: number;
}

/** Découpage en trames (fenêtre 40 ms, pas 10 ms par défaut) pour n'importe quelle fréquence d'échantillonnage. */
export function frameLayout(length: number, sampleRate: number, options: FramingOptions = {}): FrameLayout {
  const windowSamples = Math.round(((options.windowMs ?? DEFAULT_WINDOW_MS) * sampleRate) / 1000);
  const hopSamples = ((options.hopMs ?? DEFAULT_HOP_MS) * sampleRate) / 1000;
  if (windowSamples < 1 || !(hopSamples > 0)) throw new RangeError("fenêtre ou pas invalide");
  const count = length < windowSamples ? 0 : Math.floor((length - windowSamples) / hopSamples) + 1;
  // round(i × hop) peut dépasser pour la dernière trame : on la retire si nécessaire.
  const fits = (i: number) => Math.round(i * hopSamples) + windowSamples <= length;
  return { windowSamples, hopSamples, count: count > 0 && !fits(count - 1) ? count - 1 : count };
}

/** Itère les trames d'un signal sous forme de vues (subarray, sans copie). */
export function* iterateFrames(signal: Float32Array, sampleRate: number, options: FramingOptions = {}): Generator<{ index: number; start: number; data: Float32Array }> {
  const { windowSamples, hopSamples, count } = frameLayout(signal.length, sampleRate, options);
  for (let index = 0; index < count; index++) {
    const start = Math.round(index * hopSamples);
    yield { index, start, data: signal.subarray(start, start + windowSamples) };
  }
}

/** Analyse hors ligne : une PitchFrame toutes les `hopMs`. */
export function analyzePitch(signal: Float32Array, sampleRate: number, options: AnalyzeOptions = {}): PitchFrame[] {
  const { windowSamples, count, hopSamples } = frameLayout(signal.length, sampleRate, options);
  if (count === 0) return [];
  const yin = new YinEstimator(sampleRate, windowSamples, options);
  const out: PitchFrame[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.round(i * hopSamples);
    const { f0, confidence } = yin.estimate(signal, start);
    out.push({ f0, confidence, rms: rmsOf(signal, start, windowSamples), time: (start + windowSamples / 2) / sampleRate });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Décimation                                                          */
/* ------------------------------------------------------------------ */

/** Facteur entier de décimation vers ~`targetRate` (48 kHz → 3, 44,1 kHz → 2, 16 kHz → 1). */
export function decimationFactor(sampleRate: number, targetRate = DEFAULT_ANALYSIS_RATE): number {
  return Math.max(1, Math.floor(sampleRate / targetRate));
}

/**
 * Décimateur FIR (sinc fenêtré Hamming, coupure à 0,45 × la nouvelle fréquence), en flux.
 * Retard de groupe : (taps − 1) / 2 échantillons d'entrée.
 */
export class FirDecimator {
  readonly factor: number;
  private readonly taps: Float64Array;
  private readonly history: Float64Array;
  private pos = 0;
  private phase = 0;

  constructor(factor: number) {
    if (!Number.isInteger(factor) || factor < 1) throw new RangeError("facteur de décimation invalide");
    this.factor = factor;
    const length = factor === 1 ? 1 : 16 * factor + 1;
    const taps = new Float64Array(length);
    const fc = 0.45 / factor; // cycles par échantillon d'entrée
    const mid = (length - 1) / 2;
    let sum = 0;
    for (let n = 0; n < length; n++) {
      const x = n - mid;
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const hamming = length === 1 ? 1 : 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (length - 1));
      taps[n] = sinc * hamming;
      sum += taps[n]!;
    }
    for (let n = 0; n < length; n++) taps[n] = taps[n]! / sum;
    this.taps = taps;
    this.history = new Float64Array(length * 2);
  }

  /** Pousse des échantillons ; `emit` est appelé pour chaque échantillon de sortie. */
  process(input: ArrayLike<number>, emit: (sample: number) => void): void {
    const { taps, history, factor } = this;
    const n = taps.length;
    for (let i = 0; i < input.length; i++) {
      const v = input[i]!;
      history[this.pos] = v;
      history[this.pos + n] = v;
      this.pos = (this.pos + 1) % n;
      if (this.phase === 0) {
        if (factor === 1) {
          emit(v);
        } else {
          let acc = 0;
          // history[pos .. pos+n) contient les n derniers échantillons, du plus ancien au plus récent.
          for (let k = 0; k < n; k++) acc += taps[k]! * history[this.pos + k]!;
          emit(acc);
        }
      }
      this.phase = (this.phase + 1) % factor;
    }
  }

  reset(): void {
    this.history.fill(0);
    this.pos = 0;
    this.phase = 0;
  }
}

/** Décime un signal complet (hors ligne). Retourne le signal et sa nouvelle fréquence. */
export function downsampleForPitch(signal: Float32Array, sampleRate: number, targetRate = DEFAULT_ANALYSIS_RATE): { signal: Float32Array; sampleRate: number } {
  const factor = decimationFactor(sampleRate, targetRate);
  if (factor === 1) return { signal, sampleRate };
  const out = new Float32Array(Math.ceil(signal.length / factor));
  let k = 0;
  new FirDecimator(factor).process(signal, (s) => {
    out[k++] = s;
  });
  return { signal: out.subarray(0, k), sampleRate: sampleRate / factor };
}
