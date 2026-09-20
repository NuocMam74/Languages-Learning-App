import type { StepType } from "@parlo/core";
import type { MessageKey } from "../i18n/index.ts";

/**
 * Le nom d'un format d'exercice, en français courant.
 *
 * Un seul tableau pour toute l'application : la fiche de préparation l'emploie pour annoncer une
 * consigne qu'on n'a jamais vue (contrat phase16 §2), les favoris pour dire ce qu'on a aimé
 * (contrat phase18 §3). Sans lui, un écran finit par afficher `culture_card` à un apprenant — ce
 * qui est arrivé, et se voit.
 *
 * **Tous** les types y figurent, y compris ceux dont la consigne va de soi : c'est ce qui garantit
 * qu'aucun écran ne retombe sur l'identifiant technique.
 */
export const FORMAT_TITLE: Record<StepType, MessageKey> = {
  culture_card: "format.title.culture_card",
  listen_pick_image: "format.title.listen_pick_image",
  listen_pick_text: "format.title.listen_pick_text",
  listen_transcribe: "brief.format.title.listen_transcribe",
  listen_gist: "format.title.listen_gist",
  tone_identify: "format.title.tone_identify",
  tone_minimal_pair: "format.title.tone_minimal_pair",
  tone_produce: "brief.format.title.tone_produce",
  speak_repeat: "brief.format.title.speak_repeat",
  speak_answer: "brief.format.title.speak_answer",
  speak_roleplay: "brief.format.title.speak_roleplay",
  dialogue_choice: "brief.format.title.dialogue_choice",
  match_pairs: "brief.format.title.match_pairs",
  build_sentence: "brief.format.title.build_sentence",
  fill_gap: "brief.format.title.fill_gap",
  translate_to_vi: "brief.format.title.translate_to_vi",
  translate_to_fr: "brief.format.title.translate_to_fr",
  spot_the_south: "format.title.spot_the_south",
  game: "brief.format.title.game",
};
