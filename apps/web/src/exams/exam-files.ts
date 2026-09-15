import { type ContentIndex, type ExamAnswer, type ExamFile, type ExamScores, type LessonId } from "@parlo/core";
import { cachedPackFiles, packFiles } from "../content.ts";
import { getKv, setKv } from "../db.ts";
import { progressState } from "../learner.ts";

/**
 * Fichiers d'examen du pack (content/<pack>/exams/<niveau>.json). Contrat phase5 §6 : ils voyagent
 * dans le bundle du pack (mis à jour sans rebuild, précaché avec lui : l'examen blanc marche hors
 * ligne). Repli : fichiers embarqués au build (bundle ancien sans examens, studio).
 */
const loaders = import.meta.glob<ExamFile>("../../../../content/*/exams/*.json", { import: "default" });

function keyFor(pack: string, level: string): string | undefined {
  return Object.keys(loaders).find((k) => k.endsWith(`/content/${pack}/exams/${level.toLowerCase()}.json`));
}

function bundledExams(pack: string): readonly ExamFile[] | null {
  const files = cachedPackFiles(pack);
  return files?.exams && files.exams.length > 0 ? files.exams : null;
}

/** Niveaux disponibles pour un pack, triés (a0, a1, a2). */
export function examLevels(pack: string): string[] {
  const bundled = bundledExams(pack);
  if (bundled) return bundled.map((e) => e.level.toLowerCase()).sort();
  return Object.keys(loaders)
    .flatMap((k) => {
      const m = new RegExp(`/content/${pack}/exams/([a-z0-9]+)\\.json$`).exec(k);
      return m?.[1] ? [m[1]] : [];
    })
    .sort();
}

export async function loadExam(pack: string, level: string): Promise<ExamFile | null> {
  const bundled = bundledExams(pack) ?? (await packFiles(pack))?.exams ?? null;
  const fromBundle = bundled?.find((e) => e.level.toLowerCase() === level.toLowerCase());
  if (fromBundle) return fromBundle;
  if (bundled && bundled.length > 0) return null;
  const key = keyFor(pack, level);
  const load = key ? loaders[key] : undefined;
  return load ? load() : null;
}

export async function loadExams(pack: string): Promise<ExamFile[]> {
  if (!bundledExams(pack)) await packFiles(pack);
  const files = await Promise.all(examLevels(pack).map((level) => loadExam(pack, level)));
  return files.filter((f): f is ExamFile => f !== null);
}

/**
 * Leçons qui débloquent un examen : terminées (tests d'unité réussis seulement) ou sautées grâce au
 * placement (contrat phase5 §2 : seul un test réussi compte pour les examens).
 */
export async function doneLessons(content: ContentIndex): Promise<Set<LessonId>> {
  return (await progressState(content)).passed;
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
