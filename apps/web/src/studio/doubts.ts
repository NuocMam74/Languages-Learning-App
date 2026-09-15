import type { RawPackFiles } from "@parlo/core";
import type { DocKind } from "./studio-api.ts";

/**
 * Doutes des agents de contenu (`content/<pack>/_review/doubts.json`, `{ "<clé>": ["…"] }`).
 * Clés : identifiant de document (déjà renvoyé par /review-queue), identifiant d'unité (`vi-south.u04`)
 * ou groupe général préfixé `_`. L'API ne renvoie que les doutes du document : ceux de l'unité et les
 * groupes généraux sont lus ici, depuis le fichier du dépôt (importé à la demande, chunk du studio).
 */

export type DoubtsFile = Record<string, string[]>;

const loaders = import.meta.glob<DoubtsFile>("../../../../content/*/_review/doubts.json", { import: "default" });

export async function loadDoubts(code: string): Promise<DoubtsFile> {
  const key = Object.keys(loaders).find((k) => k.endsWith(`/content/${code}/_review/doubts.json`));
  const load = key ? loaders[key] : undefined;
  if (!load) return {};
  try {
    return await load();
  } catch {
    return {};
  }
}

/** Unités concernées par un document : la sienne pour une leçon, celles des leçons qui l'utilisent sinon. */
export function unitsOf(kind: DocKind, id: string, raw: RawPackFiles | null): string[] {
  if (kind === "lesson") {
    const m = /^(.+\.u\d{2})\.l\d{2}$/.exec(id);
    return m?.[1] ? [m[1]] : [];
  }
  if (!raw) return [];
  const units = new Set<string>();
  for (const lesson of raw.lessons) {
    const uses =
      kind === "concept"
        ? lesson.concepts.includes(id)
        : kind === "culture"
          ? lesson.steps.some((s) => s.type === "culture_card" && s.ref === id)
          : false;
    if (uses) units.add(lesson.unit);
  }
  return [...units].sort();
}

export interface DoubtGroups {
  own: string[];
  units: { unit: string; doubts: string[] }[];
  general: { group: string; doubts: string[] }[];
}

export function doubtsFor(file: DoubtsFile, kind: DocKind, id: string, serverDoubts: readonly string[], raw: RawPackFiles | null): DoubtGroups {
  const own = [...new Set([...serverDoubts, ...(file[id] ?? [])])];
  const units = unitsOf(kind, id, raw).flatMap((unit) => (file[unit]?.length ? [{ unit, doubts: file[unit] }] : []));
  return { own, units, general: generalDoubts(file) };
}

export function generalDoubts(file: DoubtsFile): { group: string; doubts: string[] }[] {
  return Object.entries(file)
    .filter(([key, list]) => key.startsWith("_") && list.length > 0)
    .map(([key, doubts]) => ({ group: key.slice(1).replace(/_/g, " "), doubts }));
}
