import { nfc } from "./text.ts";
import type { ConceptId, Concept, ContentIndex, Lesson, LessonStep, Localized, StepType } from "./types.ts";

/**
 * Ce qu'une leçon **exige** de savoir avant d'être jouable (contrat phase16 §1).
 *
 * Constat à l'usage : on arrive sur un `build_sentence` et on doit assembler « Dạ, con cảm ơn
 * chú. » avec des jetons qu'aucun écran n'a jamais montrés. L'application savait déjà présenter
 * les mots que la leçon *introduit* (`review.srsIntroduce`, contrat phase10 §1) — mais les
 * exercices, eux, puisent dans tout le reste : les mots des leçons d'avant, et parfois des formes
 * que rien n'a présenté du tout. Mesuré sur le corpus au moment d'écrire ce module : **55 leçons
 * sur 194** font produire au moins un mot jamais présenté, dont 68 occurrences en `build_sentence`.
 *
 * Ce module nomme cette dette. Il distingue deux choses que le moteur confondait :
 *   - ce que l'étape fait **reconnaître** (les leurres, les paires minimales) — s'y tromper est le
 *     but de l'exercice, on n'a pas à les connaître d'avance ;
 *   - ce que l'étape fait **produire** (la bonne réponse, les jetons de la phrase cible) — là,
 *     ne pas connaître, c'est être bloqué.
 *
 * Seul le second compte comme prérequis. Le reste de la chaîne (fiche de préparation, garde du
 * contenu) se construit dessus.
 */

/** Ce qu'une étape fait produire : des concepts nommés, et des formes brutes écrites dans l'étape. */
export interface Demands {
  concepts: ConceptId[];
  /** Formes telles qu'écrites dans le contenu (jetons, réponse d'un trou, traduction attendue). */
  forms: string[];
}

