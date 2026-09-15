import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureApi, setAccessToken } from "../api.ts";
import { ParloDB, setDb } from "../db.ts";
import { defaultLeaguesEnabled, getLeaguesEnabled, leagueZone, ordinal, setLeaguesEnabled, weekRemaining } from "./league-store.ts";

let d: ParloDB;
beforeEach(() => {
  d = new ParloDB(`test-${Math.random()}`);
  setDb(d);
});
afterEach(async () => {
  await d.delete();
  setDb(null);
  setAccessToken(null);
});

describe("ligue : garde-fou et préférences", () => {
  it("désactivée par défaut pour famille et racines, activée sinon", async () => {
    expect(defaultLeaguesEnabled("family")).toBe(false);
    expect(defaultLeaguesEnabled("roots")).toBe(false);
    expect(defaultLeaguesEnabled("travel")).toBe(true);
    expect(defaultLeaguesEnabled(null)).toBe(true);
    expect(await getLeaguesEnabled({ motivation: "family" })).toBe(false);
  });

  it("le choix explicite prime et part au serveur (PATCH leaguesEnabled)", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    configureApi({
      base: "/api",
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    setAccessToken("tok");
    await setLeaguesEnabled(true, true);
    expect(await getLeaguesEnabled({ motivation: "family" })).toBe(true);
    expect(calls).toEqual([{ url: "/api/me/profile", method: "PATCH", body: { leaguesEnabled: true } }]);
    await setLeaguesEnabled(false, false);
    expect(await getLeaguesEnabled({ motivation: "travel" })).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("ligue : présentation", () => {
  it("zones : 5 montent, 5 changent de division, bornes 1 et 5 respectées", () => {
    expect(leagueZone(1, 30, 3, 5, 5)).toBe("promote");
    expect(leagueZone(5, 30, 3, 5, 5)).toBe("promote");
    expect(leagueZone(6, 30, 3, 5, 5)).toBe("stay");
    expect(leagueZone(26, 30, 3, 5, 5)).toBe("relegate");
    expect(leagueZone(1, 30, 5, 5, 5)).toBe("stay");
    expect(leagueZone(30, 30, 1, 5, 5)).toBe("stay");
    // Petit groupe : pas de zone de descente qui chevaucherait la montée.
    expect(leagueZone(8, 8, 3, 5, 5)).toBe("stay");
  });

  it("temps restant et ordinaux", () => {
    const now = new Date("2026-09-15T10:00:00Z");
    expect(weekRemaining("2026-09-21T00:00:00Z", now)).toEqual({ days: 5, hours: 14 });
    expect(weekRemaining("2026-09-14T00:00:00Z", now)).toEqual({ days: 0, hours: 0 });
    expect(ordinal(1, "fr")).toBe("1er");
    expect(ordinal(7, "fr")).toBe("7e");
    expect(["1st", "2nd", "3rd", "4th", "11th", "22nd"]).toEqual([1, 2, 3, 4, 11, 22].map((n) => ordinal(n, "en")));
  });
});
