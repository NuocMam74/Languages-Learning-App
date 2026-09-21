import type { ContentIndex, Exercise } from "@parlo/core";
import { createContext, useContext } from "react";
import { Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";

/**
 * Le sens, en langue d'interface, de ce que l'exercice fait manipuler.
 *
 * Chaque exercice doit pouvoir dire ce qu'il veut dire : on ne fait pas répéter, assembler ni
 * reconnaître une phrase dont on ignore le sens. Mais la traduction **est** la réponse de
 * plusieurs formats (une écoute dont les options sont des mots vietnamiens, une transcription,
 * une traduction) : l'afficher d'avance les viderait de leur contenu.
 *
 * D'où deux fonctions, et deux moments :
 *   - `exerciseMeaning` : ce qu'il y a à dire — la phrase cible et sa traduction ;
 *   - `meaningGivesAnswer` : vrai quand le dire avant la réponse reviendrait à la donner. L'écran
 *     de séance affiche alors le sens **après** la réponse, dans la correction, et jamais avant.
 */

export interface ExerciseMeaning {
  /** La phrase ou le mot en langue cible ; null quand l'exercice n'en montre pas un seul. */
  vi: string | null;
  /** Son sens en langue d'interface. */
  gloss: string;
}

/** Sens du (des) concept(s) de l'exercice, quand ils désignent une seule chose à comprendre. */
function conceptMeaning(content: ContentIndex, ids: readonly string[]): ExerciseMeaning | null {
  const concepts = ids.flatMap((id) => content.concepts.get(id) ?? []);
  if (concepts.length !== 1) return null;
  const [concept] = concepts;
  if (!concept) return null;
  return { vi: concept.vi, gloss: l(concept.gloss) };
}

export function exerciseMeaning(content: ContentIndex, exercise: Exercise): ExerciseMeaning | null {
  switch (exercise.type) {
    // Assembler une phrase : la traduction dit **quoi** dire, et c'est la consigne — sans elle on
    // remet des jetons dans l'ordre sans savoir ce qu'on écrit. La phrase vietnamienne, elle, est la
    // réponse : l'afficher au-dessus des jetons revenait à donner le corrigé avec l'énoncé. Elle
    // n'arrive qu'à la correction, et seulement si on s'est trompé (« La bonne réponse : … »).
    case "build_sentence":
      return { vi: null, gloss: l(exercise.translation) };
    case "fill_gap":
      return exercise.translation ? { vi: null, gloss: l(exercise.translation) } : conceptMeaning(content, exercise.conceptIds);
    // Traduire : l'énoncé **est** la phrase de départ, affichée en haut de l'exercice du début à la
    // fin. La redire ici en ferait un doublon — d'un sens vers le vietnamien il ne reste rien à
    // ajouter, et dans l'autre sens seule la traduction française apporte quelque chose.
    case "translate_to_vi":
      return null;
    case "translate_to_fr":
      return { vi: null, gloss: exercise.accepted.fr[0] ?? "" };
    case "listen_transcribe":
      return { vi: exercise.accepted[0] ?? exercise.audio.vi, gloss: l(exercise.audio.gloss) };
    case "listen_pick_image":
    case "listen_pick_text":
      return { vi: exercise.audio.vi, gloss: l(exercise.audio.gloss) };
    // Exercices de ton : la forme écrite **porte** le ton, donc elle est la réponse. Le sens, lui,
    // ne la donne pas — on peut le montrer tout de suite, la graphie seulement à la correction.
    case "tone_identify":
      return { vi: null, gloss: l(exercise.audio.gloss) };
    case "tone_minimal_pair":
      return exercise.audio ? { vi: exercise.audio.vi, gloss: l(exercise.audio.gloss) } : null;
    case "speak_repeat":
    case "tone_produce":
      return { vi: exercise.concept.vi, gloss: l(exercise.concept.gloss) };
    case "speak_answer":
      return { vi: exercise.prompt, gloss: l(exercise.translation) };
    // Ces formats montrent déjà leur traduction en clair, ou n'ont pas une seule phrase à traduire :
    // une ligne de plus ferait doublon (carte culture, appariement, dialogue, écoute globale, jeu).
    default:
      return conceptMeaning(content, exercise.conceptIds);
  }
}

/**
 * Afficher le sens avant la réponse donnerait-il la réponse ? Vrai pour les formats dont la
 * question **est** le sens : reconnaître à l'oreille parmi des mots écrits, écrire ce qu'on
 * entend, traduire dans un sens ou dans l'autre.
 */
export function meaningGivesAnswer(exercise: Exercise): boolean {
  switch (exercise.type) {
    case "listen_pick_image":
    case "listen_pick_text":
    case "listen_transcribe":
    case "listen_gist":
    case "translate_to_fr":
    case "match_pairs":
    // Paire minimale : les deux options ne diffèrent que par le ton, et leurs sens diffèrent —
    // donner le sens, c'est désigner l'option.
    case "tone_minimal_pair":
      return true;
    default:
      return false;
  }
}

/**
 * Le sens de l'exercice affiché, fourni une fois par l'écran de séance et lu par la charpente de
 * chaque famille (`Layout`, `Frame`). Un contexte plutôt qu'une propriété : les vues sont chargées
 * à la demande, une par une, et n'ont pas à se passer cette ligne de main en main.
 *
 * `null` = rien à montrer **pour l'instant** : soit l'exercice n'a pas une phrase unique à
 * traduire, soit la traduction donnerait la réponse et on attend d'avoir répondu.
 */
export const ExerciseMeaningContext = createContext<ExerciseMeaning | null>(null);

/** La ligne de sens, sous la consigne : ce que la phrase veut dire, en langue d'interface. */
export function MeaningLine() {
  const meaning = useContext(ExerciseMeaningContext);
  if (!meaning || meaning.gloss.trim() === "") return null;
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid="exercise-meaning">
      <span className="sr-only">{t("ex.meaning")} </span>
      {meaning.vi && <Vi size="2xl">{meaning.vi}</Vi>}
      <span className="text-phu-sa">{meaning.gloss}</span>
    </p>
  );
}
