import { nfc, stripTones } from "./text.ts";
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
 *
 * Le contrat phase26 §4 a ajouté une règle à côté : les leurres, s'ils n'ont pas à être
 * **produits**, doivent être **connus** — choisir parmi des mots jamais vus, c'est deviner. Voir
 * `unmetExposure` plus bas.
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
    .replace(/[.,!?…:;"'«»()\-–—¿¡]/g, " ")
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
  // Mis en cache par table de concepts : la fiche de préparation et les gardes le redemandent à
  // chaque leçon. Un index découpé s'enrichit en place quand une unité se charge (contrat phase12)
  // — la taille change alors, et l'index est reconstruit.
  const cached = formIndexCache.get(content.concepts);
  if (cached && cached.size === content.concepts.size) return cached.index;
  const index = buildFormIndex(content);
  formIndexCache.set(content.concepts, { size: content.concepts.size, index });
  return index;
}

const formIndexCache = new WeakMap<ReadonlyMap<ConceptId, Concept>, { size: number; index: ReadonlyMap<string, ConceptId[]> }>();

function buildFormIndex(content: Pick<ContentIndex, "concepts">): ReadonlyMap<string, ConceptId[]> {
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
// Ce qu'une leçon fait voir (contrat phase26 §4)

/**
 * La garde des prérequis ne regarde que ce qu'on **produit**. Retour d'usage : ce n'est pas assez.
 * Dès le niveau 2, on choisissait « chào » parmi « giả sử » et « đối diện », on complétait une phrase
 * parmi « nước mía » et « hết hạn », et le conseil affiché après la réponse parlait de « hồng ».
 * Des mots que rien n'avait présentés. Choisir parmi des mots inconnus, c'est deviner ; un conseil
 * qui s'appuie sur des mots inconnus n'explique rien.
 *
 * Deux familles, deux règles :
 *   - les **leurres** (options d'un choix, jetons en trop, images voisines, reste d'une phrase à
 *     trous) : déjà appris. Seule exception, les variantes tonales de la bonne réponse (ma / má /
 *     mà) : entendre la différence, c'est justement l'exercice ;
 *   - les mots **cités** par un conseil ou une carte culture : appris, variante tonale d'un mot
 *     appris (le conseil les oppose), ou présentés par la fiche de préparation, qui les montre avec
 *     leur traduction avant la séance (volet `cited`).
 */
export interface Exposure {
  /** Formes montrées comme choix possibles : elles doivent être connues. */
  decoys: string[];
  /** Mots vietnamiens cités dans un texte en langue d'interface. */
  cited: string[];
  /** Textes d'où viennent ces mots : une expression citée (thời tiết) s'y retrouve entière. */
  texts: string[];
  /** Forme de la bonne réponse : ses variantes tonales sont des leurres légitimes. */
  target: string | null;
}

/** ngã, brève (ă), hỏi, corne (ơ, ư), nặng : aucune n'existe en français. */
const VI_ONLY_MARKS = /[\u0303\u0306\u0309\u031B\u0323]/u;

/**
 * Le mot, pris dans un texte français, est-il vietnamien ? On ne retient que les graphies
 * impossibles en français : đ, ă, ơ, ư, les marques hỏi, ngã et nặng, l'aigu hors du « e », le grave
 * hors de « a, e, u », un ton posé sur un circonflexe. « là », « à » ou « ma » restent français —
 * faute de mieux, et c'est le bon côté pour se tromper : un faux positif ferait écrire un concept
 * pour un mot français.
 */
export function isVietnameseWord(token: string): boolean {
  const decomposed = token.normalize("NFD").toLowerCase();
  if (/đ/u.test(token.toLowerCase()) || VI_ONLY_MARKS.test(decomposed)) return true;
  const letters = decomposed.match(/\p{L}\p{M}*/gu) ?? [];
  return letters.some((cluster) => {
    const base = cluster[0]!;
    const marks = cluster.slice(1);
    if (marks.includes("\u0301") && base !== "e") return true;
    if (marks.includes("\u0300") && !"aeu".includes(base)) return true;
    return marks.includes("\u0302") && /[\u0300\u0301]/u.test(marks);
  });
}

/**
 * Mots vietnamiens d'un texte en langue d'interface. Ce qui est entre guillemets français n'en fait
 * pas partie : c'est une prononciation figurée (on écrit bạn, on entend « bạng »), pas un mot à
 * connaître.
 */
export function citedWords(text: string): string[] {
  return nfc(text)
    .replace(/«[^»]*»/gu, " ")
    .split(/[^\p{L}\p{M}]+/u)
    // Une majuscule dans un texte français, c'est un nom propre (Sài Gòn, Tết) : on ne l'apprend pas.
    .filter((token) => token !== "" && token === token.toLowerCase() && isVietnameseWord(token))
    .map((token) => lexicalKey(token));
}

/**
 * Formes du Nord que le pack met en regard du Sud (variantes lexicales, `northernEquivalent`) : un
 * conseil qui dit « au Nord, on dit bố » les cite pour qu'on les reconnaisse, et l'exercice de
 * repérage les présente avec leur sens.
 */
export function northernForms(content: Pick<ContentIndex, "concepts" | "variants">): ReadonlySet<string> {
  const out = new Set<string>();
  const add = (text: string) => {
    for (const word of lexicalKey(text).split(" ")) if (word) out.add(word);
  };
  for (const entry of content.variants?.entries ?? []) for (const form of entry.north) add(form);
  for (const concept of content.concepts.values()) if (concept.northernEquivalent) add(concept.northernEquivalent);
  return out;
}

type ExposureContent = Pick<ContentIndex, "concepts" | "culture" | "variants" | "pack">;

export function stepExposure(content: ExposureContent, step: LessonStep): Exposure {
  // Le repérage des mots cités est propre à l'orthographe vietnamienne : sur un autre pack, il
  // prendrait « día » pour un mot vietnamien.
  const tonal = content.pack.features.includes("tones");
  const words = (text: string) => (tonal ? citedWords(text) : []);
  const own = "explain" in step && step.explain ? [step.explain.fr] : [];
  const cited = own.flatMap(words);
  const texts = own;
  const form = (id: ConceptId) => content.concepts.get(id)?.vi ?? "";
  switch (step.type) {
    case "listen_pick_text":
      return { decoys: [...step.distractors], cited, texts, target: form(step.concept) };
    case "listen_pick_image":
      return { decoys: step.distractors.map(form).filter(Boolean), cited, texts, target: form(step.concept) };
    case "fill_gap": {
      const rest = step.text.replace("___", " ");
      return { decoys: [...step.options.filter((o) => lexicalKey(o) !== lexicalKey(step.answer)), rest], cited, texts, target: step.answer };
    }
    case "build_sentence": {
      const wanted = new Set(lexicalKey(step.target).split(" "));
      return { decoys: step.tokens.filter((t) => !lexicalKey(t).split(" ").every((w) => wanted.has(w))), cited, texts, target: null };
    }
    case "culture_card": {
      const card = content.culture.get(step.ref);
      if (!card) return { decoys: [], cited: [], texts: [], target: null };
      const french = [card.body.fr, card.question.prompt.fr, ...card.question.options.map((o) => o.fr)];
      // La ligne en vietnamien se lit entière : chacun de ses mots compte, noms propres mis à part.
      const vi = card.vi && tonal ? lexicalKey(card.vi).split(" ").filter((w) => w !== "" && !isProperNounOrNumber(card.vi!, w)) : [];
      return { decoys: [], cited: [...french.flatMap(words), ...vi], texts: [...french, ...(card.vi ? [card.vi] : [])], target: null };
    }
    default:
      return { decoys: [], cited, texts, target: null };
  }
}

/** Ce que la leçon montre sans l'avoir appris. */
export interface UnmetExposure {
  kind: "decoy" | "cited";
  what: string;
  /** Concepts du pack qui **sont** ce mot : ce qu'il faudrait présenter plus tôt. */
  candidates: ConceptId[];
  step: StepType;
}

/**
 * Concept qui traduit un mot cité : celui qui **est** ce mot d'abord ; à défaut, une expression du
 * pack qui le contient et que le texte cite entière (« thời tiết : la météo » cite thời et tiết,
 * que seule l'expression traduit).
 */
function citedConcept(content: Pick<ContentIndex, "concepts">, index: ReadonlyMap<string, ConceptId[]>, word: string, texts: readonly string[]): ConceptId | undefined {
  const exact = exactCandidates(content, index, word)[0];
  if (exact) return exact;
  const haystacks = texts.map((t) => ` ${lexicalKey(t)} `);
  return (index.get(word) ?? []).find((id) => {
    const form = lexicalKey(content.concepts.get(id)?.vi ?? "");
    return form.includes(" ") && haystacks.some((h) => h.includes(` ${form} `));
  });
}

/** Variante tonale d'une forme connue : même syllabe, autre ton. */
function tonalVariantOf(word: string, forms: Iterable<string>): boolean {
  const base = stripTones(word);
  for (const form of forms) if (form !== word && stripTones(form) === base) return true;
  return false;
}

/** Le mot cité est-il déjà couvert, sans avoir à le présenter ? */
function citedCovered(word: string, known: KnownLexicon, knownForms: readonly string[], north: ReadonlySet<string>): boolean {
  return word === "" || known.forms.has(word) || north.has(word) || /^\p{Nd}+$/u.test(word) || tonalVariantOf(word, knownForms);
}

/**
 * Mots montrés par la leçon que le lexique connu ne couvre pas. Un mot cité qui a un concept n'y
 * figure pas : la fiche de préparation le présente (`citedToPresent`). Restent les leurres inconnus
 * et les mots cités que rien dans le pack ne traduit.
 */
export function unmetExposure(content: ExposureContent, lesson: Lesson, known: KnownLexicon): UnmetExposure[] {
  const index = formIndex(content);
  const knownForms = [...known.forms];
  const north = northernForms(content);
  const out: UnmetExposure[] = [];
  const seen = new Set<string>();
  for (const step of lesson.steps) {
    const exposure = stepExposure(content, step);
    const targetWords = exposure.target ? lexicalKey(exposure.target).split(" ") : [];
    for (const decoy of exposure.decoys) {
      for (const part of lexicalKey(decoy).split(" ")) {
        if (part === "" || known.forms.has(part) || seen.has(`d:${part}`)) continue;
        if (isProperNounOrNumber(decoy, part)) continue;
        if (targetWords.some((t) => t !== part && stripTones(t) === stripTones(part))) continue;
        seen.add(`d:${part}`);
        out.push({ kind: "decoy", what: part, candidates: exactCandidates(content, index, part).slice(0, MAX_CANDIDATES), step: step.type });
      }
    }
    for (const word of exposure.cited) {
      if (citedCovered(word, known, knownForms, north) || seen.has(`c:${word}`)) continue;
      seen.add(`c:${word}`);
      if (citedConcept(content, index, word, exposure.texts)) continue;
      out.push({ kind: "cited", what: word, candidates: [], step: step.type });
    }
  }
  return out;
}

/** Concepts cités par ces étapes, inconnus, que la fiche de préparation doit présenter. */
export function citedToPresent(content: ExposureContent, steps: readonly LessonStep[], known: KnownLexicon): ConceptId[] {
  const index = formIndex(content);
  const knownForms = [...known.forms];
  const north = northernForms(content);
  const out: ConceptId[] = [];
  for (const step of steps) {
    const exposure = stepExposure(content, step);
    for (const word of exposure.cited) {
      if (citedCovered(word, known, knownForms, north)) continue;
      const id = citedConcept(content, index, word, exposure.texts);
      if (id && !known.concepts.has(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
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
  /**
   * Mots que les conseils et les cartes culture du niveau citent sans que rien ne les ait appris
   * (contrat phase26 §4) : on les montre, traduits, avant de les lire dans une explication.
   */
  cited: ConceptId[];
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
    (briefing.cited.length > 0 ? 1 : 0) +
    briefing.guides.length +
    briefing.formats.length
  );
}

export function isBriefingEmpty(briefing: Briefing): boolean {
  return briefingParts(briefing) === 0;
}

/**
 * Fiches conseils à lire avant une leçon : les siennes d'abord (`Lesson.guides`, contrat phase26
 * §3), puis celles de son unité (`Unit.guides`, contrat phase16 §3).
 */
export function unitGuides(content: ContentIndex, lesson: Lesson): string[] {
  const unit = content.curriculum.units.find((u) => u.id === lesson.unit);
  return [...new Set([...(lesson.guides ?? []), ...(unit?.guides ?? [])])].filter((id) => content.guides.has(id));
}

export const EMPTY_BRIEFING: Briefing = { discover: [], recall: [], models: [], cited: [], guides: [], formats: [] };

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

  const cited = citedToPresent(content, steps, lexicon).filter((id) => !discover.includes(id) && !recall.includes(id));

  return {
    discover,
    recall,
    models,
    cited,
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
