import { describe, expect, it } from "vitest";
import {
  PitchReferenceError,
  bridgeGaps,
  correctOctaveJumps,
  extractContour,
  medianSmooth,
  parsePitchReference,
  removeShortIslands,
  resampleContour,
  segmentSyllables,
  serializePitchReference,
  toPitchReference,
  toSemitones,
  trimUnvoiced,
} from "./contour.ts";
import { concat, fromSemitones, silence, synthVoice } from "./test-signals.ts";

const shape = (u: number) => 2 - 5 * u + 3 * Math.sin(Math.PI * u); // montée puis chute

describe("courbe normalisée par locuteur", () => {
  it("homme 110 Hz et femme 220 Hz, même mélodie → même courbe à 0,5 st près", () => {
    const male = extractContour(synthVoice({ f0: fromSemitones(110, shape), duration: 0.6, harmonics: [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1] }), 16_000);
    const female = extractContour(synthVoice({ f0: fromSemitones(220, shape), duration: 0.6, harmonics: [1, 0.4, 0.2, 0.1] }), 16_000);
    expect(male.medianHz! / female.medianHz!).toBeCloseTo(0.5, 2);
    expect(male.st.length).toBe(female.st.length);
    let compared = 0;
    male.st.forEach((m, i) => {
      const f = female.st[i];
      if (m === null || f == null) return;
      compared++;
      expect(Math.abs(m - f)).toBeLessThan(0.5);
    });
    expect(compared).toBeGreaterThan(50);
  });

  it("silence autour → non voisé en tête et en queue", () => {
    const c = extractContour(concat(silence(0.3), synthVoice({ f0: () => 200, duration: 0.3, padding: 0 }), silence(0.3)), 16_000);
    expect(c.st.slice(0, 20).every((v) => v === null)).toBe(true);
    expect(c.st.slice(-20).every((v) => v === null)).toBe(true);
    expect(c.voicedRatio).toBeGreaterThan(0.25);
    expect(c.medianHz).toBeCloseTo(200, 0);
  });
});

describe("nettoyage", () => {
  it("retire les îlots voisés courts", () => {
    expect(removeShortIslands([null, 1, 1, null, 2, 2, 2, 2, 2, null], 5)).toEqual([null, null, null, null, 2, 2, 2, 2, 2, null]);
  });

  it("corrige les sauts d'octave isolés et en rafale courte", () => {
    const base = Array.from({ length: 40 }, (_, i) => 150 + i);
    const broken: (number | null)[] = [...base];
    broken[10] = base[10]! * 2;
    broken[20] = base[20]! / 2;
    for (let i = 30; i < 34; i++) broken[i] = base[i]! * 2;
    const fixed = correctOctaveJumps(broken);
    fixed.forEach((v, i) => expect(v).toBeCloseTo(base[i]!, 6));
  });

  it("filtre médian : une valeur aberrante disparaît, les bords d'îlot sont respectés", () => {
    expect(medianSmooth([null, 100, 100, 300, 100, 100, null, 50], 5)).toEqual([null, 100, 100, 100, 100, 100, null, 50]);
  });

  it("comble les micro-trous", () => {
    const out = bridgeGaps([100, 100, null, 400, 400], 2);
    expect(out[2]).toBeCloseTo(200, 6);
    expect(bridgeGaps([100, null, null, null, 100], 2)).toEqual([100, null, null, null, 100]);
  });

  it("demi-tons relatifs à la médiane", () => {
    expect(toSemitones([100, 200, null, 400])).toEqual([-12, 0, null, 12]);
  });
});

describe("normalisation temporelle", () => {
  it("trimUnvoiced et resampleContour", () => {
    expect(trimUnvoiced([null, null, 1, null, 2, null])).toEqual({ offset: 2, track: [1, null, 2] });
    expect(resampleContour([0, 10], 3)).toEqual([0, 5, 10]);
    expect(resampleContour([0, 2, 4, 6], 2)).toEqual([0, 6]);
  });
});

describe("format de référence", () => {
  const ref = { v: 1 as const, hopMs: 10, st: [null, 0.1234, -1.26, 2], syllables: [{ start: 10, end: 40, tone: "sac" as const }] };

  it("sérialise en compact (0,1 st) et relit à l'identique", () => {
    const json = serializePitchReference(ref);
    expect(json).toBe('{"v":1,"hopMs":10,"st":[null,0.1,-1.3,2],"syllables":[{"start":10,"end":40,"tone":"sac"}]}');
    expect(parsePitchReference(json)).toEqual(JSON.parse(json));
  });

  it("parseur strict", () => {
    const bad: unknown[] = [
      "not json",
      null,
      [],
      { ...ref, v: 2 },
      { ...ref, extra: true },
      { ...ref, hopMs: 0 },
      { ...ref, st: [] },
      { ...ref, st: [null, null] },
      { ...ref, st: [1, "2"] },
      { ...ref, st: [1, 1e9] },
      { ...ref, syllables: [{ start: 0, end: 90, tone: "sac" }] },
      { ...ref, syllables: [{ start: 20, end: 10, tone: "sac" }] },
      { ...ref, syllables: [{ start: 0, end: 20, tone: "up" }] },
      { ...ref, syllables: [{ start: 0, end: 20, tone: "sac", x: 1 }] },
      { ...ref, syllables: [{ start: 0, end: 30, tone: "sac" }, { start: 20, end: 40, tone: "nang" }] },
    ];
    for (const b of bad) expect(() => parsePitchReference(b), JSON.stringify(b)).toThrow(PitchReferenceError);
  });

  it("segmente en syllabes par îlots voisés (fusion des plus petits silences)", () => {
    const track = [null, 1, 1, 1, null, 2, 2, null, null, null, 3, 3, null];
    expect(segmentSyllables(track, ["ngang", "huyen"], 10)).toEqual([
      { start: 10, end: 70, tone: "ngang" },
      { start: 100, end: 120, tone: "huyen" },
    ]);
    expect(segmentSyllables(track, ["ngang", "huyen", "sac", "nang"], 10)).toBeUndefined();
  });

  it("toPitchReference depuis un signal réel", () => {
    const sig = concat(synthVoice({ f0: () => 200, duration: 0.3 }), synthVoice({ f0: (u) => 200 * 2 ** (-4 * u / 12), duration: 0.3 }));
    const r = toPitchReference(extractContour(sig, 16_000), ["ngang", "huyen"]);
    expect(r.st[0]).not.toBeNull();
    expect(r.st.at(-1)).not.toBeNull();
    expect(r.syllables?.map((s) => s.tone)).toEqual(["ngang", "huyen"]);
    expect(parsePitchReference(serializePitchReference(r))).toEqual(r);
  });
});
