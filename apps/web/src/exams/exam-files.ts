import { lessonsBefore, type ContentIndex, type ExamAnswer, type ExamFile, type ExamScores, type LessonId } from "@parlo/core";
import { getKv, setKv } from "../db.ts";
import { completedLessons, getPlacement } from "../learner.ts";

/**
 * Fichiers d'examen du pack (content/<pack>/exams/<niveau>.json). Importés au
 * build en modules séparés : précachés par le service worker, l'examen blanc
 * marche donc hors ligne.
 */
const loaders = import.meta.glob<ExamFile>("../../../../content/*/exams/*.json", { import: "default" });

function keyFor(pack: string, level: string): string | undefined {
  return Object.keys(loaders).find((k) => k.endsWith(`/content/${pack}/exams/${level.toLowerCase()}.json`));
}

/** Niveaux disponibles pour un pack, triés (a0, a1, a2). */
export function examLevels(pack: string): string[] {
  return Object.keys(loaders)
    .flatMap((k) => {
      const m = new RegExp(`/content/${pack}/exams/([a-z0-9]+)\\.json$`).exec(k);
      return m?.[1] ? [m[1]] : [];
    })
    .sort();
}

export async function loadExam(pack: string, level: string): Promise<ExamFile | null> {
  const key = keyFor(pack, level);
  const load = key ? loaders[key] : undefined;
  return load ? load() : null;
}

export async function loadExams(pack: string): Promise<ExamFile[]> {
  const files = await Promise.all(examLevels(pack).map((level) => loadExam(pack, level)));
  return files.filter((f): f is ExamFile => f !== null);
}

/** Leçons terminées ou sautées grâce au placement (même règle que la carte du parcours). */
export async function doneLessons(content: ContentIndex): Promise<Set<LessonId>> {
  const [completed, placement] = await Promise.all([completedLessons(), getPlacement()]);
  return new Set([...completed, ...(placement ? lessonsBefore(content.curriculum, placement.entryLessonId) : [])]);
}

/** « A0 Bén rễ » → { code: "A0", name: "Bén rễ" }. */
export function splitCertificateName(full: string, level: string): { code: string; name: string } {
  const name = full.startsWith(level) ? full.slice(level.length).trim() : full;
  return { code: level, name: name || full };
}

// --- Dernière tentative certifiante, gardée localement pour l'affichage hors ligne ---------

export interface LocalAttempt {
  submittedAt: string;
  passed: boolean;
  scores: Partial<ExamScores>;
}

export const getLocalAttempts = () => getKv<Record<string, LocalAttempt>>("exams.attempts", {});

export async function saveLocalAttempt(examId: string, attempt: LocalAttempt): Promise<void> {
  const all = await getLocalAttempts();
  await setKv("exams.attempts", { ...all, [examId]: attempt });
}

/** Tentative certifiante en cours : reprise après rechargement tant qu'elle n'a pas expiré. */
export interface OngoingAttempt {
  examId: string;
  attemptId: string;
  seed: string;
  expiresAt: string;
  items: { section: "listening" | "reading" | "vocabulary" | "speaking"; index: number }[];
  answers: ExamAnswer[];
}

export const getOngoingAttempt = () => getKv<OngoingAttempt | null>("exams.ongoing", null);
export const saveOngoingAttempt = (attempt: OngoingAttempt | null) => setKv("exams.ongoing", attempt);
