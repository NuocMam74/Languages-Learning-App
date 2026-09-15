import { localDay, type Streak } from "@parlo/core";
import { getTutorGreeting, hasAccessToken, NetworkError, postTutorWhy, type WhyInput } from "./api.ts";
import { getKv, setKv } from "./db.ts";
import { getLocale, t } from "./i18n/index.ts";
import { tutorUnavailable } from "./tutor/status.ts";

/**
 * Cô Mai dans l'interface (spec §5.7, Phase 1) : salutation du hub et
 * « pourquoi ? » sur les corrections. Le modèle n'est appelé que par le
 * serveur ; hors ligne ou en invité, on retombe sur des textes d'interface.
 */

interface CachedGreeting {
  date: string;
  locale: string;
  text: string;
}

/** Salutation locale, jamais culpabilisante (spec §5.8). */
export function localGreeting(now: Date, streak: Streak): string {
  const hour = now.getHours();
  const moment = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const hello = t(`tutor.greeting.${moment}`);
  if (streak.current >= 2 && streak.lastActiveDate !== localDay(now)) return `${hello} ${t("tutor.greeting.streak", { n: streak.current })}`;
  if (streak.lastActiveDate === localDay(now)) return `${hello} ${t("tutor.greeting.doneToday")}`;
  return `${hello} ${t("tutor.greeting.default")}`;
}

/** Salutation du serveur (cache local du jour), ou null si indisponible. */
export async function remoteGreeting(now = new Date()): Promise<string | null> {
  const locale = getLocale();
  const today = localDay(now);
  const cached = await getKv<CachedGreeting | null>("tutorGreeting", null);
  if (cached && cached.date === today && cached.locale === locale) return cached.text;
  if (!hasAccessToken() || !navigator.onLine) return null;
  try {
    const { text } = await getTutorGreeting(locale, today);
    if (!text.trim()) return null;
    await setKv<CachedGreeting>("tutorGreeting", { date: today, locale, text });
    return text;
  } catch {
    return null;
  }
}

/** `unavailable` : pas de modèle, ou réponse impossible — repli silencieux sur l'explication du contenu (contrat phase5 §5). */
export type WhyAnswer = { kind: "tutor"; text: string } | { kind: "offline" } | { kind: "unavailable" };

export async function askWhy(input: Omit<WhyInput, "locale">): Promise<WhyAnswer> {
  if (tutorUnavailable()) return { kind: "unavailable" };
  if (!hasAccessToken() || !navigator.onLine) return { kind: "offline" };
  try {
    const { text } = await postTutorWhy({ ...input, locale: getLocale() });
    return text.trim() ? { kind: "tutor", text } : { kind: "unavailable" };
  } catch (error) {
    return error instanceof NetworkError ? { kind: "offline" } : { kind: "unavailable" };
  }
}
