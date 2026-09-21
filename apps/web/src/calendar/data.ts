import {
  isUnitTestPassed,
  localDay,
  markOutOf20,
  monthOf,
  periodOf,
  weekPlan,
  type ContentIndex,
  type CountersJournal,
  type JournalInput,
  type Localized,
  type PlanDay,
} from "@parlo/core";
import { db } from "../db.ts";
import { getProfile, planning } from "../learner.ts";
import { activePackCode } from "../packs/active.ts";
import { packMarks } from "../profile/marks.ts";
import { loadRewardsData } from "../rewards/store.ts";

/**
 * Données du calendrier (contrat phase24 §5).
 *
 * Deux sources, déjà présentes, qu'il suffisait de rapprocher :
 *  - **le programme** se déduit du profil (objectif quotidien), du parcours (le niveau suivant, les
 *    mots dus) et du bulletin (les thèmes qui résistent, contrat phase21 §4) ;
 *  - **le journal** vient des compteurs par jour tenus depuis le contrat phase9 §1 — 400 jours,
 *    déjà écrits à chaque séance — croisés avec les niveaux terminés (`lessonProgress`).
 *
 * Rien de nouveau n'est stocké, rien n'est envoyé au serveur. C'est la raison pour laquelle le
 * calendrier est complet dès sa première ouverture, y compris pour quelqu'un qui apprend depuis
 * des mois : l'historique existait, il n'était affiché nulle part.
 */

export interface CalendarView {
  today: string;
  /** Le programme de la semaine en cours. */
  plan: PlanDay[];
  /** Compteurs par jour (400 jours glissants). */
  journal: CountersJournal;
  /** Niveaux terminés, par jour local. */
  lessonsByDay: Record<string, { title: Localized; mark: number | null }[]>;
}

export async function calendarView(content: ContentIndex, now = new Date()): Promise<CalendarView> {
  const today = localDay(now);
  const [profile, rewards, marks] = await Promise.all([getProfile(), loadRewardsData(), packMarks(content)]);
  const plan = await planning(content, profile, now);

  return {
    today,
    plan: weekPlan(periodOf("weekly", now), {
      dailyGoalMin: profile.dailyGoalMin,
      nextLesson: plan.next
        ? { title: plan.next.title, minutes: Math.max(1, plan.next.estimatedMinutes), to: "/seance" }
        : null,
      dueCount: plan.dueCount,
      // Un seul thème faible suffit : le programme en propose un par semaine, pas une liste.
      weakThemes: marks.weak.flatMap((theme) =>
        theme.weakest ? [{ title: theme.title, to: `/lecon/${encodeURIComponent(theme.weakest.lessonId)}` }] : [],
      ),
      hasTutor: Boolean(content.pack.tutor),
      hasGames: content.curriculum.units.length > 0,
    }),
    journal: rewards.journal,
    lessonsByDay: await lessonsByDay(content),
  };
}

/**
 * Niveaux terminés, rangés par jour. `completedAt` est un instant ISO : il est ramené au **jour
 * local** de l'apprenant, comme tout le reste du calendrier — sinon une séance de 23 h 30 tomberait
 * la veille pour les uns et le lendemain pour les autres.
 */
async function lessonsByDay(content: ContentIndex): Promise<Record<string, { title: Localized; mark: number | null }[]>> {
  const rows = await db().lessonProgress.where("packCode").equals(activePackCode()).toArray();
  const out: Record<string, { title: Localized; mark: number | null }[]> = {};
  for (const row of rows) {
    const lesson = content.lessons.get(row.lessonId);
    if (!lesson) continue;
    const day = localDay(new Date(row.completedAt));
    // Un test d'unité raté n'a pas de note à montrer : il n'a pas été réussi.
    const graded = lesson.kind !== "unit_test" || isUnitTestPassed(row.bestScore);
    (out[day] ??= []).push({ title: lesson.title, mark: graded ? markOutOf20(row.bestScore) : null });
  }
  return out;
}

/** Ce que `journalDay` attend, à partir de la vue. */
export const journalInput = (view: CalendarView): JournalInput => ({
  journal: view.journal,
  lessonsByDay: view.lessonsByDay,
  today: view.today,
});

/** Mois affiché par défaut : celui d'aujourd'hui. */
export const currentMonth = (view: CalendarView): string => monthOf(view.today);
