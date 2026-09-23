import { SKILLS, SKILL_WINDOW_DAYS, type Skill, type SkillStats } from "./skills.ts";
import { dayNumber } from "./streak.ts";

/**
 * Séries de l'écran Statistiques (contrat phase23 §1).
 *
 * Le profil répond à « où j'en suis ». Les statistiques répondent à une autre question, que rien
 * ne traitait : **est-ce que ça avance, et à quel rythme ?** Une moyenne ne le dit pas ; une série
 * de jours, si.
 *
 * Deux principes tiennent tout ce fichier :
 *
 *  - **les jours creux sont des zéros, pas des trous.** Un graphique qui saute les jours sans
 *    séance dessine une régularité qui n'existe pas. Chaque série est remplie jour par jour, y
 *    compris les jours à zéro — c'est précisément ce qu'on vient y lire ;
 *  - **rien n'est inventé au-delà de la fenêtre.** `SkillStats.byDay` ne garde que les 60 derniers
 *    jours (`SKILL_WINDOW_DAYS`) : demander 90 jours ne fabrique pas trente jours de zéros qui
 *    passeraient pour de l'inactivité. La série s'arrête où la mesure s'arrête.
 *
 * Tout est pur : aucune date « maintenant » implicite, aucune lecture de base. Les tests
 * décrivent des journées, pas des horloges.
 */

/** Fenêtre par défaut de l'écran : quatre semaines, la maille où une habitude se voit. */
export const STATS_WINDOW_DAYS = 28;

/** Journal des minutes par jour (`kv` `<pack>:activityLog`) : jour local → secondes travaillées. */
export type ActivityLog = Record<string, number>;

/** Jours conservés dans le journal des minutes : la même fenêtre que les compétences. */
export const ACTIVITY_LOG_DAYS = SKILL_WINDOW_DAYS;

export function normalizeActivityLog(value: unknown): ActivityLog {
  const log: ActivityLog = {};
  for (const [day, seconds] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const n = Number(seconds);
    if (Number.isFinite(n) && n > 0) log[day] = Math.round(n);
  }
  return log;
}

/**
 * Ajoute des secondes à un jour, et borne le journal. Même politique que `pruneSkillStats` : la
 * fenêtre compte des **jours écrits**, jamais un écart de dates — une horloge d'appareil qui
 * recule ne vide pas l'historique, et une longue absence ne l'efface pas non plus.
 */
export function recordActivitySeconds(log: ActivityLog, day: string, seconds: number): ActivityLog {
  const next: ActivityLog = { ...log, [day]: Math.round((log[day] ?? 0) + Math.max(0, seconds)) };
  const days = Object.keys(next).sort();
  if (days.length <= ACTIVITY_LOG_DAYS) return next;
  const drop = days.slice(0, days.length - ACTIVITY_LOG_DAYS);
  for (const old of drop) delete next[old];
  return next;
}

/** Jour local `n` jours avant `day` (arithmétique sur les jours, jamais sur des millisecondes). */
export function shiftDay(day: string, days: number): string {
  const date = new Date(Date.UTC(1970, 0, 1) + (dayNumber(day) + days) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** Les `count` derniers jours, du plus ancien au plus récent, `today` compris. */
export function lastDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDay(today, i - count + 1));
}

/** Une journée de la série : ce qui s'y est passé, zéros compris. */
export interface DayPoint {
  day: string;
  /** Réponses notées, toutes compétences confondues. */
  answers: number;
  correct: number;
  seconds: number;
  /** Part de réussite du jour, `null` s'il n'y a rien eu à réussir. */
  ratio: number | null;
}

/**
 * Série journalière de la fenêtre demandée. Bornée à ce que la mesure couvre réellement :
 * au-delà de `SKILL_WINDOW_DAYS`, les jours n'ont pas été oubliés, ils n'ont jamais été gardés —
 * les afficher à zéro se lirait comme deux mois d'abandon.
 */
