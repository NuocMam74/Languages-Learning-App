import { request } from "../api.ts";

/** Côté élève (docs/contracts/phase4.md §2) : rejoindre avec consentement, mes classes, quitter. */

export interface StudentAssignment {
  id: string;
  title: string;
  lessonIds: string[];
  /** Date locale `YYYY-MM-DD` ; null possible côté API (devoir sans échéance). */
  dueDate: string | null;
  completed: number;
  total: number;
}

export interface MyClass {
  id: string;
  name: string;
  teacherName: string;
  assignments: StudentAssignment[];
}

export interface JoinedClass {
  classId: string;
  name: string;
  teacherName: string;
}

export const joinClass = (code: string) => request<JoinedClass>(`/classes/join/${encodeURIComponent(code)}`, { method: "POST", body: { consent: true } });
export const leaveClass = (classId: string) => request<void>(`/me/classes/${encodeURIComponent(classId)}`, { method: "DELETE" });

let cache: { at: number; value: Promise<MyClass[]> } | null = null;
const TTL_MS = 60_000;

/** `GET /me/classes`, mémorisé une minute (le hub le relit à chaque retour). */
export function getMyClasses(force = false): Promise<MyClass[]> {
  if (force || !cache || Date.now() - cache.at > TTL_MS) {
    const value = request<MyClass[]>("/me/classes").catch((error: unknown) => {
      cache = null;
      throw error;
    });
    cache = { at: Date.now(), value };
  }
  return cache.value;
}

export function clearMyClassesCache(): void {
  cache = null;
}

/** Code saisi à la main : Crockford base32 (I/L → 1, O → 0), 6 caractères. */
export function normalizeJoinCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return /^[0-9A-HJKMNP-TV-Z]{6}$/.test(code) ? code : null;
}
