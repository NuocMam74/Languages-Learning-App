import { mergeCards } from "@parlo/core";
import { getMeState, hasAccessToken, refreshSession, type MeStateDto } from "./api.ts";
import { db, getKv, withoutPack, type LessonProgressRow, type Profile, type Totals } from "./db.ts";
import { DEFAULT_PROFILE, type EarnedBadge, type PlacementRecord } from "./learner.ts";
import { activePackCode, scopedKey } from "./packs/active.ts";
import { ACCOUNT_KEY } from "./sync.ts";

/**
 * Restauration de la progression depuis le serveur (contrat phase5 §4) : `GET /me/state?pack=`.
 * À la connexion, et au démarrage quand un compte est connecté avec une base locale vide
 * (nouvel appareil, réinstallation). Fusion : progression = max, cartes = mergeCards,
 * badges = union. Un compte inscrit à ce pack ne repasse ni par l'onboarding ni par le placement.
 * Écrit sans événement : ces données viennent du serveur.
 */

export const STATE_RESTORED_EVENT = "parlo:state-restored";

const REMINDER_BY_HOUR = (hour: number | null | undefined): Profile["reminder"] =>
  hour === null || hour === undefined ? null : hour < 11 ? "morning" : hour < 15 ? "noon" : "evening";

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Le compte est-il inscrit à ce pack (progression, placement ou XP côté serveur) ? */
export function isEnrolled(state: MeStateDto): boolean {
  return state.enrolled ?? (state.lessonProgress.length > 0 || state.srsCards.length > 0 || state.xpTotal > 0 || state.placement !== null);
}

export async function applyRestoredState(pack: string, state: MeStateDto, now = new Date()): Promise<{ enrolled: boolean }> {
  const d = db();
  const kv = <T>(key: string, fallback: T) => d.kv.get(scopedKey(key, pack)).then((r) => (r ? (r.value as T) : fallback));
  const put = (key: string, value: unknown) => d.kv.put({ key: scopedKey(key, pack), value });
  const enrolled = isEnrolled(state);

  await d.transaction("rw", [d.kv, d.srsCards, d.lessonProgress, d.outbox], async () => {
    // Progression des leçons : meilleur score et nombre d'essais maximaux.
    const localRows = new Map((await d.lessonProgress.where("packCode").equals(pack).toArray()).map((r) => [r.lessonId, r]));
    const rows: LessonProgressRow[] = state.lessonProgress.map((remote) => {
      const local = localRows.get(remote.lessonId);
      return {
        lessonId: remote.lessonId,
        packCode: pack,
        status: "completed",
        bestScore: Math.max(local?.bestScore ?? 0, remote.bestScore),
        attempts: Math.max(local?.attempts ?? 0, remote.attempts),
        completedAt: local?.completedAt ?? remote.completedAt,
      };
    });
    await d.lessonProgress.bulkPut(rows);

    // Cartes SRS : l'état le plus avancé gagne (ADR 0003).
    const ids = state.srsCards.map((c) => c.conceptId);
    const locals = new Map((await d.srsCards.bulkGet(ids)).flatMap((c) => (c ? [[c.conceptId, withoutPack(c)] as const] : [])));
    await d.srsCards.bulkPut(state.srsCards.map((remote) => {
      const local = locals.get(remote.conceptId);
      return { ...(local ? mergeCards(local, remote) : remote), packCode: pack };
    }));

    // Badges : union.
    const badges = await kv<EarnedBadge[]>("badges", []);
    const known = new Set(badges.map((b) => b.code));
    await put("badges", [...badges, ...state.badges.filter((b) => !known.has(b.code)).map((b) => ({ code: b.code, earnedAt: b.earnedAt }))]);

    // Placement : celui du serveur si l'appareil n'en a pas.
    const placement = await kv<PlacementRecord | null>("placement", null);
    if (!placement && state.placement) {
      await put("placement", { levelEstimate: state.placement.levelEstimate, entryLessonId: state.placement.entryLessonId, completedAt: now.toISOString() } satisfies PlacementRecord);
    }

    // Totaux : XP maximale ; série du serveur si l'appareil n'a rien de plus récent à envoyer.
    const totals = await kv<Totals | null>("totals", null);
    const pending = await d.outbox.count();
    const serverStreak = { ...state.streak, frozenFrom: state.streak.frozenFrom ?? null };
    await put("totals", {
      xp: Math.max(totals?.xp ?? 0, state.xpTotal),
      streak: totals && pending > 0 && (totals.streak.lastActiveDate ?? "") > (state.streak.lastActiveDate ?? "") ? totals.streak : serverStreak,
    } satisfies Totals);

    // Profil : le compte inscrit n'est pas renvoyé vers l'onboarding.
    const profile = await kv<Profile | null>("profile", null);
    if (enrolled && !profile?.onboardedAt) {
      const remote = state.profile ?? {};
      const goal = [5, 10, 15, 20].includes(remote.dailyGoalMin ?? 0) ? (remote.dailyGoalMin as Profile["dailyGoalMin"]) : (profile?.dailyGoalMin ?? DEFAULT_PROFILE.dailyGoalMin);
      await put("profile", {
        motivation: pick(remote.motivation, ["family", "travel", "work", "roots", "curiosity"] as const) ?? profile?.motivation ?? null,
        entourage: pick(remote.entourage, ["nobody", "partner", "parents", "colleagues"] as const) ?? profile?.entourage ?? null,
        selfLevel: pick(remote.selfLevel, ["none", "words", "understand", "speak"] as const) ?? profile?.selfLevel ?? null,
        dailyGoalMin: goal,
        reminder: pick(remote.reminder, ["morning", "noon", "evening", "none"] as const) ?? REMINDER_BY_HOUR(remote.reminderHour) ?? profile?.reminder ?? null,
        onboardedAt: remote.onboardedAt ?? now.toISOString(),
      } satisfies Profile);
    }
  });
  return { enrolled };
}

/** Récupère et fusionne l'état du serveur pour le pack actif. false si indisponible (hors ligne, route absente). */
export async function restoreFromServer(pack: string = activePackCode(), { notify = true }: { notify?: boolean } = {}): Promise<boolean> {
  try {
    const state = await getMeState(pack);
    await applyRestoredState(pack, state);
    // L'app relit contenu et profil (sauf au démarrage, qui les lit juste après).
    if (notify) window.dispatchEvent(new Event(STATE_RESTORED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Base locale vide pour ce pack : ni leçon, ni carte, ni profil terminé. */
export async function isLocalPackEmpty(pack: string = activePackCode()): Promise<boolean> {
  const d = db();
  const [lessons, cards, profile] = await Promise.all([
    d.lessonProgress.where("packCode").equals(pack).count(),
    d.srsCards.where("packCode").equals(pack).count(),
    d.kv.get(scopedKey("profile", pack)),
  ]);
  return lessons === 0 && cards === 0 && !(profile?.value as Profile | undefined)?.onboardedAt;
}

/**
 * Au démarrage : compte connu, en ligne, base locale vide → restauration (bornée dans le temps :
 * l'app démarre quoi qu'il arrive).
 */
export async function restoreOnStart(timeoutMs = 4000): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  if (!(await getKv<unknown>(ACCOUNT_KEY, null))) return false;
  if (!(await isLocalPackEmpty())) return false;
  const attempt = (async () => {
    if (!hasAccessToken() && (await refreshSession()) !== "ok") return false;
    return restoreFromServer(activePackCode(), { notify: false });
  })();
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([attempt, timeout]);
}
