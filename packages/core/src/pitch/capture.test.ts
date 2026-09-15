import { describe, expect, it } from "vitest";
import { PitchCapture, gradeSpeech, withSingleSyllable } from "./capture.ts";
import { contourFromFrames, extractContour, toPitchReference, type PitchReference } from "./contour.ts";
import { scorePronunciation } from "./score.ts";
import { StreamingPitchTracker } from "./streaming.ts";
import { concat, fromSemitones, rng, silence, synthVoice } from "./test-signals.ts";
import type { PitchFrame } from "./yin.ts";

const SR = 48_000;

/** « chào anh » : huyền (descendant) puis ngang (plat). Durées en secondes, tempo = facteur de durée. */
function phrase(o: { base: number; tempo: number; seed: number; jitter: number; noise: number; gain: number; lead: number; fall?: number }): Float32Array {
  const r = rng(o.seed);
  const harmonics = Array.from({ length: 6 + Math.floor(r() * 4) }, (_, k) => (0.7 + 0.3 * r()) / (k + 1));
  const common = { sampleRate: SR, harmonics, jitter: o.jitter, padding: 0, amplitude: 0.5 * o.gain };
  const signal = concat(
    silence(o.lead, SR),
    synthVoice({ ...common, f0: fromSemitones(o.base, (u) => 1.5 - (o.fall ?? 4.5) * u), duration: 0.34 * o.tempo, seed: o.seed + 1 }),
    silence(0.1 * o.tempo, SR),
    synthVoice({ ...common, f0: fromSemitones(o.base, () => -0.5), duration: 0.3 * o.tempo, seed: o.seed + 2 }),
    silence(1.6, SR),
  );
  // Bruit de pièce, partout (y compris dans le silence).
  const g = rng(o.seed + 99);
  for (let i = 0; i < signal.length; i++) signal[i] = signal[i]! + o.noise * (g() * 2 - 1) * Math.sqrt(3);
  return signal;
}

/** Pipeline complet de l'app : blocs de 128 échantillons → StreamingPitchTracker → PitchCapture → contour → score. */
function recordAndScore(signal: Float32Array, reference: PitchReference) {
  const capture = new PitchCapture();
  const tracker = new StreamingPitchTracker({ sampleRate: SR });
  for (let i = 0; i < signal.length && capture.phase !== "done"; i += 128) {
    const frames: PitchFrame[] = tracker.push(signal.subarray(i, i + 128));
    for (const f of frames) capture.push(f);
  }
  capture.finish("manual");
  const contour = contourFromFrames(capture.frames, capture.options.hopMs);
  return { capture, result: scorePronunciation(contour, reference) };
}

// Référence : autre locuteur (voix de femme, 220 Hz), enregistrement propre.
const nativeReference = toPitchReference(
  extractContour(phrase({ base: 220, tempo: 1, seed: 500, jitter: 0.004, noise: 0.0005, gain: 1, lead: 0.2 }), SR),
  ["huyen", "ngang"],
);

describe("PitchCapture (découpage de la prise)", () => {
  it("s'arrête après 1,2 s de silence qui suit la parole", () => {
    const { capture } = recordAndScore(phrase({ base: 120, tempo: 1, seed: 1, jitter: 0.01, noise: 0.002, gain: 1, lead: 0.4 }), nativeReference);
    expect(capture.stopReason).toBe("silence");
    // arrêt ≈ 0,4 (tête) + 0,74 (parole) + 1,2 (silence) s, à la trame près (fenêtre et lissage compris).
    expect(capture.elapsedMs).toBeGreaterThan(2200);
    expect(capture.elapsedMs).toBeLessThan(2600);
    expect(capture.live.length).toBe(capture.frames.length);
    expect(capture.live.some((p) => p.st !== null)).toBe(true);
  });

  it("s'arrête à 6 s au plus si personne ne parle, sans parole entendue", () => {
    const capture = new PitchCapture();
    let n = 0;
    while (capture.push({ f0: null, confidence: 0, rms: 0.001, time: n * 0.01 }) !== "done") n++;
    expect(capture.stopReason).toBe("max");
    expect(capture.elapsedMs).toBe(6000);
    expect(capture.heardSpeech).toBe(false);
  });

  it("démarre sur du calme : armée tout de suite", () => {
    const capture = new PitchCapture();
    capture.push({ f0: null, confidence: 0, rms: 0.0005, time: 0 });
    expect(capture.phase).toBe("waiting");
    capture.push({ f0: 200, confidence: 0.95, rms: 0.1, time: 0.01 });
    expect(capture.phase).toBe("speaking");
    expect(capture.frames).toHaveLength(2);
  });

  it("ignore une voix déjà en cours au départ (fin de l'audio natif) jusqu'à 250 ms de calme", () => {
    const capture = new PitchCapture();
    const voiced = (i: number): PitchFrame => ({ f0: 200, confidence: 0.95, rms: 0.1, time: i * 0.01 });
    for (let i = 0; i < 30; i++) capture.push(voiced(i));
    expect(capture.phase).toBe("arming");
    expect(capture.frames).toHaveLength(0);
    for (let i = 0; i < 24; i++) capture.push({ f0: null, confidence: 0, rms: 0.0005, time: 0 });
    expect(capture.phase).toBe("arming");
    capture.push({ f0: null, confidence: 0, rms: 0.0005, time: 0 });
    expect(capture.phase).toBe("waiting");
    capture.push(voiced(40));
    expect(capture.phase).toBe("speaking");
  });

  it("affichage en direct normalisé par la médiane glissante : 2 × F0 = +12 st", () => {
    const capture = new PitchCapture();
    capture.push({ f0: null, confidence: 0, rms: 0, time: 0 });
    for (let i = 0; i < 20; i++) capture.push({ f0: 150, confidence: 0.95, rms: 0.1, time: 0 });
    capture.push({ f0: 300, confidence: 0.95, rms: 0.1, time: 0 });
    expect(capture.live.at(-1)?.st).toBeCloseTo(12, 5);
  });
});

