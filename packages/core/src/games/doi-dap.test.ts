import { describe, expect, it } from "vitest";
import { countWords, DOI_DAP_DEFAULTS, doiDapResult, estimateDoiDapFluency, turnTimer } from "./doi-dap.ts";

describe("Đối đáp : chrono doux", () => {
  it("décompte 20 s et s'arrête à zéro", () => {
    expect(turnTimer(1000, 1000)).toEqual({ elapsedMs: 0, remainingMs: 20_000, ratio: 1, expired: false, seconds: 20 });
    const mid = turnTimer(1000, 11_500);
    expect(mid.seconds).toBe(10);
    expect(mid.ratio).toBeCloseTo(0.475);
    expect(turnTimer(0, 19_001).seconds).toBe(1);
    expect(turnTimer(0, 25_000)).toMatchObject({ remainingMs: 0, ratio: 0, expired: true, seconds: 0 });
  });

  it("ignore une horloge qui recule", () => {
    expect(turnTimer(5000, 4000).remainingMs).toBe(DOI_DAP_DEFAULTS.answerMs);
  });
});

describe("Đối đáp : mots et fluidité", () => {
  it("compte les mots vietnamiens, pas la ponctuation", () => {
    expect(countWords("Dạ, em khỏe — cảm ơn cô !")).toBe(6);
    expect(countWords("   ")).toBe(0);
  });

  it("estime la fluidité : tout répondu vite et juste → 100, rien → 0", () => {
    const perfect = Array.from({ length: 6 }, () => ({ responseMs: 0, corrected: false }));
    expect(estimateDoiDapFluency(perfect)).toBe(100);
    expect(estimateDoiDapFluency([])).toBe(0);
  });

  it("pénalise la lenteur, les corrections et les tours manquants", () => {
    const slow = Array.from({ length: 6 }, () => ({ responseMs: 20_000, corrected: false }));
    expect(estimateDoiDapFluency(slow)).toBe(70);
    const corrected = Array.from({ length: 6 }, () => ({ responseMs: 0, corrected: true }));
    expect(estimateDoiDapFluency(corrected)).toBe(80);
    const half = Array.from({ length: 3 }, () => ({ responseMs: 0, corrected: false }));
    expect(estimateDoiDapFluency(half)).toBe(50);
  });

  it("convertit la fluidité en résultat de jeu", () => {
    expect(doiDapResult(72)).toEqual({ correct: 4, total: 6, points: 72 });
    expect(doiDapResult(140)).toEqual({ correct: 6, total: 6, points: 100 });
    expect(doiDapResult(Number.NaN)).toEqual({ correct: 0, total: 6, points: 0 });
  });
});