export function dailySeries(stats: SkillStats, log: ActivityLog, today: string, days = STATS_WINDOW_DAYS): DayPoint[] {
  return lastDays(today, Math.min(days, SKILL_WINDOW_DAYS)).map((day) => {
    const perSkill = stats.byDay[day] ?? {};
    let answers = 0;
    let correct = 0;
    for (const skill of SKILLS) {
      const counts = perSkill[skill];
      if (!counts) continue;
      answers += counts.total;
      correct += counts.correct;
    }
    return { day, answers, correct, seconds: log[day] ?? 0, ratio: answers > 0 ? correct / answers : null };
  });
}

/** Totaux d'une série : ce que la fenêtre représente en un chiffre. */
export interface SeriesTotals {
  answers: number;
  correct: number;
  seconds: number;
  /** Jours où au moins une réponse a été notée. */
  activeDays: number;
  /** Part de réussite sur toute la fenêtre, `null` si rien n'a été noté. */
  ratio: number | null;
  /** Minutes moyennes par **jour actif** — pas par jour de calendrier : une moyenne diluée par les
   *  jours creux ne dit rien du temps qu'on passe réellement quand on s'y met. */
  minutesPerActiveDay: number | null;
  /** Le jour le plus fourni de la fenêtre (en réponses), `null` si la fenêtre est vide. */
  best: DayPoint | null;
}

export function seriesTotals(series: readonly DayPoint[]): SeriesTotals {
  let answers = 0;
  let correct = 0;
  let seconds = 0;
  let activeDays = 0;
  let best: DayPoint | null = null;
  for (const point of series) {
    answers += point.answers;
    correct += point.correct;
    seconds += point.seconds;
    if (point.answers > 0) activeDays++;
    // À égalité, le jour le plus récent : « ton meilleur jour » doit désigner le dernier élan,
    // pas le premier d'une série de journées identiques.
    if (best === null || point.answers >= best.answers) best = point;
  }
  return {
    answers,
    correct,
    seconds,
    activeDays,
    ratio: answers > 0 ? correct / answers : null,
    minutesPerActiveDay: activeDays > 0 ? seconds / 60 / activeDays : null,
    best: best && best.answers > 0 ? best : null,
  };
}

/** Sens d'évolution d'un indicateur, lu avec une zone morte : le bruit n'est pas une tendance. */
export type Trend = "up" | "flat" | "down" | "unknown";

/** En deçà, la variation n'est pas racontée comme un progrès ni comme un recul. */
export const TREND_DEAD_ZONE = 0.05;

/**
 * Compare la seconde moitié de la fenêtre à la première. `unknown` tant qu'une des deux moitiés
 * n'a pas assez de matière : annoncer « tu progresses » sur trois réponses serait mentir.
 */
export interface Comparison {
  recent: number | null;
  previous: number | null;
  trend: Trend;
}

/** Sous ce nombre de réponses, une moitié de fenêtre ne permet aucune comparaison. */
export const COMPARE_MIN_ANSWERS = 10;

/** Ce dont une comparaison a besoin : des réponses et des réussites, par jour ou par semaine. */
type Tally = Pick<DayPoint, "answers" | "correct">;

export function compareHalves(series: readonly Tally[]): Comparison {
  const half = Math.floor(series.length / 2);
  const sum = (points: readonly Tally[]) =>
    points.reduce((acc, p) => ({ answers: acc.answers + p.answers, correct: acc.correct + p.correct }), { answers: 0, correct: 0 });
  const older = sum(series.slice(0, half));
  const newer = sum(series.slice(half));
  const previous = older.answers >= COMPARE_MIN_ANSWERS ? older.correct / older.answers : null;
  const recent = newer.answers >= COMPARE_MIN_ANSWERS ? newer.correct / newer.answers : null;
  if (previous === null || recent === null) return { recent, previous, trend: "unknown" };
  const delta = recent - previous;
  return { recent, previous, trend: Math.abs(delta) < TREND_DEAD_ZONE ? "flat" : delta > 0 ? "up" : "down" };
}

/** Répartition de l'effort entre les compétences, sur la fenêtre. */
export interface SkillShare {
  skill: Skill;
  answers: number;
  correct: number;
  /** Part des réponses de la fenêtre, entre 0 et 1 ; 0 si rien n'a été fait. */
  share: number;
  ratio: number | null;
}

