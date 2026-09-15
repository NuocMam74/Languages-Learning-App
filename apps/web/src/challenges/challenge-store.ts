import { challengeProgress, localChallengeSpec, optimisticProgress, type Challenge, type ContentIndex } from "@parlo/core";
import { claimChallenge, getCurrentChallenges } from "../api.ts";
import { db, getKv, setKv } from "../db.ts";
import { completedLessons } from "../learner.ts";

/**
 * Défi de la semaine côté PWA.
 * - Compte connecté et en ligne : /challenges/current fait foi (mis en cache).
 * - Hors ligne : dernier défi connu + événements pas encore synchronisés (optimiste).
 * - Invité : défi local déterministe, progression calculée sur tout l'historique local.
 */

export interface ChallengeView {
  challenge: Challenge;
  progress: number;
  source: "server" | "cache" | "local";
}

const CACHE_KEY = "challenges.current";
const LOCAL_CLAIMS_KEY = "challenges.localClaims";

async function pendingEvents() {
  return (await db().outbox.toArray()).map((r) => r.event);
}

export async function loadChallenge(content: ContentIndex, mode: { signedIn: boolean; online: boolean }, now = new Date()): Promise<ChallengeView | null> {
  if (mode.signedIn) {
    let list: Challenge[] | null = null;
    let source: ChallengeView["source"] = "cache";
    if (mode.online) {
      try {
        list = await getCurrentChallenges();
        source = "server";
        await setKv(CACHE_KEY, list);
      } catch {
        list = null;
      }
    }
    list ??= await getKv<Challenge[] | null>(CACHE_KEY, null);
    const current = list?.find((c) => Date.parse(c.periodEnd) > now.getTime()) ?? null;
    if (!current) return null;
    return { challenge: current, progress: optimisticProgress(current, await pendingEvents(), content), source };
  }

  const completed = await completedLessons();
  const spec = localChallengeSpec(now, content, completed);
  const claims = await getKv<Record<string, string>>(LOCAL_CLAIMS_KEY, {});
  const progress = Math.min(spec.target, challengeProgress(spec, await pendingEvents(), content));
  const challenge: Challenge = {
    ...spec,
    title: { fr: "" },
    progress,
    completedAt: progress >= spec.target ? now.toISOString() : null,
    claimedAt: claims[spec.id] ?? null,
  };
  return { challenge, progress, source: "local" };
}

/** Réclame le badge. Retourne l'XP gagnée (0 pour un défi local). */
export async function claim(view: ChallengeView, now = new Date()): Promise<{ claimedAt: string; xp: number }> {
  if (view.source === "local") {
    const claims = await getKv<Record<string, string>>(LOCAL_CLAIMS_KEY, {});
    const claimedAt = now.toISOString();
    await setKv(LOCAL_CLAIMS_KEY, { ...claims, [view.challenge.id]: claimedAt });
    return { claimedAt, xp: 0 };
  }
  const result = await claimChallenge(view.challenge.id);
  const cached = await getKv<Challenge[] | null>(CACHE_KEY, null);
  if (cached) await setKv(CACHE_KEY, cached.map((c) => (c.id === view.challenge.id ? { ...c, claimedAt: result.claimedAt } : c)));
  // Badge de défi attribué par le serveur : visible tout de suite sur la page Badges (contrat phase5 §3).
  const badgeCode = (view.challenge as Challenge & { badgeCode?: string }).badgeCode;
  if (badgeCode) {
    const badges = await getKv<{ code: string; earnedAt: string }[]>("badges", []);
    if (!badges.some((b) => b.code === badgeCode)) await setKv("badges", [...badges, { code: badgeCode, earnedAt: result.claimedAt }]);
  }
  return result;
}
