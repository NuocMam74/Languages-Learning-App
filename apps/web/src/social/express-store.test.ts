import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureApi, setAccessToken } from "../api.ts";
import { ParloDB, setDb } from "../db.ts";
import { expressInput, expressScore, flushExpressQueue, getExpressLocalBest, getExpressQueue, saveExpressLocalBest, submitExpressScore } from "./express-store.ts";

let d: ParloDB;
let calls: { url: string; body: unknown }[];
let mode: "ok" | "down" = "ok";

beforeEach(() => {
  d = new ParloDB(`test-${Math.random()}`);
  setDb(d);
  calls = [];
  mode = "ok";
  configureApi({
    base: "/api",
    fetch: async (url, init) => {
      if (mode === "down") throw new TypeError("Failed to fetch");
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ best: 140, rankToday: 3 }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  setAccessToken("tok");
});
afterEach(async () => {
  await d.delete();
  setDb(null);
  setAccessToken(null);
});

describe("défi express", () => {
  it("score = justes × 10 + bonus de vitesse", () => {
    expect(expressScore({ correct: 8, total: 10, points: 112 })).toBe(112);
    expect(expressScore({ correct: 3, total: 3, points: 0 })).toBe(30);
    expect(expressInput({ correct: 8, total: 10, points: 112 }, "2026-09-15")).toEqual({ game: "cho_noi", score: 112, correct: 8, total: 10, localDate: "2026-09-15" });
  });

  it("en ligne : envoyé ; hors ligne : en file, puis vidé au retour du réseau", async () => {
    const input = expressInput({ correct: 5, total: 6, points: 62 }, "2026-09-15");
    expect(await submitExpressScore(input, { signedIn: true, online: true })).toEqual({ status: "posted", result: { best: 140, rankToday: 3 } });
    expect(calls).toEqual([{ url: "/api/challenges/express/scores", body: input }]);

    expect(await submitExpressScore(input, { signedIn: true, online: false })).toEqual({ status: "queued" });
    mode = "down";
    expect(await submitExpressScore({ ...input, score: 70 }, { signedIn: true, online: true })).toEqual({ status: "queued" });
    expect(await getExpressQueue()).toHaveLength(2);
    expect(await flushExpressQueue()).toBe(0);
    expect(await getExpressQueue()).toHaveLength(2);

    mode = "ok";
    expect(await flushExpressQueue()).toBe(2);
    expect(await getExpressQueue()).toEqual([]);
    expect(calls.slice(1).map((c) => (c.body as { score: number }).score)).toEqual([62, 70]);
  });

  it("invité : rien n'est envoyé ni mis en file ; meilleur score local gardé", async () => {
    const input = expressInput({ correct: 5, total: 6, points: 62 }, "2026-09-15");
    expect(await submitExpressScore(input, { signedIn: false, online: true })).toEqual({ status: "guest" });
    expect(await getExpressQueue()).toEqual([]);
    expect(calls).toEqual([]);
    await saveExpressLocalBest(62);
    await saveExpressLocalBest(40);
    expect(await getExpressLocalBest()).toBe(62);
  });
});
