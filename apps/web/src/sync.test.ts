import { makeEvent, type ParloEvent } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAccount } from "./account.ts";
import { configureApi, setAccessToken } from "./api.ts";
import { getKv, ParloDB, setDb, setKv, type Totals } from "./db.ts";
import { ACCOUNT_KEY, SYNC_BATCH_SIZE, SyncEngine, syncEngine } from "./sync.ts";

/** Synchronisation de l'outbox avec un fetch simulé (spec §8.2, ADR 0004). */

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ME = {
  user: { id: "u1", email: "a@b.c", displayName: "An", locale: "fr", createdAt: "2026-09-01T00:00:00Z", isGuest: false },
  profile: { motivation: null, dailyGoalMin: 10, reminderHour: null, levelEstimate: null, pathVariant: null },
  enrollment: { courseCode: "vi-south", xpTotal: 420, level: 1, currentLessonId: null },
  streak: { current: 4, longest: 9, lastActiveDate: "2026-09-13", freezesAvailable: 1, frozenUntil: null },
  levelEstimate: null,
  badges: [{ code: "streak_7", earnedAt: "2026-09-10T08:00:00Z" }],
  dailyGoal: { targetMin: 10, doneTodayMin: 3.5, localDate: "2026-09-14" },
};

let calls: Call[] = [];
let handler: Handler = () => json(500, {});

