import type { Concept, ContentIndex } from "@parlo/core";
import { pitchAvailable } from "../media.ts";

/** Karaoké tonal : phrases jouables (module léger, lu par l'onglet Jeux sans charger le karaoké). */

const MAX_CANDIDATES = 40;

export interface Candidate {
  concept: Concept;
  pitchRef: string | null;
}

/**
 * Concepts dont la courbe de référence est présente dans l'index des médias (champ `pitch`, `pitchRef`
 * d'étape, tone_produce), dans l'ordre du parcours. Sans courbe : pas d'entrée (contrat phase5 §1).
 */
export function karaokeCandidates(content: ContentIndex, completed: ReadonlySet<string>): { known: Candidate[]; all: Candidate[] } {
  const seen = new Map<string, Candidate>();
  const known = new Set<string>();
  const lessonIds = content.curriculum.units.flatMap((u) => u.lessons);
  for (const lessonId of [...new Set([...lessonIds, ...content.lessons.keys()])]) {
    const lesson = content.lessons.get(lessonId);
    if (!lesson) continue;
    for (const step of lesson.steps) {
      if (step.type !== "speak_repeat" && step.type !== "tone_produce") continue;
      const concept = content.concepts.get(step.concept);
      if (!concept) continue;
      const pitchRef = step.type === "speak_repeat" ? (step.pitchRef ?? concept.pitch ?? null) : (concept.pitch ?? null);
      if (!pitchRef || !pitchAvailable(content, pitchRef)) continue;
      if (!seen.has(concept.id)) seen.set(concept.id, { concept, pitchRef });
      if (completed.has(lesson.id)) known.add(concept.id);
    }
  }
  for (const concept of content.concepts.values()) {
    if (concept.pitch && !seen.has(concept.id) && pitchAvailable(content, concept.pitch)) seen.set(concept.id, { concept, pitchRef: concept.pitch });
  }
  const all = [...seen.values()].slice(0, MAX_CANDIDATES);
  return { known: all.filter((c) => known.has(c.concept.id)), all };
}

