import { emptyStreak, localDay } from "@parlo/core";
import { ApiError, getMe, hasAccessToken, patchProfile, postEvents, refreshSession, type EventBatchResult, type MeResponse, type ProfilePatch } from "./api.ts";
import { db, getKv, setKv, type OutboxRow, type Totals } from "./db.ts";
import { activePackCode } from "./packs/active.ts";

/**
 * Synchronisation de l'outbox (ADR 0004, spec §8.2, contrat phase5 §4).
 * - Lots de ≤ 500 événements, dans l'ordre d'émission (ids UUID v7 triés).
 * - Acceptés et refus définitifs supprimés ; refus consignés dans `syncLog`.
 * - Lot empoisonné (réponse 500) : le lot est scindé en deux et renvoyé ; un événement seul qui
 *   échoue 3 fois est mis en quarantaine dans `syncLog` (raison `quarantined`).
 * - Échec réseau ou serveur indisponible (502/503/504, 429) : nouvel essai avec délai exponentiel.
 * - Outbox vidée : on relit /me, le serveur fait foi pour les totaux.
 */

export const SYNC_BATCH_SIZE = 500;
/** Refus qui peuvent se résoudre seuls (horloge client en avance) : l'événement reste. */
export const TRANSIENT_REJECTIONS: ReadonlySet<string> = new Set(["occurred_at_in_future"]);
/** Échecs d'un événement seul avant quarantaine. */
export const POISON_MAX_FAILURES = 3;
export const QUARANTINE_REASON = "quarantined";
const POISON_KEY = "sync.poison";
/** Réglages de profil pas encore envoyés (PATCH /me/profile), fusionnés. */
export const PROFILE_PATCH_KEY = "profile.pendingPatch";

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
/** Émis après une relecture de /me qui a mis à jour le compte stocké (rôles, email vérifié). */
export const ACCOUNT_UPDATED_EVENT = "parlo:account-updated";

/**
 * Erreur de l'API elle-même (réponse JSON) sur le contenu du lot, pas une indisponibilité : on scinde.
 * 502/503/504 et les 5xx sans corps JSON (proxy, passerelle) sont traités comme une panne : délai.
 */
function isPoisonError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 500 && ![502, 503, 504].includes(error.status) && error.body !== null;
}

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

  /** `force` ignore le délai d'attente (retour en ligne, inscription, fin de séance). */
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
        const result = await this.send(rows);
        accepted += result.accepted;
        rejected += result.rejected;
        if (rows.length < this.batchSize) break;
      }
      await flushProfilePatch();
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

  /** Envoie un lot ; sur erreur 500, le scinde en deux (ordre conservé) jusqu'à isoler l'événement fautif. */
  private async send(rows: OutboxRow[]): Promise<{ accepted: number; rejected: number }> {
    let result: EventBatchResult;
    try {
      result = await postEvents(rows.map((r) => r.event));
    } catch (error) {
      if (!isPoisonError(error)) throw error;
      if (rows.length > 1) {
        const mid = Math.ceil(rows.length / 2);
        const first = await this.send(rows.slice(0, mid));
        const second = await this.send(rows.slice(mid));
        return { accepted: first.accepted + second.accepted, rejected: first.rejected + second.rejected };
      }
      return this.poisoned(rows[0]!, error);
    }
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
    return { accepted: result.accepted.length, rejected: permanent.length };
  }

  private async poisoned(row: OutboxRow, error: unknown): Promise<{ accepted: number; rejected: number }> {
    const counts = await getKv<Record<string, number>>(POISON_KEY, {});
    const n = (counts[row.id] ?? 0) + 1;
    if (n < POISON_MAX_FAILURES) {
      await setKv(POISON_KEY, { ...counts, [row.id]: n });
      throw error;
    }
    const { [row.id]: _done, ...rest } = counts;
    const d = db();
    await d.transaction("rw", d.outbox, d.syncLog, async () => {
      await d.outbox.delete(row.id);
      await d.syncLog.add({ eventId: row.id, eventType: row.event.type, reason: QUARANTINE_REASON, at: new Date(this.now()).toISOString() });
    });
    await setKv(POISON_KEY, rest);
    return { accepted: 0, rejected: 1 };
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

// ---------------------------------------------------------------------------
// Profil (contrat phase5 §4) : PATCH /me/profile à l'inscription puis à chaque changement.

/** Mémorise un changement de profil et tente l'envoi (compte seulement ; hors ligne : au prochain flush). */
export async function queueProfilePatch(patch: ProfilePatch): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  if (!(await getKv<unknown>(ACCOUNT_KEY, null)) && !hasAccessToken()) return;
  const pending = await getKv<ProfilePatch>(PROFILE_PATCH_KEY, {});
  await setKv<ProfilePatch>(PROFILE_PATCH_KEY, { ...pending, ...patch });
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  try {
    await flushProfilePatch();
  } catch {
    // Réessayé au prochain flush de l'outbox.
  }
}

