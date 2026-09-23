import { dailySeries, localDay, mondayOf, seriesTotals, type ContentIndex, type DayPoint } from "@parlo/core";
import { db } from "../db.ts";
import { getActivityLog, getSkillStats } from "../learner.ts";

/**
 * Les chiffres du parcours (contrat phase26 §7) : ce qu'il faut voir **sans** aller aux
 * statistiques — la semaine en cours et les sept derniers jours.
 *
 * Module à part de `data.ts` : le parcours est le premier écran chargé, il ne doit pas embarquer
 * les notes, les examens et les compétences de l'écran Statistiques pour quatre chiffres. Une
 * lecture, trois agrégats déjà tenus à jour à chaque réponse : rien n'est recalculé.
 */

export interface HubKpisView {
  /** Faux avant toute activité : le parcours ne montre pas une rangée de zéros (contrat phase8 §1). */
  active: boolean;
  /** Les sept derniers jours, aujourd'hui compris, jours creux compris. */
  days: DayPoint[];
  /** Secondes travaillées depuis lundi. */
  weekSeconds: number;
  /** Niveaux terminés depuis lundi. */
  weekLessons: number;
  /** Réussite des sept derniers jours ; `null` s'il n'y a rien eu à réussir. */
  accuracy: number | null;
}

export const HUB_KPI_DAYS = 7;

export async function hubKpis(content: ContentIndex, now = new Date()): Promise<HubKpisView> {
  const pack = content.pack.code;
  const today = localDay(now);
  const [stats, log, rows] = await Promise.all([
    getSkillStats(pack),
    getActivityLog(pack),
    db().lessonProgress.where("packCode").equals(pack).toArray(),
  ]);
  const days = dailySeries(stats, log, today, HUB_KPI_DAYS);
  const monday = mondayOf(today);
  const thisWeek = (day: string) => day >= monday && day <= today;
  // `completedAt` est un instant ISO : ramené au jour local, comme le calendrier.
  const lessonDays = rows.flatMap((row) => {
    const date = new Date(row.completedAt);
    return Number.isNaN(date.getTime()) ? [] : [localDay(date)];
  });
  return {
    active: Object.values(stats.bySkill).some((counts) => counts.total > 0) || rows.length > 0 || Object.keys(log).length > 0,
    days,
    weekSeconds: Object.entries(log).reduce((sum, [day, seconds]) => (thisWeek(day) ? sum + seconds : sum), 0),
    weekLessons: lessonDays.filter(thisWeek).length,
    accuracy: seriesTotals(days).ratio,
  };
}
