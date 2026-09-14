import { describe, expect, it } from "vitest";
import { extractContour, toPitchReference, type PitchReference } from "./contour.ts";
import { distanceToScore, scorePronunciation, toneHint } from "./score.ts";
import { concat, fromSemitones, rng, silence, synthVoice } from "./test-signals.ts";

const falling = (u: number) => 1 - 4.5 * u; // huyền
const rising = (u: number) => -1.5 + 5 * u * u; // sắc
const level = () => 0;

function reference(st: (u: number) => number, duration = 0.5): PitchReference {
  return toPitchReference(extractContour(synthVoice({ f0: fromSemitones(220, st), duration, harmonics: [1, 0.5, 0.3, 0.2] }), 16_000));
}

/** Une « prise » d'un autre locuteur : autre registre, timbre, tempo, jitter, dérive lente, bruit. */
function take(st: (u: number) => number, seed: number, base = 115) {
  const r = rng(seed);
  const drift = 0.6 * (r() * 2 - 1);
  const phase = r() * Math.PI * 2;
  const harmonics = Array.from({ length: 6 + Math.floor(r() * 6) }, (_, k) => (0.6 + 0.4 * r()) / (k + 1));
  const sig = synthVoice({
    f0: fromSemitones(base, (u) => st(u) + drift * Math.sin(2 * Math.PI * u + phase)),
    duration: 0.5 * (0.85 + 0.4 * r()),
    harmonics,
    jitter: 0.015,
    noise: 0.01,
    seed,
  });
  return extractContour(sig, 16_000);
}

describe("calibration", () => {
  it("écart → score linéaire borné", () => {
    expect(distanceToScore(0)).toBe(100);
    expect(distanceToScore(0.25)).toBe(100);
    expect(distanceToScore(2.2)).toBe(0);
    expect(distanceToScore(Number.POSITIVE_INFINITY)).toBe(0);
    expect(distanceToScore(1.225)).toBe(50);
  });
});

describe("scorePronunciation", () => {
  it("la référence contre elle-même vaut 100", () => {
    const ref = reference(falling);
    expect(scorePronunciation(ref, ref).score).toBe(100);
  });

  it("stabilité (critère Phase 2) : 20 prises de la même courbe → scores à moins de 10 points d'écart", () => {
    const ref = reference(falling);
    const scores = Array.from({ length: 20 }, (_, seed) => scorePronunciation(take(falling, seed + 1), ref).score);
    expect(Math.max(...scores) - Math.min(...scores)).toBeLessThan(10);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(85);
  });

  it("voix d'homme et de femme notées pareil", () => {
    const ref = reference(rising);
    const male = scorePronunciation(take(rising, 3, 110), ref).score;
    const female = scorePronunciation(take(rising, 3, 230), ref).score;
    expect(Math.abs(male - female)).toBeLessThan(10);
  });

  it("mauvais ton : montant au lieu de descendant → bien plus bas", () => {
    const ref = reference(falling);
    const good = scorePronunciation(take(falling, 5), ref).score;
    const wrong = scorePronunciation(take(rising, 5), ref).score;
    const flat = scorePronunciation(take(level, 5), ref).score;
    expect(good - wrong).toBeGreaterThan(50);
    expect(wrong).toBeLessThan(40);
    expect(flat).toBeLessThan(good - 30);
    expect(scorePronunciation(take((u) => 0.5 - 2 * u, 5), ref).score).toBeLessThan(good);
  });

  it("enregistrement muet → score 0, voiced=false", () => {
    const ref = reference(falling);
    const r = scorePronunciation(extractContour(silence(0.5), 16_000), ref);
    expect(r).toMatchObject({ score: 0, voiced: false });
  });

  it("accepte un autre pas temporel côté utilisateur", () => {
    const ref = reference(falling);
    const user = take(falling, 9);
    const every20 = { hopMs: 20, st: user.st.filter((_, i) => i % 2 === 0) };
    expect(Math.abs(scorePronunciation(every20, ref).score - scorePronunciation(user, ref).score)).toBeLessThan(10);
  });
});

describe("indications par syllabe", () => {
  // « ma mà » : ton plat puis ton descendant.
  const phrase = (base: number, fallSt: number, seed = 1) =>
    extractContour(
      concat(
        synthVoice({ f0: () => base, duration: 0.3, seed, jitter: 0.005 }),
        silence(0.12),
        synthVoice({ f0: fromSemitones(base, (u) => -fallSt * u), duration: 0.35, seed: seed + 1, jitter: 0.005 }),
      ),
      16_000,
    );

  const ref = toPitchReference(phrase(220, 5), ["ngang", "huyen"]);

  it("la référence porte ses syllabes", () => {
    expect(ref.syllables?.map((s) => s.tone)).toEqual(["ngang", "huyen"]);
  });

  it("huyền qui ne descend pas assez → not_low_enough sur la 2e syllabe", () => {
    const r = scorePronunciation(phrase(120, 1.2, 4), ref);
    expect(r.perSyllable?.[0]?.issue).toBeNull();
    expect(r.perSyllable?.[1]?.issue).toBe("not_low_enough");
    expect(toneHint("not_low_enough", "huyen", "mà")).toBe("Ton descendant pas assez bas sur « mà »");
    expect(toneHint("no_dip", "hoi", "mả", "en")).toBe("Dipping tone missing the dip on “mả”");
  });

  it("bonne prononciation → aucune indication", () => {
    const r = scorePronunciation(phrase(120, 5, 8), ref);
    expect(r.score).toBeGreaterThan(85);
    expect(r.perSyllable?.every((s) => s.issue === null)).toBe(true);
  });

  it("sắc trop plat → too_flat ou not_high_enough", () => {
    const sacRef = toPitchReference(extractContour(synthVoice({ f0: fromSemitones(220, rising), duration: 0.4 }), 16_000), ["sac"]);
    const user = extractContour(synthVoice({ f0: fromSemitones(120, (u) => 0.5 * u), duration: 0.4, seed: 3 }), 16_000);
    expect(["too_flat", "not_high_enough"]).toContain(scorePronunciation(user, sacRef).perSyllable?.[0]?.issue);
  });

  it("hỏi sans creux → no_dip ; nặng traîné → too_long", () => {
    const dip = (u: number) => -4 * Math.sin(Math.PI * u) + 2 * u;
    const hoiRef = toPitchReference(extractContour(synthVoice({ f0: fromSemitones(220, dip), duration: 0.45 }), 16_000), ["hoi"]);
    const hoiUser = extractContour(synthVoice({ f0: fromSemitones(120, (u) => 2 * u - 1), duration: 0.45, seed: 2 }), 16_000);
    expect(scorePronunciation(hoiUser, hoiRef).perSyllable?.[0]?.issue).toBe("no_dip");

    const heavy = (u: number) => -3 * u;
    const nangRef = toPitchReference(extractContour(synthVoice({ f0: fromSemitones(220, heavy), duration: 0.15 }), 16_000), ["nang"]);
    const nangUser = extractContour(synthVoice({ f0: fromSemitones(120, heavy), duration: 0.45, seed: 5 }), 16_000);
    expect(scorePronunciation(nangUser, nangRef, { band: 1 }).perSyllable?.[0]?.issue).toBe("too_long");
  });
});
