import { isStepPlayable, type MediaIndex } from "./media.ts";
import { lexicalKey } from "./prerequisites.ts";
import type { ConceptId, ContentIndex, Lesson, LessonStep } from "./types.ts";

/**
 * Mise en pratique d'une leçon (spec §4.3, bloc 4) : **chaque mot que la leçon fait voir doit
 * revenir dans au moins un exercice où c'est lui la réponse.**
 *
 * Le manque était mesurable et se voyait à l'écran. La leçon 1 présente les cinq tons de « ma »
 * (ma, mà, má, mả, mạ) ; un seul d'entre eux, « má », était la réponse d'un exercice. Les quatre
 * autres n'étaient que **montrés** — une carte culture, trois paires minimales, une répétition —
 * et on quittait la leçon sans avoir jamais eu à les reconnaître. Sur le corpus, 296 concepts dans
 * 124 leçons sur 194 étaient dans ce cas.
 *
 * ## Compter la mise en pratique sans enregistrement
 *
 * Une étape qui exige une voix native et ne l'a pas est **retirée de la séance** (contrat phase6
 * §1), et les étapes de production orale le sont toujours. Le pack n'a aujourd'hui aucun
 * enregistrement : compter `tone_identify` ou `speak_repeat` comme une mise en pratique
 * compterait un exercice que personne ne joue. Le décompte se fait donc, par défaut, **avec un
 * index de médias vide** : ce qui tient sans le moindre fichier audio tiendra a fortiori le jour
 * où les 1630 enregistrements existeront.
 *
 * Ce n'est pas un jugement sur les exercices tonals — ils restent le cœur de la leçon 1. C'est le
 * refus d'appeler « mise en pratique » ce qui disparaît du parcours réel.
 */

/** Aucun enregistrement : la référence du décompte (voir en-tête). */
const NO_MEDIA: MediaIndex = new Set<string>();

/** La forme apparaît-elle dans la phrase comme **suite de mots entière** ? (« ba » n'est pas dans « bàn ».) */
function containsForm(sentence: string, form: string): boolean {
  const haystack = lexicalKey(sentence).split(" ").filter(Boolean);
  const needle = lexicalKey(form).split(" ").filter(Boolean);
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

/** Concepts de la leçon dont la forme est produite par cette phrase. */
function conceptsInSentence(content: ContentIndex, lesson: Lesson, sentence: string): ConceptId[] {
  return lesson.concepts.filter((id) => {
    const concept = content.concepts.get(id);
    return concept !== undefined && containsForm(sentence, concept.vi);
  });
}

/**
 * Concepts dont cette étape fait **la réponse** — pas ceux qu'elle montre au passage.
 *
 * Un distracteur ne compte pas (on ne le choisit pas), une carte culture ne compte pas (elle
 * n'interroge aucun mot), et le texte d'un `fill_gap` ne compte que par sa réponse : c'est elle
 * qu'on a dû trouver. `tone_minimal_pair` compte pour tous ses `audioConcepts` : la cible est
 * tirée au sort parmi eux à chaque passage.
 */
export function practicedConcepts(content: ContentIndex, lesson: Lesson, step: LessonStep): ConceptId[] {
  switch (step.type) {
    case "listen_pick_text":
    case "listen_pick_image":
    case "listen_transcribe":
    case "tone_identify":
    case "tone_produce":
    case "speak_repeat":
      return [step.concept];
    case "match_pairs":
      return [...step.concepts];
    case "speak_answer":
      return [...step.accepted];
    case "speak_roleplay":
      return step.prompts.map((p) => p.concept);
    case "tone_minimal_pair":
      return [...(step.audioConcepts ?? [])];
    case "fill_gap":
      return conceptsInSentence(content, lesson, step.answer);
    case "build_sentence":
      return [...(step.audioConcept ? [step.audioConcept] : []), ...conceptsInSentence(content, lesson, step.target)];
    case "translate_to_vi":
      // `accepted[0]` est la forme de référence ; les autres ne sont que des tolérances.
      return conceptsInSentence(content, lesson, step.accepted[0] ?? "");
    case "translate_to_fr":
      return conceptsInSentence(content, lesson, step.source);
    case "game":
      // Une réserve implicite puise dans la leçon (ou plus large) : tous les mots de la leçon y passent.
      return Array.isArray(step.conceptPool) ? [...step.conceptPool] : [...lesson.concepts];
    // Ni réponse ni concept : carte culture, écoute globale, repérage de variante, dialogue à
    // embranchements (on y choisit un registre, pas un mot).
    default:
      return [];
  }
}

export interface PracticeOptions {
  /**
   * Médias présents. Défaut : **aucun** — une étape qui exige une voix native ne compte pas tant
   * que l'enregistrement n'existe pas (voir en-tête).
   */
  media?: MediaIndex | null;
}

/**
 * Combien de fois chaque concept de la leçon est mis en pratique, étapes retirées de la séance
 * exclues. Toutes les clés de `lesson.concepts` sont présentes, à 0 si rien ne les reprend.
 */
export function practiceCounts(content: ContentIndex, lesson: Lesson, opts: PracticeOptions = {}): Map<ConceptId, number> {
  const counts = new Map<ConceptId, number>(lesson.concepts.map((id) => [id, 0]));
  const media = opts.media === undefined ? NO_MEDIA : opts.media;
  for (const step of lesson.steps) {
    if (!isStepPlayable(content, step, { media })) continue;
    for (const id of practicedConcepts(content, lesson, step)) {
      const seen = counts.get(id);
      if (seen !== undefined) counts.set(id, seen + 1);
    }
  }
  return counts;
}

/** Concepts de la leçon que rien n'y fait pratiquer, dans l'ordre de `lesson.concepts`. */
export function unpracticedConcepts(content: ContentIndex, lesson: Lesson, opts: PracticeOptions = {}): ConceptId[] {
  return [...practiceCounts(content, lesson, opts)].filter(([, n]) => n === 0).map(([id]) => id);
}

/**
 * Exercices notés d'un niveau (contrat phase21 §1) : **20**, pour que la réussite se lise comme une
 * note sur 20 — une bonne réponse, un point. Sans un compte fixe, « 6 sur 8 » à un niveau et
 * « 11 sur 14 » au suivant ne se comparent pas, et une moyenne sur plusieurs niveaux ne veut rien
 * dire.
 */
export const GRADED_STEPS_PER_LESSON = 20;

/**
 * Le mini-jeu ne compte pas dans la note. Il se passe (« pas assez de mots pour jouer »), il se
 * note au ratio de manches et non à la question, et son résultat dépend d'un chronomètre : trois
 * raisons de le laisser hors du barème. Il reste dans la leçon, comme récréation finale.
 */
const UNSCORED: ReadonlySet<LessonStep["type"]> = new Set(["game"]);

/** Étapes de la leçon qui comptent dans la note, dans l'ordre (étapes retirées de la séance exclues). */
export function gradedSteps(content: ContentIndex, lesson: Lesson, opts: PracticeOptions = {}): LessonStep[] {
  const media = opts.media === undefined ? NO_MEDIA : opts.media;
  return lesson.steps.filter((step) => !UNSCORED.has(step.type) && isStepPlayable(content, step, { media }));
}

/**
 * Note d'un niveau sur 20, à partir de la part de réussite (0..1) que le moteur calcule au premier
 * essai (`lessonScore`). Arrondie au demi-point : « 15,5/20 » se lit, « 15,4783 » non.
 */
export function markOutOf20(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * GRADED_STEPS_PER_LESSON * 2) / 2;
}
