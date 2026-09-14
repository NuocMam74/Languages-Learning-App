import { describe, expect, it } from "vitest";
import { compareAnswer, heardClassOf, isToneMinimalPair, normalizeAnswer, stripDiacritics, stripTones, toneOf } from "./text.ts";

const SOUTH = [["ngang"], ["huyen"], ["sac"], ["hoi", "nga"], ["nang"]] as const;

describe("toneOf", () => {
  it.each([
    ["ma", "ngang"],
    ["mà", "huyen"],
    ["má", "sac"],
    ["mả", "hoi"],
    ["mã", "nga"],
    ["mạ", "nang"],
    ["người", "huyen"],
    ["ướt", "sac"],
    ["đây", "ngang"],
    ["nghĩ", "nga"],
  ] as const)("%s → %s", (syllable, tone) => {
    expect(toneOf(syllable)).toBe(tone);
    expect(toneOf(syllable.normalize("NFD"))).toBe(tone);
  });
});

describe("normalisation", () => {
  it("normalise NFC, casse, ponctuation et espaces, garde les diacritiques", () => {
    expect(normalizeAnswer("  Đây là  BA tôi ! ".normalize("NFD"))).toBe("đây là ba tôi");
  });

  it("stripTones garde les voyelles modifiées", () => {
    expect(stripTones("Người Việt")).toBe("Ngươi Viêt");
  });

  it("stripDiacritics retire tout, y compris đ", () => {
    expect(stripDiacritics("Đây là ổng")).toBe("Day la ong");
  });
});

describe("tons du Sud", () => {
  it("hỏi et ngã partagent une classe auditive", () => {
    expect(heardClassOf("hoi", SOUTH)).toBe(heardClassOf("nga", SOUTH));
    expect(heardClassOf("sac", SOUTH)).not.toBe(heardClassOf("nang", SOUTH));
  });

  it("paires minimales tonales", () => {
    expect(isToneMinimalPair("ma", "má")).toBe(true);
    expect(isToneMinimalPair("ba", "bà")).toBe(true);
    expect(isToneMinimalPair("ma", "ba")).toBe(false);
    expect(isToneMinimalPair("má", "Má")).toBe(false);
  });
});

describe("compareAnswer", () => {
  it("accepte casse, ponctuation et NFD", () => {
    expect(compareAnswer("đây là ba tôi".normalize("NFD"), ["Đây là ba tôi."])).toEqual({ kind: "correct" });
  });

  it("accepte une variante listée", () => {
    expect(compareAnswer("cám ơn", ["cảm ơn", "cám ơn"])).toEqual({ kind: "correct" });
  });

  it("isole l'erreur de ton seule, avec sa position", () => {
    expect(compareAnswer("Đây là bà tôi", ["Đây là ba tôi."])).toEqual({
      kind: "tone_only",
      expected: "Đây là ba tôi.",
      positions: [2],
    });
  });

  it("distingue une erreur de voyelle (diacritique non tonal)", () => {
    expect(compareAnswer("Day la ba toi", ["Đây là ba tôi"]).kind).toBe("diacritics_only");
  });

  it("les diacritiques comptent : sans eux, ce n'est pas correct", () => {
    expect(compareAnswer("ma", ["má"]).kind).toBe("tone_only");
    expect(compareAnswer("chó", ["chào"]).kind).toBe("wrong");
  });
});
