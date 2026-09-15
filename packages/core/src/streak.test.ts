import { describe, expect, it } from "vitest";
import { emptyStreak, recordActivity, streakAt, type Streak } from "./streak.ts";

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

describe("série : gel daté et lecture (contrat phase5 §3)", () => {
  it("le gel ne couvre que les jours ≥ frozenFrom : pas de réparation rétroactive", () => {
    const base = play(emptyStreak(), days("2026-09-01", 5)); // dernier jour actif : 09-05
    // Déclaré le 09-08 (après 2 jours manqués), gelé jusqu'au 09-10 : 09-06 et 09-07 restent découverts.
    const late = recordActivity({ ...base, frozenUntil: "2026-09-10", frozenFrom: "2026-09-08" }, "2026-09-11");
    expect(late.current).toBe(1);
    // Déclaré le 09-06 : toute l'absence est couverte.
    const onTime = recordActivity({ ...base, frozenUntil: "2026-09-10", frozenFrom: "2026-09-06" }, "2026-09-11");
    expect(onTime).toMatchObject({ current: 6, frozenUntil: null, frozenFrom: null });
  });

  it("lecture : série à 0 après des jours manqués non couverts, intacte sinon", () => {
    const base = play(emptyStreak(), days("2026-09-01", 11)); // 11 jours, 1 protection, dernier 09-11
    expect(base.freezesAvailable).toBe(1);
    expect(streakAt(base, "2026-09-12").current).toBe(11);
    expect(streakAt(base, "2026-09-13").current).toBe(11); // 1 jour manqué, 1 protection
    expect(streakAt(base, "2026-09-14").current).toBe(0);
    expect(streakAt({ ...base, frozenUntil: "2026-09-20", frozenFrom: "2026-09-12" }, "2026-09-18").current).toBe(11);
    expect(streakAt({ ...base, frozenUntil: "2026-09-20", frozenFrom: "2026-09-13" }, "2026-09-18").current).toBe(11);
    expect(streakAt({ ...base, frozenUntil: "2026-09-20", frozenFrom: "2026-09-15" }, "2026-09-18").current).toBe(0);
    expect(streakAt(emptyStreak(), "2026-09-18").current).toBe(0);
  });
});
