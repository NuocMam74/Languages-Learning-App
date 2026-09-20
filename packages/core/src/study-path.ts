import { isDue, isMastered, type SrsCard } from "./srs.ts";
import type { ConceptId, ContentIndex, Guide, PartOfSpeech } from "./types.ts";

/**
 * L'ordre de travail de « Réviser » (contrat phase16 §4).
 *
 * Constat à l'usage : la bibliothèque offre huit rayons de même poids — vocabulaire, catégories,
 * thèmes, grammaire, leçons, dialogues, conseils, notes — et douze catégories grammaticales à
 * l'intérieur de l'un d'eux. Tout est là, rien ne dit **par où commencer**. Un apprenant qui ouvre
 * cet écran doit choisir sa pédagogie lui-même, ce qui est précisément ce qu'il est venu chercher
 * ailleurs.
 *
 * Ce module range la bibliothèque en une **échelle**, du plus simple au plus difficile, et nomme le
 * barreau du jour. Il n'ajoute aucun contenu et ne verrouille rien : les rayons restent tous
 * ouverts (contrat phase8 §2, « la bibliothèque ne demande rien »). Il répond à une seule question,
 * celle qu'on se pose vraiment : *qu'est-ce que je travaille maintenant ?*
 *
 * L'ordre des barreaux n'est pas un goût. Il suit ce que la langue demande :
 *   1. **nommer** — les mots pleins (noms, verbes, adjectifs, adverbes), ce qui porte le sens ;
 *   2. **s'adresser** — les pronoms, qui décident de tout en vietnamien : on ne dit pas un mot
 *      sans avoir choisi qui on est et qui est l'autre ;
 *   3. **construire** — les fiches de grammaire et d'usage : l'ordre des mots, la question, la
 *      négation, les particules qui adoucissent ;
 *   4. **assembler** — les outils de la phrase (classificateurs, particules, interrogatifs,
 *      nombres, prépositions, conjonctions) : les classes fermées qu'aucun manuel de français ne
 *      prépare, et qu'il faut donc réviser en bloc ;
 *   5. **se débrouiller** — les phrases toutes faites et les fiches de situation.
 *
 * Par-dessus cette échelle, une urgence : ce que la répétition espacée réclame aujourd'hui. Elle
 * passe avant, toujours — un mot dû oublié aujourd'hui est du travail perdu.
 *
 * Ce que l'échelle ne couvre pas, délibérément : **les tons et la prononciation**. Ils ne se
 * révisent pas dans une liste — ils s'entendent et se répètent. Leur place est le parcours
 * (unités « L'oreille ») et le karaoké tonal, pas la bibliothèque. Le corpus le dit d'ailleurs
 * lui-même : aucun concept n'y est de type `tone` ou `sound`, les mots des leçons d'oreille sont
 * des mots comme les autres.
 */

export type RungId = "due" | "hard" | "words" | "pronouns" | "grammar" | "glue" | "speaking";

export type RungState =
  /** Rien de vu dans ce domaine : le barreau attend les leçons. */
  | "empty"
  /** Il y a du travail ici. */
  | "todo"
  /** Tout ce qui a été vu dans ce domaine est solide. */
  | "done";

export interface Rung {
  id: RungId;
  state: RungState;
  /** Éléments à travailler (mots dus, mots fragiles, fiches non lues). */
  todo: number;
  /** Éléments du domaine déjà rencontrés. */
  seen: number;
  /** Éléments du domaine que le cursus n'a pas encore ouverts : la taille réelle du chemin. */
  toCome: number;
  /** Concepts concernés, dans l'ordre du cursus (vide pour les barreaux de fiches). */
  conceptIds: ConceptId[];
  /** Fiches conseils concernées (barreau `grammar` et `speaking`). */
  guideIds: string[];
}

/** Catégories grammaticales de chaque barreau lexical. Un mot n'appartient qu'à un seul barreau. */
const RUNG_POS: Partial<Record<RungId, readonly PartOfSpeech[]>> = {
  words: ["noun", "verb", "adjective", "adverb"],
  pronouns: ["pronoun"],
  glue: ["classifier", "particle", "question", "numeral", "preposition", "conjunction"],
  speaking: ["phrase"],
};

/** Rechutes à partir desquelles un mot est « fragile ». Même seuil que la bibliothèque. */
export const FRAGILE_LAPSES = 2;

export interface StudyInput {
  /** Concepts déjà rencontrés, dans l'ordre du cursus (voir `seenConcepts` côté application). */
  seen: readonly ConceptId[];
  cards: readonly SrsCard[];
  /** Fiches conseils déjà lues. */
  readGuides: ReadonlySet<string>;
  now: Date;
}

