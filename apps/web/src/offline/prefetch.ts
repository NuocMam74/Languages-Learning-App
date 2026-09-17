import { unitsForLessons, type ContentIndex, type UnitId } from "@parlo/core";
import { ensureUnits } from "../content.ts";
import { getProfile, openLessons, planning, progressState } from "../learner.ts";

/**
 * Unités utiles tout de suite (audit mobile P1 #6) : unité de la prochaine leçon et unité suivante,
 * chargées après le premier affichage (IndexedDB d'abord, sinon réseau ; échec silencieux).
 */
export async function likelyUnits(content: ContentIndex): Promise<{ current: UnitId | null; next: UnitId | null; lessons: string[] }> {
  const plan = await planning(content, await getProfile());
  const units = content.curriculum.units.filter((u) => u.status === "available").map((u) => u.id);
  const current = plan.next?.unit ?? null;
  const index = current ? units.indexOf(current) : -1;
  return { current, next: index >= 0 ? (units[index + 1] ?? null) : null, lessons: plan.next ? [plan.next.id] : [] };
}

export async function prefetchLikelyUnits(content: ContentIndex): Promise<void> {
  if (!content.split) return;
  try {
    const { next, lessons } = await likelyUnits(content);
    await ensureUnits(content, [...unitsForLessons(content, lessons), ...(next ? [next] : [])], { optional: true });
    // Les étapes chargées citent parfois des concepts d'autres unités.
    await ensureUnits(content, unitsForLessons(content, lessons), { optional: true });
  } catch {
    // Préchargement seulement.
  }
}

/** Unités des leçons terminées ou ouvertes (jeux, karaoké, examens : pioches de concepts et d'étapes). */
export async function progressUnits(content: ContentIndex): Promise<UnitId[]> {
  const progress = await progressState(content);
  const lessons = new Set([...progress.completed, ...openLessons(content, progress)]);
  return unitsForLessons(content, lessons);
}
