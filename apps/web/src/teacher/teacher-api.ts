import { localDay } from "@parlo/core";
import { getMe, request } from "../api.ts";

/**
 * Client HTTP de l'espace enseignant (docs/contracts/phase4.md §0, §2).
 * Aucune donnée de contact des élèves ne transite : `displayName` uniquement.
 */

export interface ClassSummary {
  id: string;
  name: string;
  joinCode: string;
  packCode: string;
  studentCount: number;
}

export interface StudentWeakConcept {
  id: string;
  vi: string;
  errorRate: number;
}

export interface StudentExam {
  level: string;
  passed: boolean;
  global: number;
}

export interface RosterStudent {
  id: string;
  displayName: string;
  joinedAt: string;
  lastActiveDate: string | null;
  streak: number;
  xpWeek: number;
  lessonsCompleted: number;
  currentLessonId: string | null;
  weakConcepts: StudentWeakConcept[];
  exams: StudentExam[];
}

/**
 * Devoir vu par l'enseignant. Le contrat laisse `assignments:[...]` ouvert ; forme alignée sur
 * le schéma de l'API (`AssignmentOut`) : `completed` = élèves ayant terminé toutes les leçons,
 * `total` = élèves de la classe.
 */
export interface TeacherAssignment {
  id: string;
  title: string;
  lessonIds: string[];
  unitId?: string | null;
  dueDate: string | null;
  createdAt?: string;
  completed: number;
  total: number;
}

export interface ClassDetail {
  id: string;
  name: string;
  joinCode: string;
  /** Absent du contrat §2 pour le détail (présent dans l'API) : repli sur la liste des classes. */
  packCode?: string;
  students: RosterStudent[];
  assignments: TeacherAssignment[];
}

export type AssignmentInput = { title: string; dueDate: string } & ({ lessonIds: string[] } | { unitId: string });

const id = (value: string) => encodeURIComponent(value);

export const createClass = (name: string, packCode: string) => request<Omit<ClassSummary, "studentCount"> & { studentCount?: number }>("/classes", { method: "POST", body: { name, packCode } });
export const getClasses = () => request<ClassSummary[]>("/classes");
export const getClass = (classId: string) => request<ClassDetail>(`/classes/${id(classId)}`);
export const createAssignment = (classId: string, input: AssignmentInput) => request<{ id: string }>(`/classes/${id(classId)}/assignments`, { method: "POST", body: input });
export const deleteAssignment = (classId: string, assignmentId: string) => request<void>(`/classes/${id(classId)}/assignments/${id(assignmentId)}`, { method: "DELETE" });
export const regenerateCode = (classId: string) => request<{ joinCode: string }>(`/classes/${id(classId)}/regenerate-code`, { method: "POST" });
export const removeStudent = (classId: string, userId: string) => request<void>(`/classes/${id(classId)}/students/${id(userId)}`, { method: "DELETE" });

let rolesCache: Promise<string[]> | null = null;

/** Rôles du compte (`GET /me` → `roles`), mémorisés pour la session. Échec : aucun rôle particulier. */
export function fetchRoles(force = false): Promise<string[]> {
  if (force || !rolesCache) {
    rolesCache = getMe(localDay(new Date())).then(
      (me) => (Array.isArray(me.roles) ? me.roles : []),
      () => {
        rolesCache = null;
        return [];
      },
    );
  }
  return rolesCache;
}

export function clearRolesCache(): void {
  rolesCache = null;
}

/** Lien d'invitation public de la classe. */
export function joinUrl(code: string, origin = window.location.origin): string {
  return `${origin}/classe/${encodeURIComponent(code)}`;
}