/**
 * Un mot est « à travailler » s'il est dû, fragile, jamais travaillé, ou pas encore stabilisé.
 *
 * Exporté parce que l'écran compte les mêmes mots barreau par barreau **et** étape par étape :
 * deux définitions voisines donneraient un barreau « 3 à revoir » dont chaque étape se dit
 * « solide », ce qui ne veut plus rien dire.
 */
export function conceptNeedsWork(card: SrsCard | undefined, now: Date): boolean {
  if (!card || card.state === "new") return true;
  return isDue(card, now) || card.lapses >= FRAGILE_LAPSES || !isMastered(card);
}

/**
 * L'échelle complète, dans l'ordre. Tous les barreaux sont rendus, même vides : voir les marches
 * d'un coup d'œil, c'est comprendre où l'on va — un barreau vide dit « pas encore », pas
 * « interdit ».
 */
export function studyPath(content: ContentIndex, input: StudyInput): Rung[] {
  const { seen, cards, readGuides, now } = input;
  const cardOf = new Map(cards.map((c) => [c.conceptId, c]));
  const seenSet = new Set(seen);

  // Répartition des concepts vus et à venir par barreau.
  const inRung = (id: ConceptId, rung: RungId): boolean => {
    const pos = content.concepts.get(id)?.pos;
    return pos !== undefined && (RUNG_POS[rung] ?? []).includes(pos);
  };

  /** Barreau lexical, éventuellement accompagné des fiches conseils qui le préparent. */
  const rung = (id: RungId, guideKinds: readonly Guide["kind"][] = []): Rung => {
    const conceptIds = seen.filter((c) => inRung(c, id));
    const toCome = [...content.concepts.keys()].filter((c) => !seenSet.has(c) && inRung(c, id)).length;
    const guideIds = orderedGuides(content, guideKinds).map((g) => g.id);
    const unread = guideIds.filter((g) => !readGuides.has(g)).length;
    const todo = conceptIds.filter((c) => conceptNeedsWork(cardOf.get(c), now)).length + unread;
    const seenHere = conceptIds.length + (guideIds.length - unread);
    return { id, state: rungState(conceptIds.length + guideIds.length, todo), todo, seen: seenHere, toCome, conceptIds, guideIds };
  };

  const dueIds = seen.filter((c) => {
    const card = cardOf.get(c);
    return card !== undefined && isDue(card, now);
  });
  const hardIds = seen.filter((c) => (cardOf.get(c)?.lapses ?? 0) >= FRAGILE_LAPSES);

  return [
    urgent("due", dueIds, seenSet),
    urgent("hard", hardIds, seenSet),
    rung("words"),
    rung("pronouns"),
    // La grammaire n'a pas de vocabulaire propre : c'est le barreau des fiches « comment ça marche ».
    rung("grammar", ["grammar", "usage"]),
    rung("glue"),
    rung("speaking", ["situation"]),
  ];
}

function urgent(id: RungId, conceptIds: readonly ConceptId[], seenSet: ReadonlySet<ConceptId>): Rung {
  return {
    id,
    state: conceptIds.length > 0 ? "todo" : seenSet.size > 0 ? "done" : "empty",
    todo: conceptIds.length,
    seen: conceptIds.length,
    toCome: 0,
    conceptIds: [...conceptIds],
    guideIds: [],
  };
}

function rungState(seen: number, todo: number): RungState {
  if (seen === 0) return "empty";
  return todo > 0 ? "todo" : "done";
}

/** Fiches d'un ou plusieurs rayons, dans l'ordre que le contenu impose (contrat phase15 §1). */
export function orderedGuides(content: ContentIndex, kinds: readonly Guide["kind"][]): Guide[] {
  return [...content.guides.values()]
    .filter((g) => kinds.includes(g.kind))
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
}

/**
 * Le barreau du jour : le premier qui a du travail. Null = tout est solide (ou rien n'a encore été
 * vu) — et alors la bonne réponse n'est pas de réviser, c'est d'avancer dans le parcours.
 */
export function nextRung(path: readonly Rung[]): Rung | null {
  return path.find((rung) => rung.state === "todo") ?? null;
}

/** Progression d'ensemble : barreaux solides sur barreaux entamés. Vaut 0 quand rien n'est entamé. */
export function studyProgress(path: readonly Rung[]): { done: number; started: number } {
  const started = path.filter((r) => r.state !== "empty").length;
  return { done: path.filter((r) => r.state === "done").length, started };
}
