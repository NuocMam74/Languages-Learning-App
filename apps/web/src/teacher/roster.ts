import type { Curriculum } from "@parlo/core";
import type { AssignmentInput, RosterStudent, TeacherAssignment } from "./teacher-api.ts";

/** Logique pure de l'espace enseignant : tri du tableau, dates relatives, avancement des devoirs. */

export type RosterSortKey = "name" | "lastActive" | "streak" | "xpWeek" | "lessons" | "exams";
export type SortDirection = "asc" | "desc";

const DAY_MS = 86_400_000;

/** Jours écoulés entre deux dates locales `YYYY-MM-DD` (null : jamais actif). */
export function daysSince(date: string | null, today: string): number | null {
  if (!date) return null;
  const a = Date.parse(`${date.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

export function examsPassed(student: Pick<RosterStudent, "exams">): number {
  return student.exams.filter((e) => e.passed).length;
}

/** Direction naturelle au premier clic : alphabétique pour le nom, « le plus d'abord » pour les chiffres, « le plus récent » pour l'activité. */
export function defaultDirection(key: RosterSortKey): SortDirection {
  return key === "name" ? "asc" : "desc";
}

/**
 * Tri stable du tableau de classe. `lastActive` desc = les plus récents d'abord ;
 * les élèves jamais actifs restent en bas quelle que soit la direction. Égalités : par nom.
 */
export function sortRoster(students: readonly RosterStudent[], key: RosterSortKey, direction: SortDirection, locale = "fr"): RosterStudent[] {
  const byName = (a: RosterStudent, b: RosterStudent) => a.displayName.localeCompare(b.displayName, locale, { sensitivity: "base" });
  const sign = direction === "asc" ? 1 : -1;
  const value = (s: RosterStudent): number | null => {
    switch (key) {
      case "lastActive":
        return s.lastActiveDate ? Date.parse(`${s.lastActiveDate.slice(0, 10)}T12:00:00Z`) : null;
      case "streak":
        return s.streak;
      case "xpWeek":
        return s.xpWeek;
      case "lessons":
        return s.lessonsCompleted;
      case "exams":
        return examsPassed(s);
      case "name":
        return null;
    }
  };
  return students
    .map((s, index) => ({ s, index }))
    .sort((x, y) => {
      if (key === "name") return sign * byName(x.s, y.s) || x.index - y.index;
      const a = value(x.s);
      const b = value(y.s);
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      if (a !== null && b !== null && a !== b) return sign * (a - b);
      return byName(x.s, y.s) || x.index - y.index;
    })
    .map(({ s }) => s);
}

/** Concepts les plus fragiles d'abord (taux d'erreur décroissant), au plus `limit`. */
export function weakest<T extends { errorRate: number }>(concepts: readonly T[], limit = 5): T[] {
  return [...concepts].sort((a, b) => b.errorRate - a.errorRate).slice(0, limit);
}

export function percent(ratio: number): number {
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/**
 * Avancement d'un devoir dans la classe : élèves ayant tout terminé / élèves de la classe.
 * Le total du serveur fait foi ; s'il manque, on prend l'effectif du tableau. Toujours borné.
 */
export function classCompletion(assignment: Pick<TeacherAssignment, "completed" | "total">, studentCount: number): { done: number; total: number; ratio: number } {
  const total = Math.max(0, Number.isFinite(assignment.total) && assignment.total > 0 ? assignment.total : studentCount);
  const done = Math.min(total, Math.max(0, assignment.completed || 0));
  return { done, total, ratio: total > 0 ? done / total : 0 };
}

/** Sélection du formulaire de devoir : unités entières cochées et leçons isolées. */
export interface LessonSelection {
  units: ReadonlySet<string>;
  lessons: ReadonlySet<string>;
}

/** Leçons couvertes par la sélection, dans l'ordre du parcours, sans doublon. */
export function selectedLessons(curriculum: Curriculum, selection: LessonSelection): string[] {
  const result: string[] = [];
  for (const unit of curriculum.units) {
    for (const lesson of unit.lessons) {
      if (selection.units.has(unit.id) || selection.lessons.has(lesson)) result.push(lesson);
    }
  }
  return result;
}

/**
 * Corps de `POST /classes/{id}/assignments` : `unitId` si la sélection est exactement une unité
 * entière, sinon la liste des leçons. null si rien n'est choisi ou si le titre/la date manque.
 */
export function assignmentPayload(curriculum: Curriculum, title: string, dueDate: string, selection: LessonSelection): AssignmentInput | null {
  const cleanTitle = title.trim();
  if (!cleanTitle || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const lessons = selectedLessons(curriculum, selection);
  if (lessons.length === 0) return null;
  if (selection.units.size === 1) {
    const unitId = [...selection.units][0]!;
    const unit = curriculum.units.find((u) => u.id === unitId);
    if (unit && lessons.length === unit.lessons.length) return { title: cleanTitle, dueDate, unitId };
  }
  return { title: cleanTitle, dueDate, lessonIds: lessons };
}
