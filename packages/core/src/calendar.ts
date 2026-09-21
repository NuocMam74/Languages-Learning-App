import { weekStart, type Counters, type CountersJournal, type Period } from "./rewards/counters.ts";
import { dayNumber, localDay } from "./streak.ts";
import type { Localized } from "./types.ts";

/**
 * Calendrier d'apprentissage (contrat phase24 §5) : **ce qui est prévu**, et **ce qui a été fait**.
 *
 * Deux moitiés d'une même question. Le programme répond à « qu'est-ce que je fais aujourd'hui ? »
 * — celle qu'on se pose en ouvrant l'application et à laquelle « fais ta séance » répond mal quand
 * on a trois jours devant soi. Le journal répond à « qu'est-ce que j'ai fait mardi ? », qu'on se
 * pose en doutant d'avancer.
 *
 * Trois partis pris :
 *
 *  - **le programme se propose, il ne s'impose pas.** Rien ne se verrouille, rien n'est « en
 *    retard », aucun jour manqué n'est marqué en rouge (spec §5.8). Un plan qui gronde est un plan
 *    qu'on ferme ;
 *  - **il se déduit, il ne se saisit pas.** L'objectif quotidien et les thèmes faibles sont déjà
 *    connus : demander à l'apprenant de composer son planning serait lui redemander ce qu'il a
 *    déjà dit ;
 *  - **il est déterministe.** Même semaine, même appareil hors ligne, même programme : il ne
 *    change pas sous les yeux entre deux ouvertures.
 */

/** Ce qu'un jour du programme propose. Une activité par ligne, jamais une liste de corvées. */
export type PlanKind =
  /** Le niveau du jour : le cœur du parcours. */
  | "lesson"
  /** Le rappel espacé : les mots que la mémoire est sur le point de lâcher. */
  | "review"
  /** Reprendre un thème qui résiste (note < 12/20). */
  | "redo"
  /** Un mini-jeu : la séance du jour sans en avoir l'air. */
  | "game"
  /** Parler avec Cô Mai. */
  | "tutor"
  /** Jour léger assumé : on ne programme pas sept jours sur sept. */
  | "rest";

export interface PlanEntry {
  kind: PlanKind;
  /** Minutes estimées ; 0 pour un jour léger. */
  minutes: number;
  /** Précision affichée : le titre du niveau, le thème à reprendre… */
  title?: Localized;
  /** Cible du lien, quand l'entrée mène quelque part. */
  to?: string;
}

export interface PlanDay {
  day: string;
  /** Index dans la semaine, 0 = lundi. */
  weekday: number;
  entries: PlanEntry[];
}

/**
 * Jours de repos proposés selon l'objectif quotidien. Quelqu'un qui vise 10 minutes ne tiendra pas
 * sept jours sur sept ; lui en programmer sept est le meilleur moyen qu'il en fasse trois et se
 * croie en échec. Le dimanche d'abord, puis le mercredi — les deux jours où l'on décroche le plus.
 */
function restDays(dailyGoalMin: number): ReadonlySet<number> {
  if (dailyGoalMin >= 20) return new Set([6]);
  if (dailyGoalMin >= 15) return new Set([6]);
  return new Set([6, 2]);
}

export interface WeekPlanInput {
  /** Objectif quotidien du profil, en minutes. */
  dailyGoalMin: number;
  /** Prochain niveau du parcours, s'il en reste un. */
  nextLesson: { title: Localized; minutes: number; to: string } | null;
  /** Mots dus au rappel espacé aujourd'hui (le plan en programme un peu chaque jour). */
  dueCount: number;
  /** Thèmes qui résistent, du plus faible au moins faible (contrat phase21 §4). */
  weakThemes: readonly { title: Localized; to: string }[];
  /** Le pack propose-t-il Cô Mai et des jeux ? On ne programme pas ce qui n'existe pas. */
  hasTutor: boolean;
  hasGames: boolean;
}

/**
 * Programme de la semaine. Un jour porte au plus **deux** entrées : la séance du jour et une
 * respiration. Au-delà, ce n'est plus un programme, c'est une liste de courses.
 */