export async function flushProfilePatch(): Promise<void> {
  const pending = await getKv<ProfilePatch | null>(PROFILE_PATCH_KEY, null);
  if (!pending || Object.keys(pending).length === 0) return;
  try {
    await patchProfile(pending);
  } catch (error) {
    // 422 : réglage refusé par le serveur (valeur inconnue) — on ne le renvoie pas indéfiniment.
    if (error instanceof ApiError && error.status === 422) {
      await setKv(PROFILE_PATCH_KEY, {});
      return;
    }
    throw error;
  }
  await setKv(PROFILE_PATCH_KEY, {});
}

type Enrollment = NonNullable<MeResponse["enrollment"]>;

/**
 * Inscription du pack actif (ADR 0006) : l'API peut renvoyer plusieurs `enrollments`
 * (course_id = code de pack) ; les totaux locaux d'un pack ne reprennent que les siens.
 */
export function enrollmentsOf(me: MeResponse): Enrollment[] {
  return me.enrollments ?? (me.enrollment ? [me.enrollment] : []);
}

export async function applyServerState(me: MeResponse): Promise<void> {
  const d = db();
  const pack = activePackCode();
  const enrollments = enrollmentsOf(me);
  const enrollment = enrollments.find((e) => e.courseCode === pack) ?? null;
  let accountUpdated = false;
  await d.transaction("rw", d.kv, async () => {
    const totals = await getKv<Totals>("totals", { xp: 0, streak: emptyStreak() });
    const local = totals.streak;
    const server = me.streak as MeResponse["streak"] & { frozenFrom?: string | null };
    // Outbox vide : le serveur fait foi, annulation du gel comprise (frozenUntil null).
    await setKv<Totals>("totals", {
      xp: enrollment?.xpTotal ?? totals.xp,
      streak: {
        current: server.current,
        longest: server.longest,
        lastActiveDate: server.lastActiveDate,
        freezesAvailable: server.freezesAvailable,
        frozenUntil: server.frozenUntil,
        frozenFrom: server.frozenFrom !== undefined ? server.frozenFrom : server.frozenUntil !== null && server.frozenUntil === local.frozenUntil ? (local.frozenFrom ?? null) : null,
      },
    });
    if (me.dailyGoal) {
      const activity = await getKv<{ date: string; seconds: number } | null>("activity", null);
      const localSeconds = activity?.date === me.dailyGoal.localDate ? activity.seconds : 0;
      await setKv("activity", { date: me.dailyGoal.localDate, seconds: Math.max(localSeconds, me.dailyGoal.doneTodayMin * 60) });
    }
    // Badges du serveur (défis compris) : fusionnés dans le pack inscrit (pas dans une autre langue que l'apprenant commence).
    if (me.badges && (enrollment || enrollments.length === 0)) {
      const localBadges = await getKv<{ code: string; earnedAt: string }[]>("badges", []);
      const known = new Set(localBadges.map((b) => b.code));
      await setKv("badges", [...localBadges, ...me.badges.filter((b) => !known.has(b.code))]);
    }
    // Compte : rôles et email vérifié, lisibles hors ligne (visibilité des packs, bandeau de vérification).
    const account = await getKv<Record<string, unknown> | null>(ACCOUNT_KEY, null);
    if (account) {
      accountUpdated = true;
      await setKv(ACCOUNT_KEY, {
        ...account,
        ...(Array.isArray(me.roles) ? { roles: me.roles } : {}),
        ...(typeof me.user.emailVerified === "boolean" ? { emailVerified: me.user.emailVerified } : {}),
      });
    }
  });
  if (accountUpdated && typeof window !== "undefined") window.dispatchEvent(new Event(ACCOUNT_UPDATED_EVENT));
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