/** Forme comparable : minuscules, sans ponctuation, tons et diacritiques **conservés** (ma ≠ má). */
export function lexicalKey(text: string): string {
  return nfc(text)
    .toLowerCase()
    .replace(/[.,!?…:;"'«»()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mots d'une forme : « cảm ơn » donne la forme entière et ses deux syllabes. */
function words(text: string): string[] {
  const key = lexicalKey(text);
  if (key === "") return [];
  const parts = key.split(" ");
  return parts.length > 1 ? [key, ...parts] : [key];
}

const empty: Demands = { concepts: [], forms: [] };

/**
 * Ce que l'étape fait produire. Les types absents de ce `switch` ne demandent rien d'acquis :
 * une carte culture se lit, une paire minimale s'écoute, un `listen_pick_*` se reconnaît parmi des
 * leurres — et c'est justement ce que la leçon apprend.
 */
export function stepDemands(step: LessonStep): Demands {
  switch (step.type) {
    case "match_pairs":
      return { concepts: [...step.concepts], forms: [] };
    case "build_sentence":
      // La cible, pas les jetons : un jeton en trop est un leurre, comme ailleurs.
      return { concepts: [], forms: [step.target] };
    case "fill_gap":
      return { concepts: [], forms: [step.answer] };
    case "translate_to_vi":
      // `accepted[0]` est la forme de référence ; les autres sont des tolérances.
      return { concepts: [], forms: step.accepted.slice(0, 1) };
    case "translate_to_fr":
      return { concepts: [], forms: [step.source] };
    case "speak_answer":
      return { concepts: [...step.accepted], forms: [] };
    case "speak_roleplay":
      return { concepts: step.prompts.map((p) => p.concept), forms: [] };
    case "listen_transcribe":
      return { concepts: [step.concept], forms: [] };
    default:
      return empty;
  }
}

/** Tout ce que les étapes d'une leçon font produire, dédoublonné, dans l'ordre des étapes. */
export function lessonDemands(lesson: Lesson): Demands {
  const concepts = new Set<ConceptId>();
  const forms = new Set<string>();
  for (const step of lesson.steps) {
    const demands = stepDemands(step);
    for (const id of demands.concepts) concepts.add(id);
    for (const form of demands.forms) forms.add(form);
  }
  return { concepts: [...concepts], forms: [...forms] };
}

/** Formes qu'un concept rend disponibles : sa forme entière et, si elle est composée, ses mots. */
export function conceptForms(concept: Pick<Concept, "vi">): string[] {
  return words(concept.vi);
}

/**
 * Index des formes du pack : chaque forme lexicale vers les concepts qui la portent. Sert à dire
 * « ce jeton existe dans le corpus mais rien ne l'a présenté » — le cas le plus fréquent, et le
 * plus facile à corriger côté contenu.
 *
 * Les concepts dont la forme **est** exactement celle cherchée passent devant ceux qui ne font que
 * la contenir : pour « em », on veut `c_em`, pas les cinquante phrases où le mot apparaît.
 */
export function formIndex(content: Pick<ContentIndex, "concepts">): ReadonlyMap<string, ConceptId[]> {
  const exact = new Map<string, ConceptId[]>();
  const within = new Map<string, ConceptId[]>();
  const push = (map: Map<string, ConceptId[]>, key: string, id: ConceptId) => {
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  for (const concept of content.concepts.values()) {
    const whole = lexicalKey(concept.vi);
    for (const form of conceptForms(concept)) push(form === whole ? exact : within, form, concept.id);
  }
  const index = new Map<string, ConceptId[]>(within);
  for (const [form, ids] of exact) index.set(form, [...ids, ...(within.get(form) ?? [])]);
  return index;
}

/** Au-delà, la liste de candidats n'aide plus à corriger : elle noie le message. */
const MAX_CANDIDATES = 3;

/** Concepts dont la forme entière est exactement ce mot : les seuls qui l'enseignent vraiment. */
function exactCandidates(content: Pick<ContentIndex, "concepts">, index: ReadonlyMap<string, ConceptId[]>, form: string): ConceptId[] {
  return (index.get(form) ?? []).filter((id) => lexicalKey(content.concepts.get(id)?.vi ?? "") === form);
}

/** Ce qui manque à l'appel : un concept jamais présenté, ou une forme que rien ne couvre. */
export interface UnmetDemand {
  kind: "concept" | "form";
  /** Identifiant du concept, ou forme telle qu'écrite. */
  what: string;
  /**
   * Concepts du pack dont la forme **est** ce mot : la correction à faire côté contenu, à ajouter
   * au `srsIntroduce` d'une leçon amont. Vide = le mot n'existe pas encore comme concept, il faut
   * l'écrire — et en attendant, la fiche de préparation montre la phrase modèle entière.
   */
  candidates: ConceptId[];
  /** Étape qui l'exige. */
  step: StepType;
}

export interface KnownLexicon {
  concepts: ReadonlySet<ConceptId>;
  forms: ReadonlySet<string>;
}

/** Vocabulaire disponible à partir d'un ensemble de concepts connus. */
export function lexiconOf(content: Pick<ContentIndex, "concepts">, conceptIds: Iterable<ConceptId>): KnownLexicon {
  const concepts = new Set<ConceptId>();
  const forms = new Set<string>();
  for (const id of conceptIds) {
    concepts.add(id);
    const concept = content.concepts.get(id);
    if (concept) for (const form of conceptForms(concept)) forms.add(form);
  }
  return { concepts, forms };
}

/** Une forme est couverte si on la connaît entière, ou si tous ses mots sont connus. */
function formCovered(form: string, known: KnownLexicon): boolean {
  const key = lexicalKey(form);
  if (key === "" || known.forms.has(key)) return true;
  const parts = key.split(" ");
  return parts.length > 1 && parts.every((part) => known.forms.has(part));
}

/**
 * Ce que la leçon exige et que le lexique connu ne couvre pas. Les nombres écrits en chiffres et
 * les mots capitalisés au milieu d'une phrase sont ignorés : « Lan », « Sài Gòn », « 1 » sont des
 * noms propres et des chiffres, pas du vocabulaire à apprendre — on les lit dans la traduction.
 */
export function unmetDemands(content: Pick<ContentIndex, "concepts">, lesson: Lesson, known: KnownLexicon): UnmetDemand[] {
  const index = formIndex(content);
  const out: UnmetDemand[] = [];
  const seen = new Set<string>();

  for (const step of lesson.steps) {
    const demands = stepDemands(step);
    for (const id of demands.concepts) {
      if (known.concepts.has(id) || seen.has(`c:${id}`)) continue;
      seen.add(`c:${id}`);
      out.push({ kind: "concept", what: id, candidates: [], step: step.type });
    }
    for (const form of demands.forms) {
      if (formCovered(form, known)) continue;
      for (const part of lexicalKey(form).split(" ")) {
        if (part === "" || known.forms.has(part) || seen.has(`f:${part}`)) continue;
        if (isProperNounOrNumber(form, part)) continue;
        seen.add(`f:${part}`);
        out.push({ kind: "form", what: part, candidates: exactCandidates(content, index, part).slice(0, MAX_CANDIDATES), step: step.type });
      }
    }
  }
  return out;
}

/**
 * Nom propre ou nombre à l'intérieur d'une forme. On ne demande pas d'« apprendre » Lan, Sài Gòn,
 * Lê Lợi ou 1 : la traduction de l'exercice les donne, et les ajouter au vocabulaire polluerait la
 * bibliothèque. Une majuscule en tête de phrase ne compte pas — sinon le premier mot de chaque
 * phrase passerait à la trappe.
 */
function isProperNounOrNumber(form: string, part: string): boolean {
  if (/^\p{Nd}+$/u.test(part)) return true;
  // Découpage en mots **en gardant les fins de phrase** : le mot qui suit un point peut être
  // capitalisé sans être un nom propre.
  let sentenceStart = true;
  for (const token of nfc(form).split(/([^\p{L}\p{Nd}]+)/u)) {
    if (token === "") continue;
    if (!/\p{L}|\p{Nd}/u.test(token)) {
      if (/[.!?]/.test(token)) sentenceStart = true;
      continue;
    }
    const capital = token !== token.toLowerCase();
    if (token.toLowerCase() === part && capital && !sentenceStart) return true;
    sentenceStart = false;
  }
  return false;
}

/**
 * Lexique acquis avant une leçon donnée : tous les concepts présentés par les leçons **qui la
 * précèdent dans le cursus**. C'est la référence du contrôle de contenu — indépendante de ce qu'un
 * apprenant a réellement fait.
 */
export function lexiconBefore(content: ContentIndex, lessonId: string): KnownLexicon {
  const order = content.curriculum.units.flatMap((unit) => unit.lessons);
  const ids: ConceptId[] = [];
  for (const id of order) {
    if (id === lessonId) break;
    for (const conceptId of content.lessons.get(id)?.review.srsIntroduce ?? []) ids.push(conceptId);
  }
  return lexiconOf(content, ids);
}

/** Lexique d'une leçon : ce qu'elle présente elle-même, ajouté à ce qui est déjà connu. */
export function withLesson(content: Pick<ContentIndex, "concepts">, known: KnownLexicon, lesson: Lesson): KnownLexicon {
  const own = lexiconOf(content, lesson.review.srsIntroduce);
  return {
    concepts: new Set([...known.concepts, ...own.concepts]),
    forms: new Set([...known.forms, ...own.forms]),
  };
}

// ---------------------------------------------------------------------------
// La fiche de préparation

/**
 * Phrase modèle montrée en préparation : celle qu'on va devoir assembler alors qu'elle contient
 * une forme que rien n'a présentée. Montrer la phrase entière n'est pas divulgâcher — la remettre
 * dans l'ordre reste le travail ; l'assembler à l'aveugle, lui, n'apprend rien.
 */
export interface ModelSentence {
  vi: string;
  translation: Localized;
}

/**
 * Tout ce qu'il faut avoir consulté avant de lancer les exercices d'une leçon (contrat phase16 §2).
 *
 * Quatre volets, du plus neuf au plus lointain. Un volet vide disparaît — on ne fait pas lire une
 * section pour rien ; si les quatre sont vides, il n'y a rien à préparer (leçon de révision, test
 * d'unité, leçon déjà connue) et la séance démarre directement.
 */
export interface Briefing {
  /** Les mots que la leçon introduit et qu'on ne connaît pas : le cœur de la fiche. */
  discover: ConceptId[];
  /**
   * Mots plus anciens que les exercices vont faire produire. Deux origines : ceux que la leçon
   * réutilise sans les réintroduire, et ceux qu'aucune leçon n'a jamais présentés (la dette
   * mesurée plus haut) — dans les deux cas, les voir avant évite d'être bloqué.
   */
  recall: ConceptId[];
  /** Phrases à assembler dont une forme échappe au corpus. */
  models: ModelSentence[];
  /** Fiches conseils que l'unité désigne comme lecture préalable. */
  guides: string[];
  /** Formats d'exercice jamais rencontrés : on explique la consigne avant de la noter. */
  formats: StepType[];
}

export interface BriefingInput {
  /** Concepts déjà rencontrés (cartes SRS, leçons terminées). */
  known: ReadonlySet<ConceptId>;
  /** Formats d'exercice déjà rencontrés. */
  seenFormats?: ReadonlySet<StepType>;
  /** Fiches déjà lues : une fiche relue à chaque leçon de l'unité deviendrait du bruit. */
  readGuides?: ReadonlySet<string>;
  /**
   * Indices des étapes réellement jouées (`playableStepIndexes`). Une étape retirée faute
   * d'enregistrement natif ne doit rien exiger : préparer un mot pour un exercice qui ne sera pas
   * joué, ou expliquer la consigne d'un mini-jeu qu'on ne verra pas, serait du bruit. Absent =
   * toutes les étapes.
   */
  playable?: readonly number[];
}

/** Volets non vides d'une fiche : ce que le compteur « vu » doit atteindre. */
export function briefingParts(briefing: Briefing): number {
  return (
    (briefing.discover.length > 0 ? 1 : 0) +
    (briefing.recall.length > 0 ? 1 : 0) +
    (briefing.models.length > 0 ? 1 : 0) +
    briefing.guides.length +
    briefing.formats.length
  );
}

export function isBriefingEmpty(briefing: Briefing): boolean {
  return briefingParts(briefing) === 0;
}

/** Fiches conseils attachées à l'unité d'une leçon (`Unit.guides`, contrat phase16 §3). */
export function unitGuides(content: ContentIndex, lesson: Lesson): string[] {
  const unit = content.curriculum.units.find((u) => u.id === lesson.unit);
  return (unit?.guides ?? []).filter((id) => content.guides.has(id));
}

export const EMPTY_BRIEFING: Briefing = { discover: [], recall: [], models: [], guides: [], formats: [] };

export function lessonBriefing(content: ContentIndex, lesson: Lesson, input: BriefingInput): Briefing {
  // Un test d'unité ne se prépare pas : il vérifie ce qui a été appris. Lui poser une fiche en
  // amont, ce serait distribuer l'antisèche avec l'épreuve (contrat phase10 §1 le disait déjà).
  // Si un test fait produire un mot jamais vu, c'est le contenu qu'il faut corriger — la garde de
  // `content-checks` le signale nommément.
  if (lesson.kind === "unit_test") return EMPTY_BRIEFING;
  const { known, seenFormats = new Set<StepType>(), readGuides = new Set<string>(), playable } = input;
  const steps = playable ? playable.flatMap((i) => lesson.steps[i] ?? []) : lesson.steps;

  const discover = lesson.review.srsIntroduce.filter((id) => !known.has(id) && content.concepts.has(id));
  const base = lexiconOf(content, [...known, ...discover]);
  // Lexique qui s'enrichit au fil des étapes : un mot rappelé une fois n'est plus à rappeler.
  const lexicon = { concepts: new Set(base.concepts), forms: new Set(base.forms) };
  const index = formIndex(content);

  const recall: ConceptId[] = [];
  const models: ModelSentence[] = [];
  const seenModels = new Set<string>();
  const pushRecall = (id: ConceptId) => {
    if (!content.concepts.has(id) || discover.includes(id) || recall.includes(id)) return;
    recall.push(id);
    for (const form of conceptForms(content.concepts.get(id)!)) lexicon.forms.add(form);
    lexicon.concepts.add(id);
  };

  for (const step of steps) {
    const demands = stepDemands(step);
    for (const id of demands.concepts) if (!lexicon.concepts.has(id)) pushRecall(id);

    for (const form of demands.forms) {
      if (formCovered(form, lexicon)) continue;
      // Chaque mot manquant qui existe dans le corpus devient un rappel ; s'il en reste un seul
      // hors corpus, on montre la phrase entière, traduite.
      let orphan = false;
      for (const part of lexicalKey(form).split(" ")) {
        if (part === "" || lexicon.forms.has(part)) continue;
        if (isProperNounOrNumber(form, part)) continue;
        // Un mot ne se rappelle que par le concept qui **est** ce mot. Rappeler « nha » en
        // montrant « Đợi chút nha » n'apprendrait pas le mot, seulement la phrase — et cette
        // phrase, la fiche la montre déjà comme modèle, entière et traduite.
        const candidate = exactCandidates(content, index, part)[0];
        if (candidate) pushRecall(candidate);
        else orphan = true;
      }
      if (!orphan) continue;
      const model = modelOf(step);
      if (model && !seenModels.has(model.vi)) {
        seenModels.add(model.vi);
        models.push(model);
      }
    }
  }

  const formats = [...new Set(steps.map((s) => s.type))].filter((type) => !seenFormats.has(type) && EXPLAINED_FORMATS.has(type));

  return {
    discover,
    recall,
    models,
    guides: unitGuides(content, lesson).filter((id) => !readGuides.has(id)),
    formats,
  };
}

/** Phrase modèle d'une étape, quand elle en porte une traduite. */
function modelOf(step: LessonStep): ModelSentence | null {
  if (step.type === "build_sentence") return { vi: step.target, translation: step.translation };
  if (step.type === "fill_gap" && step.translation) return { vi: step.text.replace("___", step.answer), translation: step.translation };
  if (step.type === "translate_to_vi") return { vi: step.accepted[0] ?? "", translation: step.source };
  return null;
}

/**
 * Formats dont la consigne mérite une explication la première fois. Les formats à choix multiple
 * s'expliquent d'eux-mêmes — une question, des réponses ; ceux-ci ne s'expliquent pas tout seuls :
 * on assemble, on relie, on parle, on tape.
 */
export const EXPLAINED_FORMATS: ReadonlySet<StepType> = new Set<StepType>([
  "build_sentence",
  "match_pairs",
  "fill_gap",
  "listen_transcribe",
  "translate_to_vi",
  "translate_to_fr",
  "speak_repeat",
  "speak_answer",
  "speak_roleplay",
  "dialogue_choice",
  "tone_produce",
  "game",
]);
