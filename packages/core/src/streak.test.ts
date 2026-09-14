import { describe, expect, it } from "vitest";
import { emptyStreak, recordActivity, type Streak } from "./streak.ts";

function days(start: string, n: number): string[] {
  const t = Date.parse(`${start}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t + i * 86_400_000).toISOString().slice(0, 10));
}

const play = (s: Streak, dates: string[]) => dates.reduce(recordActivity, s);

describe("série", () => {
  it("compte les jours consécutifs, une seule fois par jour", () => {
    const s = play(emptyStreak(), ["2026-09-01", "2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(s).toMatchObject({ current: 3, longest: 3, lastActiveDate: "2026-09-03" });
  });

  it("repart à 1 après un trou sans protection", () => {
    const s = play(emptyStreak(), ["2026-09-01", "2026-09-02", "2026-09-05"]);
    expect(s).toMatchObject({ current: 1, longest: 2 });
  });

  it("offre une protection tous les 10 jours, 2 au maximum", () => {
    expect(play(emptyStreak(), days("2026-09-01", 10)).freezesAvailable).toBe(1);
    expect(play(emptyStreak(), days("2026-09-01", 35)).freezesAvailable).toBe(2);
  });

  it("consomme automatiquement une protection pour un oubli isolé", () => {
    const ten = play(emptyStreak(), days("2026-09-01", 10)); // dernier jour : 09-10
    const s = recordActivity(ten, "2026-09-12");
    expect(s).toMatchObject({ current: 11, freezesAvailable: 0 });
  });

  it("une absence déclarée ne casse pas la série et ne coûte rien", () => {
    const base = play(emptyStreak(), ["2026-09-01", "2026-09-02"]);
    const s = recordActivity({ ...base, frozenUntil: "2026-09-08" }, "2026-09-09");
    expect(s).toMatchObject({ current: 3, freezesAvailable: 0, frozenUntil: null });
  });

  it("ignore une date antérieure (horloge déréglée)", () => {
    const base = play(emptyStreak(), ["2026-09-05"]);
    expect(recordActivity(base, "2026-09-01")).toBe(base);
  });
});
