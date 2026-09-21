import {
  compareHalves,
  dailySeries,
  lastDays,
  levelForXp,
  localDay,
  regularity,
  seriesTotals,
  skillShares,
  skillSummary,
  STATS_WINDOW_DAYS,
  type Comparison,
  type ContentIndex,
  type DayPoint,
  type SeriesTotals,
  type SkillShare,
  type SkillSummary,
} from "@parlo/core";
import { getActivityLog, getSkillStats, getTotals } from "../learner.ts";
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