/**
 * Ce à quoi le temps passe, et ce qui réussit. Les quatre compétences sont **toujours** rendues,
 * dans l'ordre de `SKILLS` : une barre qui disparaît change la hauteur de l'écran, et une
 * compétence jamais travaillée est justement ce qu'on vient chercher ici.
 */
export function skillShares(stats: SkillStats, days: readonly string[]): SkillShare[] {
  const kept = new Set(days);
  const totals = new Map<Skill, { answers: number; correct: number }>(SKILLS.map((skill) => [skill, { answers: 0, correct: 0 }]));
  let all = 0;
  for (const [day, perSkill] of Object.entries(stats.byDay)) {
    if (!kept.has(day)) continue;
    for (const skill of SKILLS) {
      const counts = perSkill[skill];
      if (!counts) continue;
      const acc = totals.get(skill) as { answers: number; correct: number };
      acc.answers += counts.total;
      acc.correct += counts.correct;
      all += counts.total;
    }
  }
  return SKILLS.map((skill) => {
    const acc = totals.get(skill) as { answers: number; correct: number };
    return {
      skill,
      answers: acc.answers,
      correct: acc.correct,
      share: all > 0 ? acc.answers / all : 0,
      ratio: acc.answers > 0 ? acc.correct / acc.answers : null,
    };
  });
}

/**
 * Régularité : jours actifs sur jours de la fenêtre, entre 0 et 1. C'est le chiffre que la série
 * raconte le mieux — apprendre une langue tient plus à la fréquence qu'à la durée des séances.
 */
export function regularity(series: readonly DayPoint[]): number {
  if (series.length === 0) return 0;
  return series.filter((p) => p.answers > 0).length / series.length;
}

/* ------------------------------------------------------------ Historique long */

/**
 * Historique long (contrat phase26 §7). Soixante jours disent si l'on s'y tient cette saison ;
 * ils ne disent pas si l'on a progressé depuis le printemps. Garder chaque jour pendant un an
 * ferait grossir `kv` sans rien apprendre de plus : à cette échelle, la semaine est la bonne maille
 * — elle efface le bruit d'un mauvais mardi et garde le rythme d'une année.
 *
 * Un agrégat par semaine (`kv` `<pack>:weeklyLog`), écrit aux mêmes endroits que les deux journaux
 * de 60 jours : les réponses à chaque réponse notée, les secondes à chaque fin de séance.
 */

/** Une semaine : ce qui y a été noté, et le temps passé. */
export interface WeekCounts {
  answers: number;
  correct: number;
  seconds: number;
}

/** Semaine (son lundi, jour local) → compteurs de la semaine. */
export type WeeklyLog = Record<string, WeekCounts>;

/** Un an et une semaine : la même semaine de l'an dernier reste lisible à côté de celle-ci. */
export const WEEKLY_LOG_WEEKS = 53;

/** Périodes de l'onglet Historique, en mois. */
export const HISTORY_MONTHS = [3, 6, 12] as const;
export type HistoryMonths = (typeof HISTORY_MONTHS)[number];

/** Semaines d'une période : 13, 26 ou 52. */
export const weeksOfMonths = (months: HistoryMonths): number => Math.round((months * 52) / 12);

/**
 * Lundi de la semaine d'un jour local. Arithmétique sur les numéros de jour, comme `shiftDay` :
 * le 1er janvier 1970 était un jeudi, d'où le décalage de 3.
 */
export function mondayOf(day: string): string {
  const offset = (((dayNumber(day) + 3) % 7) + 7) % 7;
  return shiftDay(day, -offset);
}

const positive = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Une valeur lue en base peut venir d'ailleurs (fichier de transfert, version antérieure). */
export function normalizeWeeklyLog(value: unknown): WeeklyLog {
  const log: WeeklyLog = {};
  for (const [week, raw] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || typeof raw !== "object" || raw === null) continue;
    const r = raw as Partial<Record<keyof WeekCounts, unknown>>;
    const answers = positive(r.answers);
    const counts: WeekCounts = { answers, correct: Math.min(answers, positive(r.correct)), seconds: positive(r.seconds) };
    if (counts.answers > 0 || counts.seconds > 0) log[mondayOf(week)] = counts;
  }
  return log;
}

