import {
  DEFAULT_ANALYSIS_RATE,
  DEFAULT_HOP_MS,
  DEFAULT_WINDOW_MS,
  FirDecimator,
  YinEstimator,
  decimationFactor,
  rmsOf,
  type PitchFrame,
  type YinOptions,
} from "./yin.ts";

export interface StreamingPitchOptions extends YinOptions {
  /** Fréquence d'échantillonnage du flux entrant (AudioContext.sampleRate). */
  sampleRate: number;
  windowMs?: number;
  hopMs?: number;
  /** Fréquence d'analyse visée après décimation entière (16 kHz par défaut). */
  targetRate?: number;
  /** Appelé pour chaque trame produite (en plus du tableau retourné par push). */
  onFrame?: (frame: PitchFrame) => void;
}

/**
 * Suivi de F0 en flux, pensé pour un AudioWorkletProcessor : on lui pousse les blocs
 * de 128 échantillons de `process()`, il émet une trame toutes les 10 ms.
 *
 * Mêmes trames que `analyzePitch` sur le signal décimé : la trame i commence à
 * round(i × hop) et son `time` est le centre de la fenêtre (retard du filtre de
 * décimation non compensé : ≤ 2,5 ms à 48 kHz).
 *
 * ```ts
 * // dans l'AudioWorkletProcessor
 * const tracker = new StreamingPitchTracker({ sampleRate, onFrame: (f) => this.port.postMessage(f) });
 * process(inputs) { const ch = inputs[0]?.[0]; if (ch) tracker.push(ch); return true; }
 * ```
 */
export class StreamingPitchTracker {
  readonly analysisRate: number;
  readonly windowSamples: number;
  readonly hopMs: number;
  private readonly hopSamples: number;
  private readonly decimator: FirDecimator;
  private readonly yin: YinEstimator;
  private readonly ring: Float32Array;
  private readonly frame: Float32Array;
  private readonly onFrame: ((frame: PitchFrame) => void) | undefined;
  private writePos = 0;
  private total = 0;
  private frameIndex = 0;
  private nextStart = 0;
  private pending: PitchFrame[] = [];

  constructor(options: StreamingPitchOptions) {
    const factor = decimationFactor(options.sampleRate, options.targetRate ?? DEFAULT_ANALYSIS_RATE);
    this.analysisRate = options.sampleRate / factor;
    this.hopMs = options.hopMs ?? DEFAULT_HOP_MS;
    this.windowSamples = Math.round(((options.windowMs ?? DEFAULT_WINDOW_MS) * this.analysisRate) / 1000);
    this.hopSamples = (this.hopMs * this.analysisRate) / 1000;
    this.decimator = new FirDecimator(factor);
    this.yin = new YinEstimator(this.analysisRate, this.windowSamples, options);
    this.ring = new Float32Array(this.windowSamples);
    this.frame = new Float32Array(this.windowSamples);
    this.onFrame = options.onFrame;
  }

  /** Pousse un bloc (typiquement 128 échantillons). Retourne les trames complétées par ce bloc. */
  push(chunk: ArrayLike<number>): PitchFrame[] {
    this.pending = [];
    this.decimator.process(chunk, this.accept);
    return this.pending;
  }

  /** Nombre de trames émises depuis le dernier reset. */
  get frameCount(): number {
    return this.frameIndex;
  }

  reset(): void {
    this.decimator.reset();
    this.ring.fill(0);
    this.writePos = 0;
    this.total = 0;
    this.frameIndex = 0;
    this.nextStart = 0;
    this.pending = [];
  }

  private readonly accept = (sample: number): void => {
    const n = this.windowSamples;
    this.ring[this.writePos] = sample;
    this.writePos = (this.writePos + 1) % n;
    this.total++;
    if (this.total !== this.nextStart + n) return;

    // Copie ordonnée des n derniers échantillons.
    const { ring, frame } = this;
    for (let k = 0; k < n; k++) frame[k] = ring[(this.writePos + k) % n]!;
    const { f0, confidence } = this.yin.estimate(frame, 0);
    const out: PitchFrame = { f0, confidence, rms: rmsOf(frame, 0, n), time: (this.nextStart + n / 2) / this.analysisRate };
    this.frameIndex++;
    this.nextStart = Math.round(this.frameIndex * this.hopSamples);
    this.pending.push(out);
    this.onFrame?.(out);
  };
}
