import type { MyClass, StudentAssignment } from "./classes-api.ts";

/** Logique pure des devoirs côté élève : avancement, échéance, devoir à mettre en avant. */

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date.slice(0, 10)}T12:00:00Z`) / DAY_MS);
}

/**
 * Avancement : le serveur fait foi, mais la progression locale (pas encore synchronisée)
 * peut être en avance — on garde le maximum, borné au total.
 */
export function assignmentProgress(assignment: StudentAssignment, localCompleted?: ReadonlySet<string>): { done: number; total: number } {
  const total = Math.max(assignment.total, 0) || assignment.lessonIds.length;
  const local = localCompleted ? assignment.lessonIds.filter((id) => localCompleted.has(id)).length : 0;
  return { done: Math.min(total, Math.max(assignment.completed, local)), total };
}

export function isComplete(assignment: StudentAssignment, localCompleted?: ReadonlySet<string>): boolean {
  const { done, total } = assignmentProgress(assignment, localCompleted);
  return total > 0 && done >= total;
}

export type DueWhen =
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "weekday"; weekday: string }
  | { kind: "date"; date: string; overdue: boolean };

/** Échéance lisible : « aujourd'hui », « demain », jour de la semaine sous 7 jours, sinon la date. */
export function dueWhen(dueDate: string, today: string, locale = "fr"): DueWhen {
  const diff = dayNumber(dueDate) - dayNumber(today);
  const noon = new Date(`${dueDate.slice(0, 10)}T12:00:00`);
  if (diff === 0) return { kind: "today" };
  if (diff === 1) return { kind: "tomorrow" };
  if (diff > 1 && diff < 7) return { kind: "weekday", weekday: noon.toLocaleDateString(locale, { weekday: "long" }) };
  return { kind: "date", date: noon.toLocaleDateString(locale, { day: "numeric", month: "long" }), overdue: diff < 0 };
}

/** Prochaine leçon du devoir non terminée localement et présente dans le contenu chargé. */
export function nextLesson(assignment: StudentAssignment, localCompleted: ReadonlySet<string>, available: (id: string) => boolean): string | null {
  return assignment.lessonIds.find((id) => !localCompleted.has(id) && available(id)) ?? null;
}

/** Devoirs en retard depuis plus longtemps ne sont plus mis en avant sur le hub. */
export const OVERDUE_HUB_DAYS = 14;

/** Devoir à afficher sur le hub : non terminé, échéance la plus proche (retard récent compris). */
export function featuredAssignment(
  classes: readonly MyClass[],
  today: string,
  localCompleted?: ReadonlySet<string>,
): { assignment: StudentAssignment; classId: string } | null {
  const candidates = classes.flatMap((c) =>
    c.assignments
      .filter((a) => !isComplete(a, localCompleted) && (a.dueDate === null || dayNumber(a.dueDate) - dayNumber(today) >= -OVERDUE_HUB_DAYS))
      .map((assignment) => ({ assignment, classId: c.id })),
  );
  // Échéance la plus proche d'abord ; sans échéance en dernier.
  const key = (a: StudentAssignment) => a.dueDate ?? "9999-12-31";
  candidates.sort((a, b) => key(a.assignment).localeCompare(key(b.assignment)) || a.assignment.title.localeCompare(b.assignment.title));
  return candidates[0] ?? null;
}