export function weekPlan(period: Period, input: WeekPlanInput): PlanDay[] {
  const rest = restDays(input.dailyGoalMin);
  const reviewMinutes = Math.max(3, Math.round(input.dailyGoalMin / 3));
  let firstLessonPlanned = false;

  return period.days.map((day, index) => {
    const weekday = index % 7;
    const entries: PlanEntry[] = [];

    if (rest.has(weekday)) {
      // Un jour léger reste un jour ouvert : on propose la révision, on n'exige rien.
      entries.push({ kind: "rest", minutes: 0 });
      if (input.dueCount > 0) entries.push({ kind: "review", minutes: reviewMinutes, to: "/revision" });
      return { day, weekday, entries };
    }

    if (input.nextLesson) {
      /**
       * Le niveau n'est **nommé que pour le premier jour travaillé** de la semaine. On sait quel
       * niveau vient ensuite ; on ne sait pas lequel viendra jeudi, puisqu'il dépend de ce qui
       * aura été fait d'ici là. Annoncer « Cinq tons à entendre » sept jours de suite était faux
       * dès le mardi — et un programme qui se trompe de contenu n'est plus consulté.
       */
      const named = !firstLessonPlanned;
      firstLessonPlanned = true;
      entries.push({
        kind: "lesson",
        minutes: input.nextLesson.minutes,
        ...(named ? { title: input.nextLesson.title, to: input.nextLesson.to } : { to: "/seance" }),
      });
    } else {
      entries.push({ kind: "review", minutes: input.dailyGoalMin, to: "/revision" });
    }

    // La seconde entrée tourne dans la semaine : reprendre un thème faible le mardi, jouer le
    // jeudi, parler le vendredi. Un même geste tous les jours lasse ; trois, non.
    const weak = input.weakThemes[0];
    if (weekday === 1 && weak) entries.push({ kind: "redo", minutes: 6, title: weak.title, to: weak.to });
    else if (weekday === 3 && input.hasGames) entries.push({ kind: "game", minutes: 5, to: "/jeux" });
    else if (weekday === 4 && input.hasTutor) entries.push({ kind: "tutor", minutes: 6, to: "/co-mai" });
    else if (input.dueCount > 0 && entries[0]?.kind !== "review") entries.push({ kind: "review", minutes: reviewMinutes, to: "/revision" });

    return { day, weekday, entries };
  });
}

/** Minutes proposées sur la semaine : ce que le programme demande réellement. */
export function plannedMinutes(plan: readonly PlanDay[]): number {
  return plan.reduce((sum, day) => sum + day.entries.reduce((s, entry) => s + entry.minutes, 0), 0);
}

// ---------------------------------------------------------------------------
// Le journal

export interface JournalDay {
  day: string;
  /** Ce qui a été compté ce jour-là (compteurs de récompenses, contrat phase9 §1). */
  counters: Counters;
  /** Niveaux terminés ce jour-là, avec leur note sur 20 quand elle existe. */
  lessons: { title: Localized; mark: number | null }[];
  /** Le jour est-il dans le futur ? Le calendrier n'affiche alors que le programme. */
  future: boolean;
  /** Quelque chose a été fait. */
  active: boolean;
}

export interface JournalInput {
  journal: CountersJournal;
  /** Niveaux terminés, par jour local. */
  lessonsByDay: Readonly<Record<string, readonly { title: Localized; mark: number | null }[]>>;
  today: string;
}

export function journalDay(day: string, input: JournalInput): JournalDay {
  const counters = input.journal[day] ?? {};
  return {
    day,
    counters,
    lessons: [...(input.lessonsByDay[day] ?? [])],
    future: dayNumber(day) > dayNumber(input.today),
    active: (counters.items ?? 0) > 0 || (counters.games ?? 0) > 0,
  };
}

/** Le mois affiché, semaine par semaine, lundi en tête — la grille que le calendrier dessine. */
export function monthGrid(monthKey: string): string[][] {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year ?? 1970, (month ?? 1) - 1, 1);
  const last = new Date(year ?? 1970, month ?? 1, 0);
  const start = weekStart(first);
  const weeks: string[][] = [];
  for (let cursor = start; cursor <= last || weeks.at(-1)?.length !== 7; ) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(localDay(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor > last) break;
  }
  return weeks;
}

/** Le jour appartient-il au mois affiché ? Les cases des semaines débordantes se grisent. */
export const inMonth = (day: string, monthKey: string): boolean => day.startsWith(`${monthKey}-`);

/** Clé du mois d'un jour (`2026-09-21` → `2026-09`). */
export const monthOf = (day: string): string => day.slice(0, 7);

/** Mois voisin (`2026-01`, -1 → `2025-12`). */
export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
