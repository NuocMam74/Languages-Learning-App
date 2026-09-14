import { describe, expect, it } from "vitest";
import { resampleContour } from "./contour.ts";
import { dtw, dtwContours } from "./dtw.ts";

const curve = (n: number) => Array.from({ length: n }, (_, i) => 3 * Math.sin((2 * Math.PI * i) / n) - (2 * i) / n);

describe("DTW", () => {
  it("identité → distance 0, chemin diagonal", () => {
    const a = curve(50);
    const r = dtw(a, a);
    expect(r.distance).toBe(0);
    expect(r.path).toHaveLength(50);
    expect(r.path.every(([i, j]) => i === j)).toBe(true);
  });

  it("copie déformée dans le temps (×1,4) → écart faible, bien plus faible que sans alignement", () => {
    const a = curve(60);
    const b = resampleContour(a, 84) as number[];
    const r = dtw(a, b);
    expect(r.normalizedDistance).toBeLessThan(0.15);
    const shifted = b.map((v) => v + 2);
    expect(dtw(a, shifted).normalizedDistance).toBeGreaterThan(10 * r.normalizedDistance);
    expect(r.path[0]).toEqual([0, 0]);
    expect(r.path.at(-1)).toEqual([59, 83]);
  });

  it("respecte la bande de Sakoe-Chiba", () => {
    const r = dtw(curve(100), curve(100).reverse(), { bandFrames: 5 });
    expect(r.path.every(([i, j]) => Math.abs(i - j) <= 5)).toBe(true);
  });

  it("longueurs très différentes : un chemin existe toujours", () => {
    const r = dtw([1, 2], curve(40));
    expect(Number.isFinite(r.distance)).toBe(true);
    expect(dtw([], [1]).distance).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignore les trames non voisées et exprime le chemin en indices d'origine", () => {
    const r = dtwContours([null, 1, 2, null, 3], [1, null, 2, 3, null]);
    expect(r.distance).toBe(0);
    expect(r.path).toEqual([
      [1, 0],
      [2, 2],
      [4, 3],
    ]);
  });
});
