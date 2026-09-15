import { buildContentIndex, makeEvent, type ContentIndex } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import { ParloDB, setDb, getKv } from "../db.ts";
import { setFreeze } from "../learner.ts";
import { urlBase64ToUint8Array } from "../notifications/push.ts";
import { claim, loadChallenge } from "./challenge-store.ts";

const content: ContentIndex = buildContentIndex(toRaw(readPackFiles("vi-south")));
let d: ParloDB;

beforeEach(() => {
  d = new ParloDB(`test-${Math.random()}`);
  setDb(d);
});
afterEach(async () => {
  await d.delete();
  setDb(null);
});

describe("défi de la semaine (invité)", () => {
  it("progression locale depuis l'outbox, puis réclamation locale", async () => {
    // Lundi 7 septembre 2026 : rotation « lessons » ou autre, on force l'événement adapté au type choisi.
    const now = new Date("2026-09-16T10:00:00Z");
    const first = await loadChallenge(content, { signedIn: false, online: false }, now);
    expect(first?.source).toBe("local");
    expect(first?.progress).toBe(0);

    const events = Array.from({ length: 10 }, (_, i) => {
      const at = new Date(Date.parse("2026-09-14T08:00:00Z") + i * 3_600_000);
      return [
        makeEvent("lesson_completed", { sessionId: "s", lessonId: content.curriculum.units[0]?.lessons[i % 9] ?? "", score: 1, durationMs: 1 }, at),
        makeEvent("game_played", { game: "cho_noi", correct: 9, total: 10, durationMs: 1, localDate: "2026-09-14" }, at),
        makeEvent("pronunciation_scored", { sessionId: null, conceptId: "c_com", score: 80, exerciseType: "speak_repeat" }, at),
        makeEvent("session_completed", { sessionId: "s", xpGained: 1, itemsCount: 1, durationMs: 1, localDate: `2026-09-${14 + (i % 3)}` }, at),
      ];
    }).flat();
    await d.outbox.bulkPut(events.map((event) => ({ id: event.id, occurredAt: event.occurredAt, event })));

    const view = await loadChallenge(content, { signedIn: false, online: false }, now);
    expect(view?.progress).toBeGreaterThan(0);
    const result = await claim(view!, now);
    expect(result.xp).toBe(0);
    const again = await loadChallenge(content, { signedIn: false, online: false }, now);
    expect(again?.challenge.claimedAt).toBe(result.claimedAt);
  });
});

describe("série gelée", () => {
  it("« je pars quelques jours » écrit streak_frozen dans l'outbox", async () => {
    const now = new Date(2026, 8, 15, 10);
    const streak = await setFreeze(3, now);
    expect(streak.frozenUntil).toBe("2026-09-18");
    const rows = await d.outbox.toArray();
    expect(rows.map((r) => r.event)).toEqual([expect.objectContaining({ type: "streak_frozen", payload: { frozenUntil: "2026-09-18", localDate: "2026-09-15" } })]);
    await setFreeze(0, now);
    expect((await getKv<{ streak: { frozenUntil: string | null } }>("totals", { streak: { frozenUntil: "x" } })).streak.frozenUntil).toBeNull();
    expect(await d.outbox.count()).toBe(2);
  });
});

describe("push", () => {
  it("décode la clé VAPID base64url", () => {
    expect([...urlBase64ToUint8Array("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});
