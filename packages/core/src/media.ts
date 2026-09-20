import type { Concept, ContentIndex, Dialogue, GameId, Lesson, LessonStep, StepType } from "./types.ts";
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

/**
 * Le pack a-t-il **au moins un** enregistrement natif présent ?
 *
 * Question grossière, mais c'est la bonne : tant qu'aucune voix n'a été enregistrée, la moitié des
 * écrans affiche « Audio natif pas encore enregistré » en rouge, exercice après exercice, comme si
 * chaque mot avait un problème particulier. Ce n'est pas un incident par mot, c'est un état du
 * pack — et il se dit **une fois**, calmement.
 *
 * `media === null` (contenu lu sur disque en test) : tout est réputé présent.
 */
export function packHasNativeAudio(content: Pick<ContentIndex, "concepts" | "mediaIndex">, media: MediaIndex | null = contentMedia(content)): boolean {
  if (media === null) return true;
  for (const concept of content.concepts.values()) if (hasNativeAudio(concept, media)) return true;
  return false;
}

/**
 * Mini-jeux qui n'ont aucun sens sans voix native. `cho_noi` fait trier des barques à l'oreille par
 * leur ton : en voix de synthèse, les tons sont faux (spec §7.4), donc le jeu exige du natif et,
 * sans lui, s'ouvre sur « Pas assez de mots avec un audio natif pour jouer ici ». Mieux vaut ne pas
 * l'ouvrir : une porte qui mène à un mur n'est pas une porte.
 *
 * Les autres jeux acceptent la synthèse (le contenu n'y est pas tonal) et restent jouables.
 */
export const NATIVE_AUDIO_GAMES: ReadonlySet<GameId> = new Set<GameId>(["cho_noi", "karaoke_tonal"]);

/**
 * Le mini-jeu est-il jouable avec les médias présents ? `toneFallback` (bêta interne
 * `VITE_TTS_TONE_FALLBACK`) rend la synthèse acceptable pour les tons : `cho_noi` redevient alors
 * jouable, exactement comme les étapes tonales — c'est la même décision, prise au même endroit.
 */
export function isGamePlayable(content: ContentIndex, game: GameId, media: MediaIndex | null = contentMedia(content), toneFallback = false): boolean {
  return toneFallback || !NATIVE_AUDIO_GAMES.has(game) || packHasNativeAudio(content, media);
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
  const media = options.media === undefined ? contentMedia(content) : options.media;
  // Un mini-jeu qui s'ouvrirait sur « pas assez de mots pour jouer » est retiré comme une étape
  // d'écoute sans enregistrement : on ne fait pas traverser un cul-de-sac.
  if (step.type === "game") return isGamePlayable(content, step.game, media, options.toneFallback ?? false);
  return stepHasRequiredAudio(content, step, media);
}

/** Index des étapes jouables d'une leçon (ordre conservé, indices d'origine). */
export function playableStepIndexes(content: ContentIndex, lesson: Lesson, options: PlayableOptions = {}): number[] {
  return lesson.steps.flatMap((step, i) => (isStepPlayable(content, step, options) ? [i] : []));
}