describe("gradeSpeech", () => {
  it("tone_produce : un défaut de forme plafonne sous le seuil ; speak_repeat garde le score", () => {
    const sacRef = withSingleSyllable(
      toPitchReference(extractContour(synthVoice({ f0: fromSemitones(220, (u) => -1.5 + 5 * u * u), duration: 0.4 }), 16_000)),
      "sac",
    );
    expect(sacRef.syllables).toEqual([{ start: 0, end: sacRef.st.length * sacRef.hopMs, tone: "sac" }]);
    const flat = scorePronunciation(extractContour(synthVoice({ f0: fromSemitones(120, (u) => 0.5 * u), duration: 0.4, seed: 3 }), 16_000), sacRef);
    const tone = gradeSpeech(flat, "tone", 60);
    expect(tone.toneOk).toBe(false);
    expect(tone.score).toBeLessThan(60);
    expect(gradeSpeech(flat, "repeat", 60).score).toBe(flat.score);

    const good = scorePronunciation(extractContour(synthVoice({ f0: fromSemitones(120, (u) => -1.5 + 5 * u * u), duration: 0.4, seed: 4 }), 16_000), sacRef);
    expect(gradeSpeech(good, "tone", 60)).toMatchObject({ toneOk: true, hints: [] });
    expect(gradeSpeech(good, "tone", 60).score).toBeGreaterThanOrEqual(85);
  });

  it("rien d'entendu → score null", () => {
    const r = scorePronunciation({ st: [null, null], hopMs: 10 }, nativeReference);
    expect(gradeSpeech(r, "repeat", 60)).toMatchObject({ score: null, hints: [] });
  });
});

describe("Critère d'acceptation Phase 2 (SPEC §15) : stabilité entre deux enregistrements du même locuteur", () => {
  // Même locuteur (homme, 118 Hz), même mélodie ; d'une prise à l'autre : bruit, jitter, gain,
  // tempo (± 8 %), attaque, timbre. Chaîne complète identique à l'app (blocs de 128 à 48 kHz).
  const take = (seed: number) => {
    const r = rng(seed * 7919);
    return phrase({
      base: 118 * (1 + 0.02 * (r() * 2 - 1)),
      tempo: 0.92 + 0.16 * r(),
      seed: seed * 13,
      jitter: 0.003 + 0.004 * r(),
      noise: 0.001 + 0.004 * r(),
      gain: 0.25 + 0.75 * r(),
      lead: 0.25 + 0.5 * r(),
    });
  };

  it("10 paires de prises : |Δscore| < 10 pour chacune, et les prises correctes réussissent", () => {
    const deltas: number[] = [];
    const scores: number[] = [];
    for (let pair = 0; pair < 10; pair++) {
      const a = recordAndScore(take(2 * pair + 1), nativeReference);
      const b = recordAndScore(take(2 * pair + 2), nativeReference);
      expect(a.capture.stopReason).toBe("silence");
      expect(b.capture.stopReason).toBe("silence");
      scores.push(a.result.score, b.result.score);
      deltas.push(Math.abs(a.result.score - b.result.score));
    }
    expect(Math.max(...deltas)).toBeLessThan(10);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(80);
  });

  // Mesuré (2026-09) : scores 81–88, |Δ| ≤ 5. Sensibilité connue : un jitter synthétique de 1,2–2 %
  // (voix pathologique) fait monter |Δ| jusqu'à ~13 dans ce régime ; à revérifier sur de vraies prises.
  it("apprenant imparfait (chute de 1,2 st au lieu de 4,5, score non saturé) : |Δscore| < 10 sur 10 paires", () => {
    const deltas: number[] = [];
    const scores: number[] = [];
    for (let pair = 0; pair < 10; pair++) {
      const one = (seed: number) => {
        const r = rng(seed * 104_729);
        return phrase({
          base: 118 * (1 + 0.02 * (r() * 2 - 1)), tempo: 0.92 + 0.16 * r(), seed: seed * 17, jitter: 0.003 + 0.004 * r(),
          noise: 0.001 + 0.004 * r(), gain: 0.25 + 0.75 * r(), lead: 0.25 + 0.5 * r(), fall: 1.2,
        });
      };
      const a = recordAndScore(one(2 * pair + 1), nativeReference).result.score;
      const b = recordAndScore(one(2 * pair + 2), nativeReference).result.score;
      scores.push(a, b);
      deltas.push(Math.abs(a - b));
    }
    expect(Math.max(...scores)).toBeLessThan(95);
    expect(Math.max(...deltas)).toBeLessThan(10);
  });

  it("même stabilité pour une prononciation fausse (chute trop faible), nettement moins bien notée", () => {
    const wrong = (seed: number) => {
      const r = rng(seed);
      return phrase({ base: 118, tempo: 0.92 + 0.16 * r(), seed, jitter: 0.012, noise: 0.003, gain: 0.3 + 0.7 * r(), lead: 0.3, fall: 0.8 });
    };
    const a = recordAndScore(wrong(71), nativeReference).result.score;
    const b = recordAndScore(wrong(72), nativeReference).result.score;
    const good = recordAndScore(take(3), nativeReference).result.score;
    expect(Math.abs(a - b)).toBeLessThan(10);
    expect(good - Math.max(a, b)).toBeGreaterThan(20);
  });
});
