import type { Concept, ContentIndex, Dialogue, Lesson, LessonStep, StepType } from "./types.ts";
import { NATIVE_AUDIO_STEP_TYPES, TONAL_STEP_TYPES } from "./types.ts";

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

/** Une étape de ce type est retirée de la séance si son enregistrement natif manque. */
export function stepRequiresNativeAudio(type: StepType): boolean {
  return NATIVE_AUDIO_STEP_TYPES.has(type);
}

/** Dialogue écoutable : au moins un tour, et chaque tour a son enregistrement présent. */
export function dialogueHasAudio(dialogue: Dialogue | undefined, media: MediaIndex | null): boolean {
  return dialogue !== undefined && dialogue.turns.length > 0 && dialogue.turns.every((t) => present(t.audio, media));
}

/**
 * L'étape a-t-elle l'audio natif qu'elle exige (contrat phase6 §1) ? Étape sans exigence : true.
 * Couvre les étapes tonales, `listen_transcribe` (on ne transcrit pas de la synthèse) et
 * `listen_gist` (le dialogue doit être enregistré en entier).
 */
export function stepHasRequiredAudio(content: ContentIndex, step: LessonStep, media: MediaIndex | null = contentMedia(content)): boolean {
  if (!stepRequiresNativeAudio(step.type)) return true;
  if (step.type === "listen_transcribe") {
    const concept = content.concepts.get(step.concept);
    return concept !== undefined && hasNativeAudio(concept, media);
  }
  if (step.type === "listen_gist") return dialogueHasAudio(content.dialogues.get(step.dialogue), media);
  return tonalStepHasNativeAudio(content, step, media);
}

export interface PlayableOptions {
  /** Build `VITE_TTS_TONE_FALLBACK=true` (bêta interne) : étapes tonales jouées en synthèse vocale. */
  toneFallback?: boolean;
  media?: MediaIndex | null;
}

/**
 * Étape jouable en séance : une étape qui exige un enregistrement natif et ne l'a pas est retirée
 * (ni affichée ni notée), sauf repli de synthèse. Les étapes orales (`speak_repeat`, `speak_answer`,
 * `speak_roleplay`) sans courbe F0 restent jouables : elles deviennent de l'écoute non notée.
 */
export function isStepPlayable(content: ContentIndex, step: LessonStep, options: PlayableOptions = {}): boolean {
  // Le repli de synthèse ne concerne que les tons : on ne fait jamais transcrire ni écouter un
  // dialogue en voix de synthèse.
  if (options.toneFallback && TONAL_STEP_TYPES.has(step.type)) return true;
  return stepHasRequiredAudio(content, step, options.media === undefined ? contentMedia(content) : options.media);
}

/** Index des étapes jouables d'une leçon (ordre conservé, indices d'origine). */
export function playableStepIndexes(content: ContentIndex, lesson: Lesson, options: PlayableOptions = {}): number[] {
  return lesson.steps.flatMap((step, i) => (isStepPlayable(content, step, options) ? [i] : []));
}