/**
 * Borne le journal aux `WEEKLY_LOG_WEEKS` semaines **écrites**, les plus récentes. Même politique
 * que `recordActivitySeconds` : jamais un écart de dates — une horloge qui recule ne vide pas un an
 * d'historique, et six mois d'absence ne l'effacent pas non plus.
 */
function pruneWeeks(log: WeeklyLog): WeeklyLog {
  const weeks = Object.keys(log).sort();
  if (weeks.length <= WEEKLY_LOG_WEEKS) return log;
  const next = { ...log };
  for (const old of weeks.slice(0, weeks.length - WEEKLY_LOG_WEEKS)) delete next[old];
  return next;
}

function bump(log: WeeklyLog, day: string, delta: Partial<WeekCounts>): WeeklyLog {
  const week = mondayOf(day);
  const prior = log[week] ?? { answers: 0, correct: 0, seconds: 0 };
  return pruneWeeks({
    ...log,
    [week]: {
      answers: prior.answers + (delta.answers ?? 0),
      correct: prior.correct + (delta.correct ?? 0),
      seconds: Math.round(prior.seconds + Math.max(0, delta.seconds ?? 0)),
    },
  });
}

/** Une réponse notée, le jour `day`. */
export function recordWeeklyAnswer(log: WeeklyLog, day: string, correct: boolean): WeeklyLog {
  return bump(log, day, { answers: 1, correct: correct ? 1 : 0 });
}

/** Des secondes de séance, le jour `day` — les mêmes que celles du journal des minutes. */
export function recordWeeklySeconds(log: WeeklyLog, day: string, seconds: number): WeeklyLog {
  return bump(log, day, { seconds });
}

/**
 * Complète le journal des semaines avec les soixante jours déjà mesurés, **à la lecture** : rien
 * n'est réécrit. Sans cela, un apprenant de deux mois ouvrirait son historique sur une semaine.
 *
 * Les deux sources sont des minorants, chacune exacte sur son terrain : le journal des semaines est
 * complet depuis qu'il existe, les journaux de 60 jours le sont sur leur fenêtre. On garde donc,
 * semaine par semaine, **la plus fournie** des deux — jamais leur somme, qui compterait deux fois
 * la même réponse. Réponses et réussites viennent de la même source, pour que le taux reste vrai.
 */
export function seedWeeklyLog(log: WeeklyLog, stats: SkillStats, activity: ActivityLog): WeeklyLog {
  const daily: WeeklyLog = {};
  const at = (day: string): WeekCounts => (daily[mondayOf(day)] ??= { answers: 0, correct: 0, seconds: 0 });
  for (const [day, perSkill] of Object.entries(stats.byDay)) {
    const week = at(day);
    for (const skill of SKILLS) {
      const counts = perSkill[skill];
      if (!counts) continue;
      week.answers += counts.total;
      week.correct += counts.correct;
    }
  }
  for (const [day, seconds] of Object.entries(activity)) at(day).seconds += seconds;

  const merged: WeeklyLog = { ...log };
  for (const [week, seeded] of Object.entries(daily)) {
    if (seeded.answers === 0 && seeded.seconds === 0) continue;
    const kept = merged[week] ?? { answers: 0, correct: 0, seconds: 0 };
    const fuller = seeded.answers > kept.answers ? seeded : kept;
    merged[week] = { answers: fuller.answers, correct: fuller.correct, seconds: Math.round(Math.max(kept.seconds, seeded.seconds)) };
  }
  return pruneWeeks(merged);
}

/** Une semaine de l'historique. */
export interface WeekPoint {
  /** Lundi de la semaine. */
  week: string;
  answers: number;
  correct: number;
  seconds: number;
  /** Niveaux dont la dernière fin tombe cette semaine-là. */
  lessons: number;
  ratio: number | null;
  /**
   * `false` : semaine antérieure à toute mesure des réponses et des minutes. Ce n'est pas un zéro,
   * c'est « on ne sait pas » — seuls les niveaux, datés dans la progression, y sont connus.
   */
  measured: boolean;
}

