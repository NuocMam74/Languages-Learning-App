import { describe, expect, it } from "vitest";
import { MIN_TAKE_COVERAGE, PitchCapture, gradeSpeech, gradeTake, withSingleSyllable } from "./capture.ts";
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

/** Même pipeline, avec les trames seulement (sans note). */
function capture(signal: Float32Array) {
  const c = new PitchCapture();
  const tracker = new StreamingPitchTracker({ sampleRate: SR });
  for (let i = 0; i < signal.length && c.phase !== "done"; i += 128) for (const f of tracker.push(signal.subarray(i, i + 128))) c.push(f);
  return c;
}

const quiet = (rms = 0.001): PitchFrame => ({ f0: null, confidence: 0.1, rms, time: 0 });
const voiced = (f0 = 200): PitchFrame => ({ f0, confidence: 0.95, rms: 0.1, time: 0 });
const pushN = (c: PitchCapture, frame: PitchFrame, n: number) => {
  for (let i = 0; i < n; i++) c.push(frame);
};

describe("PitchCapture (découpage de la prise)", () => {
  it("s'arrête après 1,2 s de silence qui suit la parole ; trames retenues depuis l'attaque", () => {
    const { capture: c } = recordAndScore(phrase({ base: 120, tempo: 1, seed: 1, jitter: 0.01, noise: 0.002, gain: 1, lead: 0.4 }), nativeReference);
    expect(c.stopReason).toBe("silence");
    expect(c.rejectedOnsets).toBe(0);
    // arrêt ≈ 0,4 (tête) + 0,74 (parole) + 1,2 (silence) s, à la trame près (fenêtre et lissage compris).
    expect(c.elapsedMs).toBeGreaterThan(2200);
    expect(c.elapsedMs).toBeLessThan(2600);
    // Prise = ~100 ms de calme + parole + silence final : pas les 0,4 s de tête.
    expect(c.takeMs).toBeLessThan(c.elapsedMs - 250);
    expect(c.live.length).toBe(c.frames.length);
    expect(c.live.some((p) => p.st !== null)).toBe(true);
  });

  it("personne ne parle : fin après 6 s d'attente, rien entendu", () => {
    const c = new PitchCapture();
    let n = 0;
    while (c.push(quiet()) !== "done") n++;
    expect(c.stopReason).toBe("max");
    expect(c.elapsedMs).toBe(6000);
    expect(c.heardSpeech).toBe(false);
    expect(c.frames).toHaveLength(0);
  });

  it("parole qui commence après le toucher (≥ 100 ms de calme réel) : prise dès l'attaque, avec 100 ms de calme avant", () => {
    const c = new PitchCapture();
    pushN(c, quiet(), 12);
    c.push(voiced());
    expect(c.phase).toBe("speaking");
    expect(c.frames).toHaveLength(11);
    expect(c.frames.at(-1)?.f0).toBe(200);
  });

  it("voix déjà en cours au toucher : ignorée ; une pause de 150 ms ne suffit pas, 200 ms oui", () => {
    const c = new PitchCapture();
    pushN(c, voiced(), 30);
    expect(c.phase).toBe("waiting");
    expect(c.rejectedOnsets).toBe(1);
    pushN(c, quiet(), 15);
    pushN(c, voiced(), 10);
    expect(c.phase).toBe("waiting");
    expect(c.frames).toHaveLength(0);
    pushN(c, quiet(), 20);
    c.push(voiced(180));
    expect(c.phase).toBe("speaking");
    expect(c.frames.at(-1)?.f0).toBe(180);
  });

  it("flux qui démarre sur des zéros numériques puis en pleine phrase : pas de prise tronquée", () => {
    const c = new PitchCapture();
    pushN(c, quiet(0), 30); // micro pas encore ouvert : énergie strictement nulle
    pushN(c, voiced(), 20); // fin de phrase
    expect(c.phase).toBe("waiting");
    pushN(c, quiet(), 25);
    c.push(voiced());
    expect(c.phase).toBe("speaking");
  });

  it("prise commencée au milieu d'une phrase qui boucle : on attend la phrase suivante, même note", () => {
    const one = phrase({ base: 120, tempo: 1, seed: 3, jitter: 0.004, noise: 0.002, gain: 1, lead: 0.3 });
    const full = recordAndScore(one, nativeReference);
    // Début au milieu du « chào » (0,3 s de tête + 0,15 s), puis la boucle recommence.
    const cut = concat(one.subarray(Math.round(0.45 * SR)), one);
    const late = recordAndScore(cut, nativeReference);
    expect(late.capture.rejectedOnsets).toBe(1);
    expect(late.capture.stopReason).toBe("silence");
    expect(Math.abs(late.result.score - full.result.score)).toBeLessThan(5);
  });

  it("affichage en direct normalisé par la médiane glissante : 2 × F0 = +12 st", () => {
    const c = new PitchCapture();
    pushN(c, quiet(), 12);
    pushN(c, voiced(150), 20);
    c.push(voiced(300));
    expect(c.live.at(-1)?.st).toBeCloseTo(12, 5);
  });
});

describe("gradeTake (prise partielle)", () => {
  it("une fin de phrase seule (< 40 % de la durée voisée de référence) n'est pas notée", () => {
    const one = phrase({ base: 120, tempo: 1, seed: 5, jitter: 0.004, noise: 0.002, gain: 1, lead: 0.3 });
    const full = contourFromFrames(capture(one).frames);
    const good = gradeTake(full, nativeReference, "repeat", 60);
    expect(good.grade.partial).toBeUndefined();
    expect(good.grade.score).toBeGreaterThanOrEqual(80);
    expect(good.grade.coverage).toBeGreaterThan(0.8);

    // Seulement les 200 dernières ms voisées.
    const voicedIdx = full.st.flatMap((v, i) => (v === null ? [] : [i]));
    const keepFrom = voicedIdx[voicedIdx.length - 20]!;
    const tail = { hopMs: full.hopMs, st: full.st.map((v, i) => (i >= keepFrom ? v : null)) };
    const partial = gradeTake(tail, nativeReference, "repeat", 60);
    expect(partial.grade).toMatchObject({ score: null, partial: true });
    expect(partial.grade.coverage).toBeLessThan(MIN_TAKE_COVERAGE);
    expect(partial.result).toBeNull();

    expect(gradeTake({ hopMs: 10, st: [null, null] }, nativeReference, "repeat", 60).grade).toMatchObject({ score: null, coverage: 0 });
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
  }, 60_000);

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
  }, 60_000);

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
  }, 60_000);
});
