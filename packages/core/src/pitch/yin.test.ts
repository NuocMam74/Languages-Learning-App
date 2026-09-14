import { describe, expect, it } from "vitest";
import { extractContour, median, voicedValues } from "./contour.ts";
import { StreamingPitchTracker } from "./streaming.ts";
import { rng, synthVoice } from "./test-signals.ts";
import { YinEstimator, analyzePitch, downsampleForPitch, frameLayout } from "./yin.ts";

const voicedF0 = (frames: { f0: number | null }[]) => frames.map((f) => f.f0).filter((f): f is number => f !== null);

function sine(freq: number, seconds: number, sr: number, amp = 0.5): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr));
}

describe("YIN — trames", () => {
  it("découpe 40 ms / 10 ms quelle que soit la fréquence", () => {
    expect(frameLayout(16_000, 16_000)).toEqual({ windowSamples: 640, hopSamples: 160, count: 97 });
    const l = frameLayout(44_100, 44_100);
    expect(l.windowSamples).toBe(1764);
    expect(l.hopSamples).toBeCloseTo(441);
    expect(frameLayout(100, 16_000).count).toBe(0);
  });

  it("refuse une trame trop courte pour la F0 minimale", () => {
    expect(() => new YinEstimator(16_000, 200, { minF0: 70 })).toThrow(RangeError);
  });
});

describe("YIN — estimation", () => {
  it("sinus 200 Hz à 16 kHz", () => {
    const frames = analyzePitch(sine(200, 0.5, 16_000), 16_000);
    const f0 = voicedF0(frames);
    expect(f0.length).toBe(frames.length);
    for (const f of f0) expect(f).toBeCloseTo(200, 0);
    expect(Math.min(...frames.map((f) => f.confidence))).toBeGreaterThan(0.95);
  });

  it("dent de scie riche en harmoniques (110 Hz, 44,1 kHz)", () => {
    const sr = 44_100;
    const saw = synthVoice({ f0: () => 110, duration: 0.5, sampleRate: sr, harmonics: Array.from({ length: 20 }, (_, k) => 1 / (k + 1)), padding: 0 });
    const f0 = voicedF0(analyzePitch(saw, sr));
    expect(f0.length).toBeGreaterThan(40);
    expect(Math.abs(median(f0) - 110)).toBeLessThan(0.5);
    for (const f of f0) expect(Math.abs(f - 110) / 110).toBeLessThan(0.01);
  });

  it("suit un glissando 150 → 250 Hz", () => {
    const sr = 16_000;
    const dur = 1;
    const sig = synthVoice({ f0: (u) => 150 + 100 * u, duration: dur, sampleRate: sr, padding: 0 });
    const frames = analyzePitch(sig, sr);
    for (const fr of frames.slice(2, -2)) {
      const expected = 150 + 100 * (fr.time / dur);
      expect(fr.f0).not.toBeNull();
      expect(Math.abs(fr.f0! - expected) / expected).toBeLessThan(0.02);
    }
  });

  it("silence et bruit blanc → non voisé", () => {
    const sr = 16_000;
    expect(voicedF0(analyzePitch(new Float32Array(sr), sr))).toHaveLength(0);
    const r = rng(7);
    const noise = Float32Array.from({ length: sr }, () => 0.3 * (r() * 2 - 1));
    const c = extractContour(noise, sr);
    expect(c.voicedRatio).toBeLessThan(0.02);
    expect(c.medianHz === null || voicedValues(c.st).length < 5).toBe(true);
  });

  it("résiste à l'erreur d'octave : fondamentale faible, 2e harmonique dominante", () => {
    const sig = synthVoice({ f0: () => 120, duration: 0.5, harmonics: [0.15, 1, 0.5, 0.3, 0.2], padding: 0 });
    const f0 = voicedF0(analyzePitch(sig, 16_000));
    expect(Math.abs(median(f0) - 120)).toBeLessThan(1);
    expect(f0.filter((f) => f > 180).length).toBe(0);
  });

  it("borne 70–500 Hz : un 600 Hz n'est pas rapporté comme tel", () => {
    const f0 = voicedF0(analyzePitch(sine(600, 0.3, 16_000), 16_000));
    expect(f0.every((f) => f <= 500)).toBe(true);
  });
});

describe("décimation et suivi en flux", () => {
  it("48 kHz décimé à 16 kHz garde la F0", () => {
    const { signal, sampleRate } = downsampleForPitch(sine(200, 0.5, 48_000), 48_000);
    expect(sampleRate).toBe(16_000);
    expect(median(voicedF0(analyzePitch(signal, sampleRate)))).toBeCloseTo(200, 0);
  });

  it("StreamingPitchTracker (blocs de 128) = analyse hors ligne", () => {
    const sr = 48_000;
    const sig = synthVoice({ f0: (u) => 180 + 60 * u, duration: 0.6, sampleRate: sr });
    const seen: number[] = [];
    const tracker = new StreamingPitchTracker({ sampleRate: sr, onFrame: (f) => seen.push(f.time) });
    const streamed = [];
    for (let i = 0; i < sig.length; i += 128) streamed.push(...tracker.push(sig.subarray(i, i + 128)));
    expect(tracker.analysisRate).toBe(16_000);
    expect(seen).toHaveLength(streamed.length);

    const ds = downsampleForPitch(sig, sr);
    const offline = analyzePitch(ds.signal, ds.sampleRate);
    expect(Math.abs(streamed.length - offline.length)).toBeLessThanOrEqual(1);
    const n = Math.min(streamed.length, offline.length);
    for (let i = 0; i < n; i++) {
      expect(streamed[i]!.time).toBeCloseTo(offline[i]!.time, 6);
      if (offline[i]!.f0 === null) expect(streamed[i]!.f0).toBeNull();
      else expect(streamed[i]!.f0).toBeCloseTo(offline[i]!.f0!, 3);
    }
    tracker.reset();
    expect(tracker.frameCount).toBe(0);
  });
});
