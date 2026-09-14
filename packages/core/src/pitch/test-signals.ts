/**
 * Signaux synthétiques déterministes pour les tests du module pitch (non exporté par index.ts).
 */

/** PRNG déterministe (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface VoiceOptions {
  /** F0 en Hz en fonction du temps normalisé u ∈ [0, 1] de la partie voisée. */
  f0: (u: number) => number;
  duration: number;
  sampleRate?: number;
  /** Amplitudes relatives des harmoniques (défaut : 1/k sur 8 harmoniques). */
  harmonics?: readonly number[];
  amplitude?: number;
  /** Écart-type relatif de F0 tiré à chaque période (jitter). */
  jitter?: number;
  /** Amplitude RMS du bruit blanc ajouté partout (y compris le silence). */
  noise?: number;
  /** Silence avant/après (s). */
  padding?: number;
  seed?: number;
}

export function synthVoice(o: VoiceOptions): Float32Array {
  const sr = o.sampleRate ?? 16_000;
  const pad = Math.round((o.padding ?? 0.1) * sr);
  const n = Math.round(o.duration * sr);
  const out = new Float32Array(n + 2 * pad);
  const harmonics = o.harmonics ?? Array.from({ length: 8 }, (_, k) => 1 / (k + 1));
  const norm = harmonics.reduce((s, h) => s + Math.abs(h), 0);
  const amp = (o.amplitude ?? 0.5) / norm;
  const rand = rng(o.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const fade = Math.round(0.015 * sr);
  let phase = 0;
  let jit = 1;
  for (let i = 0; i < n; i++) {
    const f = o.f0(n > 1 ? i / (n - 1) : 0) * jit;
    const prev = phase;
    phase += (2 * Math.PI * f) / sr;
    if (Math.floor(phase / (2 * Math.PI)) !== Math.floor(prev / (2 * Math.PI))) jit = 1 + (o.jitter ?? 0) * gauss();
    let s = 0;
    for (let k = 0; k < harmonics.length; k++) s += harmonics[k]! * Math.sin((k + 1) * phase);
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[pad + i] = amp * s * env;
  }
  if (o.noise) for (let i = 0; i < out.length; i++) out[i] = out[i]! + o.noise * gauss();
  return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

export function silence(seconds: number, sampleRate = 16_000): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

/** F0 = base × 2^(st(u)/12). */
export const fromSemitones = (base: number, st: (u: number) => number) => (u: number) => base * 2 ** (st(u) / 12);
