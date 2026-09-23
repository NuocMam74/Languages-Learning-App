import {
  compareHalves,
  dailySeries,
  lastDays,
  levelForXp,
  localDay,
  regularity,
  seedWeeklyLog,
  seriesTotals,
  skillShares,
  skillSummary,
  STATS_WINDOW_DAYS,
  themeDetail,
  weeklySeries,
  weeklyTotals,
  weeksOfMonths,
  type Comparison,
  type ContentIndex,
  type DayPoint,
  type HistoryMonths,
  type Localized,
  type SeriesTotals,
  type SkillShare,
  type SkillSummary,
  type ThemeDetail,
  type WeeklyLog,
  type WeeklyTotals,
  type WeekPoint,
} from "@parlo/core";
import { db } from "../db.ts";
import { getActivityLog, getSkillStats, getTotals, getWeeklyLog, packCards, progressState } from "../learner.ts";
import { activePackCode } from "../packs/active.ts";
import { acquired, certificateCount, examScores, streakView, type AcquiredCounts, type StreakView } from "../profile/data.ts";
import { packMarks, type MarksView } from "../profile/marks.ts";

/**
 * Données de l'écran Statistiques (contrat phase23 §1).
 *
 * Tout se lit **en local**, comme le profil : l'écran doit être complet en mode invité et hors
 * ligne. Le serveur n'apporte rien ici — il a déjà les événements, et une statistique qu'on ne
 * peut pas consulter dans le métro ne sert à personne.
 *
 * Une seule lecture par visite : les agrégats (`stats`, `activityLog`) sont déjà calculés à chaque
 * réponse, il n'y a donc rien à recalculer — on assemble, on ne parcourt pas l'historique.
 */

export interface StatsView {
  /** Fenêtre lue, du plus ancien au plus récent (jours creux compris). */
  series: DayPoint[];
  totals: SeriesTotals;
  /** Seconde moitié de la fenêtre contre la première : est-ce que ça monte ? */
  comparison: Comparison;
  /** Part de jours travaillés sur la fenêtre, entre 0 et 1. */
  regularity: number;
  shares: SkillShare[];
  skills: SkillSummary[];
  marks: MarksView;
  counts: AcquiredCounts;
  streak: StreakView;
  xp: number;
  level: ReturnType<typeof levelForXp>;
  /** Niveaux terminés sur niveaux du parcours, et thèmes réussis sur thèmes. */
  lessonsDone: number;
  lessonsTotal: number;
  unitsPassed: number;
  unitsTotal: number;
  /** Volume de réponses notées depuis toujours, toutes compétences confondues. */
  lifetimeAnswers: number;
}

export async function statsView(content: ContentIndex, days = STATS_WINDOW_DAYS, now = new Date()): Promise<StatsView> {
  const pack = content.pack.code;
  const today = localDay(now);
  const [stats, log, streak, totals, marks, certificates, exams] = await Promise.all([
    getSkillStats(pack),
    getActivityLog(pack),
    streakView(pack, now),
    getTotals(),
    packMarks(content),
    certificateCount(),
    // Les examens comptent dans les compétences comme au profil : les deux écrans doivent dire la
    // même chose du même résultat, sinon on ne sait plus lequel croire.
    pack === activePackCode() ? examScores() : Promise.resolve([]),
  ]);
  const counts = await acquired(content, certificates, now);
  const series = dailySeries(stats, log, today, days);

  return {
    series,
    totals: seriesTotals(series),
    comparison: compareHalves(series),
    regularity: regularity(series),
    shares: skillShares(stats, lastDays(today, days)),
    skills: skillSummary(stats, exams),
    marks,
    counts,
    streak,
    xp: totals.xp,
    level: levelForXp(totals.xp),
    lessonsDone: counts.lessons,
    lessonsTotal: content.lessons.size,
    unitsPassed: counts.units,
    unitsTotal: content.curriculum.units.length,
    lifetimeAnswers: Object.values(stats.bySkill).reduce((sum, counts_) => sum + counts_.total, 0),
  };
}

/* ------------------------------------------------------------ Historique long */

/**
 * Matière de l'onglet Historique (contrat phase26 §7), lue une fois : changer de période (3, 6 ou
 * 12 mois) recoupe la même matière, sans relire IndexedDB.
 */
export interface HistoryData {
  today: string;
  /** Journal des semaines, complété à la lecture par les soixante derniers jours. */
  weekly: WeeklyLog;
  /** Jour local de fin de chaque niveau terminé. */
  lessonDays: string[];
}

/** `completedAt` est un instant ISO : ramené au jour local, comme le calendrier (sinon 23 h 30 tombe la veille). */
function lessonDaysOf(rows: readonly { completedAt: string }[]): string[] {
  return rows.flatMap((row) => {
    const date = new Date(row.completedAt);
    return Number.isNaN(date.getTime()) ? [] : [localDay(date)];
  });
}

export async function historyData(content: ContentIndex, now = new Date()): Promise<HistoryData> {
  const pack = content.pack.code;
  const [weekly, stats, log, rows] = await Promise.all([
    getWeeklyLog(pack),
    getSkillStats(pack),
    getActivityLog(pack),
    db().lessonProgress.where("packCode").equals(pack).toArray(),
  ]);
  return { today: localDay(now), weekly: seedWeeklyLog(weekly, stats, log), lessonDays: lessonDaysOf(rows) };
}

export interface HistoryView {
  months: HistoryMonths;
  /** Semaines de la période, à partir de la première dont on sait quelque chose. */
  points: WeekPoint[];
  totals: WeeklyTotals;
  /** Seconde moitié des semaines mesurées contre la première. */
  comparison: Comparison;
  /** La période demandée remonte plus loin que ce qu'on connaît : la série commence plus tard. */
  shortened: boolean;
  /** Première semaine mesurée (réponses, minutes) — avant, seuls les niveaux sont connus. */
  measuredFrom: string | null;
}

export function historyView(data: HistoryData, months: HistoryMonths): HistoryView {
  const weeks = weeksOfMonths(months);
  const points = weeklySeries(data.weekly, data.lessonDays, data.today, weeks);
  return {
    months,
    points,
    totals: weeklyTotals(points),
    comparison: compareHalves(points.filter((p) => p.measured)),
    shortened: points.length < weeks,
    measuredFrom: points.find((p) => p.measured)?.week ?? null,
  };
}

/* ------------------------------------------------------------ Fiche d'un thème */

export interface ResistingWord {
  conceptId: string;
  vi: string;
  gloss: Localized;
  lapses: number;
}

export interface ThemeView {
  detail: ThemeDetail;
  /** Les mots qui résistent, prêts à afficher. Un concept absent de l'index est écarté, pas deviné. */
  resisting: ResistingWord[];
}

export async function themeView(content: ContentIndex, unitId: string): Promise<ThemeView | null> {
  const pack = content.pack.code;
  const [progress, cards] = await Promise.all([progressState(content), packCards(pack)]);
  const detail = themeDetail(content, unitId, progress.scores, cards);
  if (!detail) return null;
  const resisting = detail.resisting.flatMap((word) => {
    const concept = content.concepts.get(word.conceptId);
    return concept ? [{ conceptId: word.conceptId, vi: concept.vi, gloss: concept.gloss, lapses: word.lapses }] : [];
  });
  return { detail, resisting };
}
