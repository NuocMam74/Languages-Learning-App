import type { Concept, ContentIndex, Lesson, LessonStep } from "./types.ts";
import { TONAL_STEP_TYPES } from "./types.ts";

/**
 * Disponibilité des médias (contrat phase5-parcours §1). Le bundle d'un pack expose
 * `mediaIndex` : chemins relatifs des fichiers réellement présents (`audio/…`, `pitch/…`, `img/…`).
 * Règles identiques côté API (apps/api) : toute modification se fait des deux côtés.
 */

export type MediaIndex = ReadonlySet<string>;

/** Index des médias d'un contenu ; `null` = inconnu (fichiers de test lus sur disque) → tout est considéré présent. */
export function contentMedia(content: Pick<ContentIndex, "mediaIndex">): MediaIndex | null {
  return content.mediaIndex ?? null;
}

const present = (path: string | undefined | null, media: MediaIndex | null): boolean =>
  typeof path === "string" && path.length > 0 && (media === null || media.has(path));

/** Au moins une piste `source: "native"` dont le fichier est dans l'index. */
export function hasNativeAudio(concept: Pick<Concept, "audio">, media: MediaIndex | null): boolean {
  return concept.audio.some((a) => a.source === "native" && present(a.src, media));
}

/** Courbe F0 de référence présente : `pitch` d'un concept ou `pitchRef` d'une étape. */
export function hasPitchRef(item: { pitch?: string | undefined; pitchRef?: string | undefined }, media: MediaIndex | null): boolean {
  return present(item.pitchRef ?? item.pitch, media);
}

/** Chemin de la courbe utilisée par une étape orale (étape `pitchRef`, sinon `concept.pitch`). */
export function stepPitchPath(content: ContentIndex, step: LessonStep): string | null {
  if (step.type === "speak_repeat") return step.pitchRef ?? content.concepts.get(step.concept)?.pitch ?? null;
  if (step.type === "tone_produce") return content.concepts.get(step.concept)?.pitch ?? null;
  return null;
}

/** Concepts dont l'audio porte une étape tonale (tone_minimal_pair sans `audioConcepts` : aucun, audio de synthèse). */
function tonalAudioConcepts(content: ContentIndex, step: LessonStep): Concept[] | null {
  switch (step.type) {
    case "tone_identify":
    case "tone_produce": {
      const c = content.concepts.get(step.concept);
      return c ? [c] : [];
    }
    case "tone_minimal_pair":
      return (step.audioConcepts ?? []).flatMap((id) => content.concepts.get(id) ?? []);
    default:
      return null;
  }
}

/** Une étape tonale a-t-elle son audio natif (tous ses concepts audio, au moins un) ? Étape non tonale : true. */
export function tonalStepHasNativeAudio(content: ContentIndex, step: LessonStep, media: MediaIndex | null = contentMedia(content)): boolean {
  if (!TONAL_STEP_TYPES.has(step.type)) return true;
  const concepts = tonalAudioConcepts(content, step) ?? [];
  if (step.type === "tone_minimal_pair" && (step.audioConcepts?.length ?? 0) !== step.pair.length) return false;
  return concepts.length > 0 && concepts.every((c) => hasNativeAudio(c, media));
}

export interface PlayableOptions {
  /** Build `VITE_TTS_TONE_FALLBACK=true` (bêta interne) : étapes tonales jouées en synthèse vocale. */
  toneFallback?: boolean;
  media?: MediaIndex | null;
}

/**
 * Étape jouable en séance : une étape tonale sans audio natif est retirée (ni affichée ni notée),
 * sauf repli de synthèse. `speak_repeat` sans courbe reste une écoute non notée (jouable).
 */
export function isStepPlayable(content: ContentIndex, step: LessonStep, options: PlayableOptions = {}): boolean {
  if (options.toneFallback) return true;
  return tonalStepHasNativeAudio(content, step, options.media === undefined ? contentMedia(content) : options.media);
}

/** Index des étapes jouables d'une leçon (ordre conservé, indices d'origine). */
export function playableStepIndexes(content: ContentIndex, lesson: Lesson, options: PlayableOptions = {}): number[] {
  return lesson.steps.flatMap((step, i) => (isStepPlayable(content, step, options) ? [i] : []));
}
