import { patchProfile } from "../api.ts";
import { getKv, setKv, type Profile } from "../db.ts";
import { getLeague, type LeagueDto } from "../social/social-api.ts";

/**
 * Ligue (spec §5.3, contrat phase3 §2). Garde-fou produit : désactivable, et
 * désactivée par défaut pour les motivations « famille » et « racines ».
 * Le choix est gardé localement (lecture hors ligne, hub) et poussé au serveur
 * via PATCH /me/profile {leaguesEnabled} quand un compte existe.
 */

const ENABLED_KEY = "leagues.enabled";
const UNSYNCED_KEY = "leagues.unsynced";

export const LEAGUE_OPT_OUT_MOTIVATIONS: ReadonlySet<Profile["motivation"]> = new Set(["family", "roots"]);

export function defaultLeaguesEnabled(motivation: Profile["motivation"]): boolean {
  return !LEAGUE_OPT_OUT_MOTIVATIONS.has(motivation);
}

/** Choix explicite de l'apprenant, sinon défaut selon la motivation. */
export async function getLeaguesEnabled(profile: Pick<Profile, "motivation">): Promise<boolean> {
  const stored = await getKv<boolean | null>(ENABLED_KEY, null);
  return stored ?? defaultLeaguesEnabled(profile.motivation);
}

/** Enregistre le choix ; tente l'envoi au serveur, sinon le garde pour `syncLeaguesPref`. */
export async function setLeaguesEnabled(enabled: boolean, signedIn: boolean): Promise<void> {
  await setKv(ENABLED_KEY, enabled);
  clearLeagueCache();
  if (!signedIn) return;
  await setKv(UNSYNCED_KEY, true);
  await syncLeaguesPref();
}

export async function syncLeaguesPref(): Promise<void> {
  if (!(await getKv<boolean>(UNSYNCED_KEY, false))) return;
  const enabled = await getKv<boolean | null>(ENABLED_KEY, null);
  if (enabled === null) return;
  try {
    await patchProfile({ leaguesEnabled: enabled });
    await setKv(UNSYNCED_KEY, false);
  } catch {
    // Hors ligne ou session expirée : nouvel essai au prochain affichage.
  }
}

/** Dernier classement lu (hub et ligue) : évite un second appel au retour sur le hub. */
let cached: { at: number; league: LeagueDto } | null = null;
const CACHE_MS = 60_000;

export async function fetchLeague(force = false): Promise<LeagueDto> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.league;
  const league = await getLeague();
  cached = { at: Date.now(), league };
  return league;
}

export function clearLeagueCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Présentation (pur)

export type LeagueZone = "promote" | "relegate" | "stay";

/**
 * Zone d'un rang. Hypothèse : division 1 = entrée, 5 = sommet ; pas de montée
 * depuis 5 ni de descente depuis 1 (bornes 1..5 du contrat).
 */
export function leagueZone(rank: number, count: number, division: number, promoteTop: number, relegateBottom: number): LeagueZone {
  if (division < 5 && rank <= promoteTop) return "promote";
  if (division > 1 && count > promoteTop + relegateBottom && rank > count - relegateBottom) return "relegate";
  return "stay";
}

/** Temps restant avant la fin de semaine (jamais négatif). */
export function weekRemaining(weekEnd: string, now = new Date()): { days: number; hours: number } {
  const ms = Math.max(0, Date.parse(weekEnd) - now.getTime());
  const totalHours = Math.floor(ms / 3_600_000);
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24 };
}

/** Rang ordinal : « 1er », « 7e » ; « 1st », « 7th ». */
export function ordinal(n: number, locale: "fr" | "en"): string {
  if (locale === "fr") return n === 1 ? "1er" : `${n}e`;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