function install(h: Handler) {
  handler = h;
  configureApi({
    base: "/api",
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      const call: Call = { url, method: init?.method ?? "GET", auth: headers.get("Authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      return handler(call);
    },
  });
}

/** Serveur simulé : accepte tout, sauf les ids listés. */
function server(reject: Record<string, string> = {}): Handler {
  return (call) => {
    if (call.url.endsWith("/me/events")) {
      const events = (call.body as { events: ParloEvent[] }).events;
      return json(200, {
        accepted: events.filter((e) => !(e.id in reject)).map((e) => e.id),
        rejected: events.filter((e) => e.id in reject).map((e) => ({ id: e.id, reason: reject[e.id] })),
      });
    }
    if (call.url.includes("/me?localDate=")) return json(200, ME);
    if (call.url.endsWith("/auth/register")) return json(201, { accessToken: "fresh", tokenType: "bearer", expiresIn: 900 });
    return json(404, { detail: "not found" });
  };
}

async function seed(n: number): Promise<ParloEvent[]> {
  const events = Array.from({ length: n }, (_, i) => makeEvent("session_started", { sessionId: `s${i}`, source: "lesson", plannedSeconds: 300 }));
  await db.outbox.bulkPut(events.map((e) => ({ id: e.id, occurredAt: e.occurredAt, event: e })));
  return events;
}

let db: ParloDB;

beforeEach(async () => {
  db = new ParloDB(`parlo-sync-${Math.random()}`);
  setDb(db);
  calls = [];
  setAccessToken("tok");
  await setKv(ACCOUNT_KEY, { email: "a@b.c", displayName: "An", locale: "fr", linkedAt: "2026-09-01T00:00:00Z" });
});

afterEach(() => {
  setAccessToken(null);
  setDb(null);
});

describe("SyncEngine", () => {
  it("supprime acceptés et refus définitifs, consigne les refus, garde les refus transitoires", async () => {
    const [a, b, c] = await seed(3);
    install(server({ [b!.id]: "unknown_lesson", [c!.id]: "occurred_at_in_future" }));
    const result = await new SyncEngine({ isOnline: () => true }).flush();

    expect(result).toMatchObject({ status: "ok", accepted: 1, rejected: 1, pulled: false });
    expect((await db.outbox.toArray()).map((r) => r.id)).toEqual([c!.id]);
    expect(await db.syncLog.toArray()).toEqual([expect.objectContaining({ eventId: b!.id, eventType: "session_started", reason: "unknown_lesson" })]);
    expect(calls.filter((x) => x.url.endsWith("/me/events"))).toHaveLength(1);
    expect(calls[0]!.auth).toBe("Bearer tok");
    expect(a).toBeDefined();
  });

  it(`envoie par lots de ${SYNC_BATCH_SIZE} maximum, dans l'ordre, puis relit /me (le serveur fait foi)`, async () => {
    const events = await seed(1100);
    install(server());
    const result = await new SyncEngine({ isOnline: () => true }).flush();

    const batches = calls.filter((x) => x.url.endsWith("/me/events")).map((x) => (x.body as { events: ParloEvent[] }).events);
    expect(batches.map((b) => b.length)).toEqual([500, 500, 100]);
    expect(batches.flat().map((e) => e.id)).toEqual(events.map((e) => e.id).sort());
    expect(await db.outbox.count()).toBe(0);
    expect(result).toMatchObject({ status: "ok", accepted: 1100, pulled: true });

    const totals = await getKv<Totals | null>("totals", null);
    expect(totals).toMatchObject({ xp: 420, streak: { current: 4, longest: 9, freezesAvailable: 1 } });
    expect((await getKv<{ code: string }[]>("badges", [])).map((b) => b.code)).toEqual(["streak_7"]);
    expect(await getKv("activity", null)).toEqual({ date: "2026-09-14", seconds: 210 });
  });

  it("401 : rafraîchit le jeton une fois puis rejoue la requête", async () => {
    await seed(2);
    const base = server();
    install((call) => {
      if (call.url.endsWith("/auth/refresh")) return json(200, { accessToken: "renewed", tokenType: "bearer", expiresIn: 900 });
      if (call.url.endsWith("/me/events") && call.auth === "Bearer tok") return json(401, { detail: "expired" });
      return base(call);
    });
    const result = await new SyncEngine({ isOnline: () => true }).flush();

    expect(result.status).toBe("ok");
    expect(calls.map((c) => `${c.method} ${c.url.replace(/\?.*/, "")} ${c.auth ?? "-"}`).slice(0, 3)).toEqual([
      "POST /api/me/events Bearer tok",
      "POST /api/auth/refresh -",
      "POST /api/me/events Bearer renewed",
    ]);
    expect(await db.outbox.count()).toBe(0);
  });

  it("401 et refresh refusé : pas de délai, statut non authentifié, rien de perdu", async () => {
    await seed(1);
    install((call) => (call.url.endsWith("/auth/refresh") ? json(401, { detail: "no" }) : json(401, { detail: "expired" })));
    const engine = new SyncEngine({ isOnline: () => true });
    expect(await engine.flush()).toEqual({ status: "unauthenticated" });
    expect(engine.failures).toBe(0);
    expect(await db.outbox.count()).toBe(1);
  });

  it("échec réseau ou serveur : délai exponentiel, respecté sauf forçage", async () => {
    await seed(1);
    let now = 1_000_000;
    const engine = new SyncEngine({ isOnline: () => true, now: () => now, baseDelayMs: 1000, maxDelayMs: 8000 });
    install(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await engine.flush()).toEqual({ status: "error", retryInMs: 1000 });
    expect(await engine.flush()).toEqual({ status: "backoff", retryInMs: 1000 });
    now += 1000;
    expect(await engine.flush()).toEqual({ status: "error", retryInMs: 2000 });
    install(() => json(503, { detail: "maintenance" }));
    now += 2000;
    expect(await engine.flush()).toEqual({ status: "error", retryInMs: 4000 });
    now += 4000;
    expect(await engine.flush()).toEqual({ status: "error", retryInMs: 8000 });
    now += 8000;
    expect(await engine.flush()).toEqual({ status: "error", retryInMs: 8000 });

    install(server());
    expect((await engine.flush({ force: true })).status).toBe("ok");
    expect(engine.failures).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("invité (aucun compte) ou hors ligne : aucun appel", async () => {
    await seed(1);
    install(server());
    expect(await new SyncEngine({ isOnline: () => false }).flush()).toEqual({ status: "offline" });
    await db.kv.delete(ACCOUNT_KEY);
    setAccessToken(null);
    expect(await new SyncEngine({ isOnline: () => true }).flush()).toEqual({ status: "guest" });
    expect(calls).toHaveLength(0);
  });
});

describe("migration de l'invité", () => {
  it("à l'inscription, toute l'outbox part sous le nouveau compte", async () => {
    await db.kv.delete(ACCOUNT_KEY);
    setAccessToken(null);
    syncEngine.failures = 0;
    syncEngine.nextAttemptAt = 0;
    await seed(620);
    install(server());

    const result = await useAccount.getState().createAccount({ email: "new@parlo.app", password: "correct-horse-1", displayName: "Lan", locale: "fr" });

    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/auth/register", auth: null, body: { email: "new@parlo.app", displayName: "Lan", locale: "fr" } });
    const sent = calls.filter((c) => c.url.endsWith("/me/events"));
    expect(sent.map((c) => (c.body as { events: unknown[] }).events.length)).toEqual([500, 120]);
    expect(sent.every((c) => c.auth === "Bearer fresh")).toBe(true);
    expect(result).toMatchObject({ status: "ok", accepted: 620 });
    expect(await db.outbox.count()).toBe(0);
    expect(useAccount.getState().status).toBe("signed_in");
    expect(await getKv(ACCOUNT_KEY, null)).toMatchObject({ email: "new@parlo.app", displayName: "Lan" });
  });
});
