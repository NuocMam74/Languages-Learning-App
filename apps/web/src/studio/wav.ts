/**
 * Enregistrement du studio (contrat phase4 §1 « Audio et courbes F0 ») :
 * PCM mono → WAV 16 bits, rééchantillonnage 48 kHz, repérage des silences de tête et de queue.
 * Fonctions pures, testées sans navigateur.
 */

export const STUDIO_SAMPLE_RATE = 48_000;

/** Encode un signal mono [-1, 1] en WAV PCM 16 bits little-endian. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // taille du bloc fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * bytesPerSample, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buffer;
}

/** Relit un WAV PCM 16 bits mono (tests, et contrôle de ce qui part au serveur). */
export function decodeWav(buffer: ArrayBuffer): { sampleRate: number; channels: number; samples: Float32Array } {
  const view = new DataView(buffer);
  const tag = (offset: number) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("WAV invalide");
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
    } else if (id === "data") {
      const count = Math.floor(size / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(offset + 8 + i * 2, true) / 0x8000;
      return { sampleRate, channels, samples };
    }
    offset += 8 + size;
  }
  throw new Error("WAV sans données");
}

/** Rééchantillonnage linéaire (suffisant pour la voix : le serveur refait le traitement). */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const length = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const x = i * ratio;
    const k = Math.floor(x);
    const f = x - k;
    const a = samples[k] ?? 0;
    const b = samples[Math.min(k + 1, samples.length - 1)] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

export interface TrimOptions {
  /** Fenêtre d'analyse d'énergie. */
  windowMs?: number;
  /** Seuil sous le maximum de la prise, en dB. */
  thresholdDb?: number;
  /** Plancher absolu (RMS) : en dessous, c'est du silence quel que soit le maximum. */
  floor?: number;
  /** Marge gardée avant et après la voix. */
  padMs?: number;
}

/** Bornes [start, end) de la voix dans la prise ; null si la prise est silencieuse. */
export function findVoiceBounds(samples: Float32Array, sampleRate: number, options: TrimOptions = {}): { start: number; end: number } | null {
  const windowMs = options.windowMs ?? 10;
  const thresholdDb = options.thresholdDb ?? 35;
  const floor = options.floor ?? 0.004;
  const padMs = options.padMs ?? 120;
  const win = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const rms: number[] = [];
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += (samples[j] ?? 0) ** 2;
    rms.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  const peak = rms.reduce((m, v) => Math.max(m, v), 0);
  if (peak < floor) return null;
  const threshold = Math.max(floor, peak * 10 ** (-thresholdDb / 20));
  const first = rms.findIndex((v) => v >= threshold);
  let last = rms.length - 1;
  while (last > first && (rms[last] ?? 0) < threshold) last--;
  const pad = Math.round((sampleRate * padMs) / 1000);
  return { start: Math.max(0, first * win - pad), end: Math.min(samples.length, (last + 1) * win + pad) };
}

export function trimSilence(samples: Float32Array, sampleRate: number, options: TrimOptions = {}): Float32Array {
  const bounds = findVoiceBounds(samples, sampleRate, options);
  return bounds ? samples.slice(bounds.start, bounds.end) : new Float32Array(0);
}

/** Enveloppe pour l'affichage : [min, max] par colonne. */
export function waveformPeaks(samples: Float32Array, columns: number): [number, number][] {
  const out: [number, number][] = [];
  if (samples.length === 0 || columns <= 0) return out;
  const step = samples.length / columns;
  for (let c = 0; c < columns; c++) {
    const a = Math.floor(c * step);
    const b = Math.max(a + 1, Math.floor((c + 1) * step));
    let min = 0;
    let max = 0;
    for (let i = a; i < b && i < samples.length; i++) {
      const v = samples[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out.push([min, max]);
  }
  return out;
}
