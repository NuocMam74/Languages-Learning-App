import { localDay } from "@parlo/core";
import { getKv, setKv } from "../db.ts";
import { getLocale } from "../i18n/index.ts";
import { getWeeklyDebrief, type WeeklyDebrief } from "./client.ts";

/** Débriefing hebdomadaire de Cô Mai (spec §5.7) : cache local, un par semaine et par langue d'interface. */

const KEY = "tutor.weeklyDebrief";

export interface CachedDebrief {
  locale: string;
  data: WeeklyDebrief;
}

/** Lundi (jour local AAAA-MM-JJ) de la semaine de `now`. */
export function mondayOf(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d);
}

/** Le bilan en cache vaut pour la semaine en cours (tolérance d'un jour : semaine UTC côté serveur). */
export function isCurrentWeek(weekStart: string, now: Date): boolean {
  const monday = new Date(`${mondayOf(now)}T12:00:00`);
  monday.setDate(monday.getDate() - 1);
  return weekStart >= localDay(monday);
}

export async function cachedDebrief(now = new Date()): Promise<WeeklyDebrief | null> {
  const cached = await getKv<CachedDebrief | null>(KEY, null);
  return cached && cached.locale === getLocale() && isCurrentWeek(cached.data.weekStart, now) ? cached.data : null;
}

export async function fetchDebrief(): Promise<WeeklyDebrief> {
  const locale = getLocale();
  const data = await getWeeklyDebrief(locale);
  await setKv<CachedDebrief>(KEY, { locale, data });
  return data;
}