/**
 * Série hebdomadaire des `weeks` dernières semaines, celle d'aujourd'hui comprise.
 *
 * Les deux règles de la série journalière tiennent ici aussi :
 *
 *  - **une semaine creuse est un zéro** — dès lors qu'on mesurait ;
 *  - **rien n'est inventé avant la première mesure.** La série commence à la première semaine dont
 *    on sait quelque chose (une réponse, des minutes, un niveau terminé). Demander douze mois à qui
 *    a commencé il y a six semaines rend six semaines, pas quarante-six semaines d'abandon. Entre
 *    un niveau daté et le début du journal, la semaine a ses niveaux mais ni réponses ni minutes :
 *    `measured: false`, et les graphiques ne la dessinent pas.
 *
 * `lessonDays` : jour local de fin de chaque niveau (`lessonProgress.completedAt`). C'est ce qui
 * rend l'historique des niveaux complet même pour des données bien antérieures à ce journal.
 */
export function weeklySeries(weekly: WeeklyLog, lessonDays: readonly string[], today: string, weeks: number): WeekPoint[] {
  const current = mondayOf(today);
  const span = Math.max(1, weeks);
  const window = Array.from({ length: span }, (_, i) => shiftDay(current, (i - span + 1) * 7));
  const lessonsByWeek = new Map<string, number>();
  for (const day of lessonDays) {
    const week = mondayOf(day);
    lessonsByWeek.set(week, (lessonsByWeek.get(week) ?? 0) + 1);
  }
  // Une semaine « à venir » (horloge d'appareil qui a avancé puis reculé) ne fixe aucun début.
  const measuredFrom = Object.keys(weekly).filter((week) => week <= current).sort()[0] ?? null;
  const firstLesson = [...lessonsByWeek.keys()].filter((week) => week <= current).sort()[0] ?? null;
  const known = [measuredFrom, firstLesson].filter((w): w is string => w !== null).sort()[0];
  if (known === undefined) return [];

  const none: WeekCounts = { answers: 0, correct: 0, seconds: 0 };
  return window
    .filter((week) => week >= known)
    .map((week) => {
      const measured = measuredFrom !== null && week >= measuredFrom;
      const counts = measured ? (weekly[week] ?? none) : none;
      return {
        week,
        answers: counts.answers,
        correct: counts.correct,
        seconds: counts.seconds,
        lessons: lessonsByWeek.get(week) ?? 0,
        ratio: counts.answers > 0 ? counts.correct / counts.answers : null,
        measured,
      };
    });
}

/** Ce que la période représente, en quelques chiffres. */
export interface WeeklyTotals {
  answers: number;
  correct: number;
  seconds: number;
  lessons: number;
  /** Semaines où au moins une réponse a été notée. */
  activeWeeks: number;
  /** Semaines effectivement mesurées : la base honnête d'une moyenne. */
  measuredWeeks: number;
  ratio: number | null;
  /** Minutes par semaine **mesurée** : une semaine d'avant le journal n'est pas une semaine à zéro. */
  minutesPerWeek: number | null;
}

export function weeklyTotals(points: readonly WeekPoint[]): WeeklyTotals {
  let answers = 0;
  let correct = 0;
  let seconds = 0;
  let lessons = 0;
  let activeWeeks = 0;
  let measuredWeeks = 0;
  for (const point of points) {
    answers += point.answers;
    correct += point.correct;
    seconds += point.seconds;
    lessons += point.lessons;
    if (point.answers > 0) activeWeeks++;
    if (point.measured) measuredWeeks++;
  }
  return {
    answers,
    correct,
    seconds,
    lessons,
    activeWeeks,
    measuredWeeks,
    ratio: answers > 0 ? correct / answers : null,
    minutesPerWeek: measuredWeeks > 0 ? seconds / 60 / measuredWeeks : null,
  };
}
