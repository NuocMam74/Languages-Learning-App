import { describe, expect, it } from "vitest";
import { formatBytes, selectLruPurge } from "./lru.ts";

const MB = 1024 * 1024;
const e = (key: string, mb: number, day: number) => ({ key, bytes: mb * MB, lastUsedAt: `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z` });

describe("purge LRU des unités hors ligne", () => {
  it("rien à purger sous le quota", () => {
    expect(selectLruPurge([e("a", 50, 1), e("b", 50, 2)], 200 * MB)).toEqual([]);
  });

  it("retire les moins récemment utilisées jusqu'à repasser sous le quota", () => {
    const entries = [e("recent", 80, 10), e("oldest", 80, 1), e("middle", 80, 5)];
    expect(selectLruPurge(entries, 200 * MB)).toEqual(["oldest"]);
    expect(selectLruPurge(entries, 100 * MB)).toEqual(["oldest", "middle"]);
  });

  it("ne retire jamais l'unité en cours, même la plus ancienne", () => {
    const entries = [e("current", 80, 1), e("b", 80, 2), e("c", 80, 3)];
    expect(selectLruPurge(entries, 100 * MB, new Set(["current"]))).toEqual(["b", "c"]);
    // Seules des unités protégées : quota dépassé toléré.
    expect(selectLruPurge([e("current", 300, 1)], 100 * MB, new Set(["current"]))).toEqual([]);
  });
});

describe("taille affichée", () => {
  it("français et anglais", () => {
    expect(formatBytes(2.4 * MB, "fr")).toBe("2,4 Mo");
    expect(formatBytes(2.4 * MB, "en")).toBe("2.4 MB");
    expect(formatBytes(300 * 1024, "fr")).toBe("300 Ko");
    expect(formatBytes(12, "en")).toBe("1 KB");
    expect(formatBytes(15 * MB, "fr")).toBe("15 Mo");
  });
});
