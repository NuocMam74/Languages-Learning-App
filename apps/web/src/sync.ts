import { emptyStreak, localDay } from "@parlo/core";
import { ApiError, getMe, hasAccessToken, postEvents, refreshSession, type MeResponse } from "./api.ts";
import { db, getKv, setKv, type Totals } from "./db.ts";

/**
 * Synchronisation de l'outbox (ADR 0004, spec §8.2).
 * - Lots de ≤ 500 événements, dans l'ordre d'émission (ids UUID v7 triés).
 * - Acceptés et refus définitifs supprimés ; refus consignés dans `syncLog`.
 * - Échec réseau ou serveur : nouvel essai avec délai exponentiel.
 * - Outbox vidée : on relit /me, le serveur fait foi pour les totaux.
 */

export const SYNC_BATCH_SIZE = 500;
/** Refus qui peuvent se résoudre seuls (horloge client en avance) : l'événement reste. */
export const TRANSIENT_REJECTIONS: ReadonlySet<string> = new Set(["occurred_at_in_future"]);

export type SyncResult =
  | { status: "ok"; accepted: number; rejected: number; pulled: boolean }
  | { status: "guest" | "offline" | "unauthenticated" }
  | { status: "backoff"; retryInMs: number }
  | { status: "error"; retryInMs: number };

export interface SyncEngineOptions {
  batchSize?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  isOnline?: () => boolean;
}

export const ACCOUNT_KEY = "account";

export class SyncEngine {
  failures = 0;
  nextAttemptAt = 0;
  private running: Promise<SyncResult> | null = null;
  private readonly batchSize: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;

  constructor(options: SyncEngineOptions = {}) {
    this.batchSize = Math.min(options.batchSize ?? SYNC_BATCH_SIZE, SYNC_BATCH_SIZE);
    this.baseDelayMs = options.baseDelayMs ?? 2_000;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
    this.now = options.now ?? (() => Date.now());
    this.isOnline = options.isOnline ?? (() => navigator.onLine);
  }

  delayFor(failures: number): number {
    return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, failures - 1));
  }

  /** `force` ignore le délai d'attente (retour en ligne, inscription). */
  flush(options: { force?: boolean } = {}): Promise<SyncResult> {
    this.running ??= this.run(options.force ?? false).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(force: boolean): Promise<SyncResult> {
    if (!force && this.now() < this.nextAttemptAt) return { status: "backoff", retryInMs: this.nextAttemptAt - this.now() };
    if (!this.isOnline()) return { status: "offline" };
    if (!(await getKv<unknown>(ACCOUNT_KEY, null)) && !hasAccessToken()) return { status: "guest" };

    let accepted = 0;
    let rejected = 0;
    let lastId = "";
    try {
      for (;;) {
        const rows = await db().outbox.where("id").above(lastId).limit(this.batchSize).toArray();
        if (rows.length === 0) break;
        lastId = rows.at(-1)?.id ?? lastId;

        const result = await postEvents(rows.map((r) => r.event));
        const types = new Map(rows.map((r) => [r.id, r.event.type]));
        const permanent = result.rejected.filter((r) => !TRANSIENT_REJECTIONS.has(r.reason));
        const at = new Date(this.now()).toISOString();
        const d = db();
        await d.transaction("rw", d.outbox, d.syncLog, async () => {
          await d.outbox.bulkDelete([...result.accepted, ...permanent.map((r) => r.id)]);
          if (permanent.length > 0) {
            await d.syncLog.bulkAdd(permanent.map((r) => ({ eventId: r.id, eventType: types.get(r.id) ?? "unknown", reason: r.reason, at })));
          }
        });
        accepted += result.accepted.length;
        rejected += permanent.length;
        if (rows.length < this.batchSize) break;
      }
    } catch (error) {
      // Session expirée et refresh refusé : pas de délai, on attend une reconnexion.
      if (error instanceof ApiError && error.status === 401) return { status: "unauthenticated" };
      // Réseau, 5xx, 429, refus du lot entier : on réessaiera plus tard, sans marteler le serveur.
      return this.fail();
    }

    this.failures = 0;
    this.nextAttemptAt = 0;
    const pulled = await this.pull();
    return { status: "ok", accepted, rejected, pulled };
  }

  private fail(): SyncResult {
    this.failures++;
    const retryInMs = this.delayFor(this.failures);
    this.nextAttemptAt = this.now() + retryInMs;
    return { status: "error", retryInMs };
  }

  /** Relit /me quand plus rien n'attend l'envoi : le serveur fait foi pour les totaux. */
  private async pull(): Promise<boolean> {
    const pending = await db().outbox.count();
    if (pending > 0) return false;
    try {
      await applyServerState(await getMe(localDay(new Date(this.now()))));
      return true;
    } catch {
      return false;
    }
  }
}

export async function applyServerState(me: MeResponse): Promise<void> {
  const d = db();
  await d.transaction("rw", d.kv, async () => {
    const totals = await getKv<Totals>("totals", { xp: 0, streak: emptyStreak() });
    const local = totals.streak;
    // La déclaration « je pars quelques jours » reste locale tant que l'API ne la reçoit pas.
    const frozenUntil = [local.frozenUntil, me.streak.frozenUntil].filter((v): v is string => v !== null).sort().at(-1) ?? null;
    await setKv<Totals>("totals", {
      xp: me.enrollment?.xpTotal ?? totals.xp,
      streak: {
        current: me.streak.current,
        longest: me.streak.longest,
        lastActiveDate: me.streak.lastActiveDate,
        freezesAvailable: me.streak.freezesAvailable,
        frozenUntil,
      },
    });
    if (me.dailyGoal) {
      const activity = await getKv<{ date: string; seconds: number } | null>("activity", null);
      const local = activity?.date === me.dailyGoal.localDate ? activity.seconds : 0;
      await setKv("activity", { date: me.dailyGoal.localDate, seconds: Math.max(local, me.dailyGoal.doneTodayMin * 60) });
    }
    if (me.badges) {
      const localBadges = await getKv<{ code: string; earnedAt: string }[]>("badges", []);
      const known = new Set(localBadges.map((b) => b.code));
      await setKv("badges", [...localBadges, ...me.badges.filter((b) => !known.has(b.code))]);
    }
  });
}

export const syncEngine = new SyncEngine();

/** Branche la synchronisation sur le cycle de vie de l'app. Retourne la fonction de nettoyage. */
export function startSync(engine: SyncEngine = syncEngine): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (result: SyncResult) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (result.status === "error" || result.status === "backoff") {
      timer = setTimeout(() => void engine.flush().then(schedule), result.retryInMs);
    }
  };
  const run = (force = false) => void engine.flush({ force }).then(schedule, () => undefined);
  const onOnline = () => run(true);
  const onVisible = () => {
    if (document.visibilityState === "visible") run();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  // Au démarrage : récupère un jeton si un compte existe (cookie), puis envoie.
  void (async () => {
    if (!hasAccessToken() && navigator.onLine && (await getKv<unknown>(ACCOUNT_KEY, null))) await refreshSession();
    run(true);
  })();

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    if (timer) clearTimeout(timer);
  };
}
