import { contentMedia, hasNativeAudio, hasPitchRef, playableStepIndexes, type Concept, type ContentIndex, type Lesson, type PlayableOptions } from "@parlo/core";

/**
 * Politique de disponibilité des médias côté client (contrat phase5 §1).
 * `VITE_TTS_TONE_FALLBACK=true` (bêta interne) : les exercices de tons sans audio natif
 * sont joués en synthèse vocale, avec le marqueur « voix de synthèse ». Défaut : retirés.
 */
export const TONE_FALLBACK: boolean = import.meta.env.VITE_TTS_TONE_FALLBACK === "true";

export function playableOptions(content: ContentIndex): PlayableOptions {
  return { toneFallback: TONE_FALLBACK, media: contentMedia(content) };
}

/** Étapes jouables d'une leçon (indices d'origine). */
export function playableSteps(content: ContentIndex, lesson: Lesson): number[] {
  return playableStepIndexes(content, lesson, playableOptions(content));
}

export function conceptHasNativeAudio(content: ContentIndex, concept: Concept): boolean {
  return hasNativeAudio(concept, contentMedia(content));
}

/** Courbe de référence présente (chemin explicite : étape `pitchRef` ou `concept.pitch`). */
export function pitchAvailable(content: ContentIndex, path: string | null | undefined): boolean {
  return path ? hasPitchRef({ pitch: path }, contentMedia(content)) : false;
}
