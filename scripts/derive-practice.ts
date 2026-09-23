/**
 * Exercices dérivés du corpus (contrats phase20 §2 et phase21 §2).
 *
 * Deux manques, constatés en jouant le parcours, que ce script comble d'un même geste.
 *
 * **Ce qui est montré n'est pas demandé.** La leçon 1 présente les cinq tons de « ma » et n'en fait
 * reconnaître qu'un. Mesuré : 296 concepts, dans 124 leçons sur 194, sortaient de leur leçon sans
 * avoir été la réponse d'un seul exercice.
 *
 * **Le nombre d'exercices varie d'une leçon à l'autre**, de 6 à 14 une fois retirées les étapes sans
 * enregistrement. « 6 sur 8 » à un niveau et « 11 sur 14 » au suivant ne se comparent pas : aucune
 * note, aucune moyenne, aucun classement par thème n'a de sens sur un barème mouvant. Chaque niveau
 * compte donc **20 exercices notés** — une bonne réponse, un point.
 *
 * ## Rien de nouveau dans la langue enseignée
 *
 * Le script **n'écrit aucune phrase et n'invente aucune traduction**. Il assemble des exercices à
 * partir de ce qui est déjà dans le pack : les formes des concepts, et leurs phrases d'exemple —
 * elles-mêmes tirées du corpus par `derive-examples.ts` (contrat phase12 §1). Six formats, du plus
 * utile au plus coûteux :
 *
 *   1. `listen_pick_text` — le mot est la réponse, les leurres sont des mots **déjà appris**
 *      (contrat phase26 §4) : voisins tonals d'abord (ma / mà / mạ, seuls leurres permis sans être
 *      appris), jamais deux formes que l'oreille du Sud confondrait (hỏi et ngã y sonnent pareil,
 *      spec §7.1) ;
 *   2. `listen_pick_image` — quand le mot et ses voisins ont une image ;
 *   3. `fill_gap` — le mot retiré d'une de ses phrases d'exemple ;
 *   4. `build_sentence` — la même phrase à remettre dans l'ordre ;
 *   5. `translate_to_fr` — la phrase à comprendre ;
 *   6. `match_pairs` — des mots du niveau à relier à leur traduction, sans audio.
 *
 * Aucun `explain` écrit par une machine : la correction retombe sur la note du concept quand il en a
 * une. Il n'y a donc rien de nouveau à faire relire — ce qui mérite un œil, ce sont les leurres.
 *
 * ## Garde-fous
 *
 *   - un leurre n'est jamais identique à la réponse ni indiscernable d'elle à l'oreille ;
 *   - une phrase n'est reprise que si **chacun de ses mots a déjà été présenté** à ce point du
 *     cursus : chaque étape produite repasse par `unmetDemands` (contrat phase16 §1) avant d'être
 *     écrite, exactement le contrôle qui tourne en CI ;
 *   - jamais deux fois le même format sur le même mot, ni deux fois la même phrase ;
 *   - les étapes déjà écrites ne sont **jamais** touchées, et un niveau déjà complet n'est pas
 *     ouvert : le travail éditorial passe avant. Le script est idempotent.
 *
 * Usage : npx tsx scripts/derive-practice.ts [--pack vi-south] [--write] [--json]
 * Sans `--write`, il ne fait que rendre compte.
 */
import { writeFileSync } from "node:fs";
import {
  buildContentIndex,
  GAP,
  GRADED_STEPS_PER_LESSON,
  gradedSteps,
  lexiconBefore,
  lexiconOf,
  normalizeAnswer,
  seededRandom,
  syllables,
  unmetDemands,
  unpracticedConcepts,
  type Concept,
  type ConceptId,
  type ContentIndex,
  type KnownLexicon,
  type Lesson,
  type LessonStep,
  type Localized,
} from "@parlo/core";
import { type DistractorPools, type HeardClasses, pickDistractors, pickImageMates } from "./lib/distractors.ts";
import { listPacks, readPackFiles, rel, toRaw } from "./lib/load-pack.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const asJson = args.includes("--json");
const packArg = args.includes("--pack") ? args[args.indexOf("--pack") + 1] : undefined;

/** Options d'un choix (réponse comprise) : 4 pour un mot, 3 pour une phrase à lire. */
const MAX_OPTIONS_WORD = 4;
const MAX_OPTIONS_PHRASE = 3;
/** En dessous, l'exercice est un pile ou face : on préfère l'appariement. */
const MIN_DISTRACTORS = 2;
/** Bornes d'un `match_pairs` (schéma). */
const MATCH_MIN = 3;
const MATCH_MAX = 6;
/** Bornes d'une phrase à reconstruire (`packages/core/src/review.ts`). */
const BUILD_MIN_TOKENS = 3;
const BUILD_MAX_TOKENS = 8;
/** Secondes par exercice noté, et temps fixe d'ouverture : d'où sort `estimatedMinutes`. */
const SECONDS_PER_STEP = 15;
const LESSON_OVERHEAD_SECONDS = 60;

const tokensOf = (text: string) => text.replace(/[.,!?;:…]/g, " ").split(/\s+/).filter(Boolean);

function conceptsOf(content: ContentIndex, ids: Iterable<ConceptId>): Concept[] {
  return [...ids].flatMap((id) => content.concepts.get(id) ?? []);
}

const localized = (fr: string, en?: string): Localized => ({ fr, ...(en ? { en } : {}) });

/**
 * Phrase d'exemple du concept qui le contient comme suite de mots entière. `derive-examples.ts` les
 * a déjà choisies dans le corpus ; on ne fait ici que les relire.
 */
function exampleOf(target: Concept): { vi: string; fr: string; en?: string } | null {
  for (const example of target.examples ?? []) {
    const words = tokensOf(example.vi).map((w) => w.toLocaleLowerCase("vi"));
    const form = tokensOf(target.vi).map((w) => w.toLocaleLowerCase("vi"));
    for (let i = 0; i + form.length <= words.length; i++) {
      if (form.every((w, j) => words[i + j] === w)) return example;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Construction des étapes, format par format. Chacune renvoie `null` quand les données manquent.

interface Forge {
  content: ContentIndex;
  lesson: Lesson;
  /**
   * Leurres possibles : les mots déjà appris, et le pack entier pour les seules variantes tonales
   * de la réponse (contrat phase26 §4).
   */
  pools: DistractorPools;
  classes: HeardClasses;
  /** Lexique présenté à ce point du cursus : ce qu'une phrase a le droit d'exiger. */
  known: KnownLexicon;
  /** Aléa déterministe propre à un mot du niveau : même contenu, mêmes leurres, à chaque génération. */
  rand: (target: Concept) => () => number;
}

function pickText(f: Forge, target: Concept): LessonStep | null {
  const max = (syllables(target.vi).length > 1 ? MAX_OPTIONS_PHRASE : MAX_OPTIONS_WORD) - 1;
  const distractors = pickDistractors(target, f.pools, max, f.classes, f.rand(target));
  if (distractors.length < MIN_DISTRACTORS) return null;
  return { type: "listen_pick_text", concept: target.id, distractors };
}

function pickImage(f: Forge, target: Concept): LessonStep | null {
  if (!target.image) return null;
  const mates = pickImageMates(target, f.pools.known, MAX_OPTIONS_WORD - 1, f.rand(target));
  if (mates.length < MIN_DISTRACTORS) return null;
  return { type: "listen_pick_image", concept: target.id, distractors: mates.map((c) => c.id) };
}

function fillGap(f: Forge, target: Concept): LessonStep | null {
  const example = exampleOf(target);
  if (!example) return null;
  const at = example.vi.toLocaleLowerCase("vi").indexOf(target.vi.toLocaleLowerCase("vi"));
  if (at < 0) return null;
  const distractors = pickDistractors(target, f.pools, MAX_OPTIONS_WORD - 1, f.classes, f.rand(target));
  if (distractors.length < MIN_DISTRACTORS) return null;
  return {
    type: "fill_gap",
    text: example.vi.slice(0, at) + GAP + example.vi.slice(at + target.vi.length),
    answer: target.vi,
    options: [target.vi, ...distractors],
    translation: localized(example.fr, example.en),
  };
}

function buildSentence(f: Forge, target: Concept): LessonStep | null {
  const example = exampleOf(target);
  if (!example) return null;
  const tokens = tokensOf(example.vi);
  if (tokens.length < BUILD_MIN_TOKENS || tokens.length > BUILD_MAX_TOKENS) return null;
  return {
    type: "build_sentence",
    target: tokens.join(" "),
    tokens,
    translation: localized(example.fr, example.en),
    audioConcept: target.id,
  };
}

function translateToFr(f: Forge, target: Concept): LessonStep | null {
  const example = exampleOf(target);
  if (!example) return null;
  return {
    type: "translate_to_fr",
    source: example.vi,
    accepted: { fr: [example.fr], ...(example.en ? { en: [example.en] } : {}) },
  };
}

/**
 * Groupes d'appariement : 3 à 6 concepts du niveau, formes et traductions toutes distinctes (deux
 * cartes identiques d'un côté rendraient l'appariement arbitraire, `checkStep`).
 */
function matchGroups(wanted: readonly Concept[], filler: readonly Concept[], limit = Infinity): Concept[][] {
  const groups: Concept[][] = [];
  const used = new Set<ConceptId>();
  let pool = [...wanted];

  while (pool.length > 0 && groups.length < limit) {
    const group: Concept[] = [];
    const forms = new Set<string>();
    const glosses = new Set<string>();
    const fits = (c: Concept) => !used.has(c.id) && !forms.has(normalizeAnswer(c.vi)) && !glosses.has(c.gloss.fr);
    const take = (c: Concept) => {
      group.push(c);
      forms.add(normalizeAnswer(c.vi));
      glosses.add(c.gloss.fr);
    };

    // Les mots visés d'abord ; ceux qui entrent en collision attendent le groupe suivant.
    const rest: Concept[] = [];
    for (const c of pool) {
      if (group.length < MATCH_MAX && fits(c)) take(c);
      else rest.push(c);
    }
    for (const c of filler) {
      if (group.length >= MATCH_MAX) break;
      if (fits(c)) take(c);
    }

    // Groupe trop court : rien n'est consommé, ces mots repartent vers les autres formats.
    if (group.length < MATCH_MIN) break;
    groups.push(group);
    for (const c of group) used.add(c.id);
    if (rest.length === pool.length) break;
    pool = rest;
  }
  return groups;
}

// ---------------------------------------------------------------------------

/**
 * Clé d'unicité : un même format sur un même mot ne se pose pas deux fois dans un niveau.
 * (Le format et la cible, pas la phrase — celle-ci a son propre quota, voir `sentenceOf`.)
 */
function stepKey(step: LessonStep): string | null {
  switch (step.type) {
    case "listen_pick_text":
    case "listen_pick_image":
    case "listen_transcribe":
    case "tone_identify":
    case "tone_produce":
    case "speak_repeat":
      return `${step.type}:${step.concept}`;
    case "fill_gap":
      return `fill_gap:${normalizeAnswer(step.answer)}@${normalizeAnswer(step.text)}`;
    case "build_sentence":
      return `build_sentence:${normalizeAnswer(step.target)}`;
    case "translate_to_fr":
      return `translate_to_fr:${normalizeAnswer(step.source)}`;
    case "translate_to_vi":
      return `translate_to_vi:${normalizeAnswer(step.accepted[0] ?? "")}`;
    case "match_pairs":
      return `match_pairs:${[...step.concepts].sort().join(",")}`;
    default:
      return null;
  }
}

/**
 * La phrase qu'une étape fait manipuler, trou rebouché. Une même phrase peut servir deux fois dans
 * un niveau — la remplir puis la remettre dans l'ordre travaille deux choses différentes — mais pas
 * trois : à la troisième, on récite.
 */
const SENTENCE_REUSE_MAX = 2;

function sentenceOf(step: LessonStep): string | null {
  switch (step.type) {
    case "fill_gap":
      return normalizeAnswer(step.text.replace(GAP, step.answer));
    case "build_sentence":
      return normalizeAnswer(step.target);
    case "translate_to_fr":
      return normalizeAnswer(step.source);
    case "translate_to_vi":
      return normalizeAnswer(step.accepted[0] ?? "");
    default:
      return null;
  }
}

/**
 * Une étape ne part que si elle n'exige aucun mot que le cursus n'a pas encore présenté.
 *
 * `unmetDemands` est la règle de la CI (contrat phase16 §1), et pour un `fill_gap` elle ne regarde
 * que la **réponse** : le reste de la phrase n'est pas produit, seulement lu. Correct pour une
 * leçon écrite à la main, insuffisant ici. Le générateur pioche les phrases d'exemple du corpus, et
 * la leçon 1 s'est retrouvée à faire compléter « Chung cư này gần chợ, ___ hơi ồn » pour placer
 * « mà » : la bonne réponse, une phrase dont pas un mot n'avait été montré. On exige donc la
 * phrase **entière**, trou rebouché, comme si elle était à traduire.
 */
function admissible(f: Forge, step: LessonStep): boolean {
  const steps: LessonStep[] = [step];
  if (step.type === "fill_gap") {
    steps.push({ type: "translate_to_fr", source: step.text.replace(GAP, step.answer), accepted: { fr: [""] } });
  }
  return unmetDemands(f.content, { ...f.lesson, steps }, f.known).length === 0;
}

type Builder = (f: Forge, target: Concept) => LessonStep | null;

/**
 * Ordre des passes. Chaque passe traverse **tous** les mots du niveau avant que la suivante ne
 * commence : on préfère un deuxième format sur un mot déjà vu à un troisième sur le premier mot.
 * La reconnaissance d'abord, la production ensuite (spec §3.2 : l'oreille avant l'œil).
 */
const PASSES: Builder[] = [pickText, pickImage, fillGap, buildSentence, translateToFr];

/**
 * Mot déjà présenté qu'un niveau peut reprendre pour atteindre son barème. **Du même thème (unité)
 * uniquement**, et ce n'est pas qu'une question pédagogique : une unité se télécharge seule pour
 * jouer hors ligne (spec §3.7), et un niveau qui interroge un mot d'une autre unité exige que
 * celle-ci soit là aussi. Piocher dans tout le cursus amont aurait rendu chaque unité dépendante
 * de toutes les précédentes — « télécharge l'unité 12 pour l'avion » aurait voulu dire télécharger
 * le pack entier.
 */
export interface Revision {
  concept: Concept;
  sameUnit: boolean;
}

function practiceSteps(content: ContentIndex, lesson: Lesson, revision: readonly Revision[]): { steps: LessonStep[]; covered: ConceptId[] } {
  const before = lexiconBefore(content, lesson.id);
  const own = lexiconOf(content, lesson.review.srsIntroduce);
  const f: Forge = {
    content,
    lesson,
    classes: content.pack.toneSystem?.heardClasses,
    // Leurres : seulement des mots déjà appris (contrat phase26 §4). Un leurre inconnu n'est pas
    // un piège, c'est une devinette : on choisit la réponse par élimination, sans rien reconnaître.
    pools: {
      known: [...content.concepts.values()]
        .filter((c) => before.concepts.has(c.id) || own.concepts.has(c.id))
        .sort((a, b) => a.id.localeCompare(b.id)),
      all: [...content.concepts.values()].sort((a, b) => a.id.localeCompare(b.id)),
    },
    known: {
      concepts: new Set([...before.concepts, ...own.concepts]),
      forms: new Set([...before.forms, ...own.forms]),
    },
    rand: (target) => seededRandom(`${lesson.id}:${target.id}`),
  };

  const taken = new Set(lesson.steps.flatMap((s) => stepKey(s) ?? []));
  const sentences = new Map<string, number>();
  for (const s of lesson.steps) {
    const key = sentenceOf(s);
    if (key) sentences.set(key, (sentences.get(key) ?? 0) + 1);
  }
  const added: LessonStep[] = [];
  const covered = new Set<ConceptId>();
  let budget = GRADED_STEPS_PER_LESSON - gradedSteps(content, lesson).length;

  const emit = (step: LessonStep, targets: readonly ConceptId[]): boolean => {
    const key = stepKey(step);
    if (key !== null && taken.has(key)) return false;
    const sentence = sentenceOf(step);
    if (sentence !== null && (sentences.get(sentence) ?? 0) >= SENTENCE_REUSE_MAX) return false;
    if (!admissible(f, step)) return false;
    if (key !== null) taken.add(key);
    if (sentence !== null) sentences.set(sentence, (sentences.get(sentence) ?? 0) + 1);
    added.push(step);
    for (const id of targets) covered.add(id);
    budget--;
    return true;
  };

  // 1. Couverture (contrat phase20 §1) : d'abord les mots que rien ne fait pratiquer, même si le
  //    niveau a déjà ses 20 exercices — une note complète sur un mot jamais demandé reste un trou.
  const missing = conceptsOf(content, unpracticedConcepts(content, lesson).filter((id) => content.concepts.has(id)));
  const stillMissing: Concept[] = [];
  for (const target of missing) {
    const step = PASSES.map((build) => build(f, target)).find((s) => s !== null && emit(s, [target.id]));
    if (!step) stillMissing.push(target);
  }
  if (stillMissing.length > 0) {
    const groupable = stillMissing.filter((c) => f.known.concepts.has(c.id));
    const filler = conceptsOf(content, lesson.concepts).filter((c) => f.known.concepts.has(c.id) && !stillMissing.includes(c));
    for (const group of matchGroups(groupable, filler)) emit({ type: "match_pairs", concepts: group.map((c) => c.id) }, group.map((c) => c.id));
  }

  // 2. Complément jusqu'au barème, passe par passe : chaque format traverse tous les mots du
  //    niveau avant que le suivant ne commence.
  const words = conceptsOf(content, lesson.concepts);
  for (const build of PASSES) {
    for (const target of words) {
      if (budget <= 0) break;
      const step = build(f, target);
      if (step) emit(step, [target.id]);
    }
    if (budget <= 0) break;
  }

  // 3. Le niveau n'a pas de quoi faire 20 questions avec ses seuls mots (cinq tons de « ma », pas
  //    une phrase d'exemple) : on reprend des mots **déjà présentés du même thème**. Ce
  //    n'est pas un pis-aller — un niveau qui ne réinterroge que ses nouveautés mesure la mémoire
  //    de cinq minutes, et la moyenne par thème n'aurait rien à mesurer. Ces mots rejoignent
  //    `concepts` (sans toucher à `srsIntroduce` : ils ne sont pas introduits ici), ce qui les
  //    écarte du rappel espacé du jour — ils sont déjà travaillés là.
  const revisited: ConceptId[] = [];
  if (budget > 0) {
    for (const build of PASSES) {
      for (const { concept } of revision) {
        if (budget <= 0) break;
        const step = build(f, concept);
        if (step && emit(step, [concept.id])) revisited.push(concept.id);
      }
      if (budget <= 0) break;
    }
  }
  for (const id of revisited) if (!lesson.concepts.includes(id)) lesson.concepts.push(id);

  // 4. En dernier recours, des appariements : ils prennent six mots d'un coup et n'exigent ni
  //    image, ni phrase d'exemple — c'est ce qui reste quand le corpus ne donne rien d'autre.
  if (budget > 0) {
    const groupable = conceptsOf(content, lesson.concepts).filter((c) => f.known.concepts.has(c.id));
    for (const group of matchGroups(groupable, [], budget)) {
      if (budget <= 0) break;
      emit({ type: "match_pairs", concepts: group.map((c) => c.id) }, group.map((c) => c.id));
    }
  }

  return { steps: added, covered: [...covered] };
}

/**
 * Où insérer : après tout ce que la leçon présente, mais **avant le mini-jeu final** quand il y en
 * a un — le jeu ferme la leçon (spec §4.3, bloc 4), il ne se joue pas au milieu.
 */
function insertAt(lesson: Lesson): number {
  const last = lesson.steps.length - 1;
  return lesson.steps[last]?.type === "game" ? last : lesson.steps.length;
}

/**
 * Durée annoncée, recalculée sur ce qui se joue vraiment : 15 s par exercice noté, plus une minute
 * d'ouverture (fiche de préparation, carte culture, mini-jeu). Elle sert à composer la séance
 * (`planSession`) — l'annoncer trop basse ferait déborder la séance, trop haute ferait écarter le
 * niveau du jour.
 */
function minutesFor(content: ContentIndex, lesson: Lesson): number {
  const seconds = gradedSteps(content, lesson).length * SECONDS_PER_STEP + LESSON_OVERHEAD_SECONDS;
  return Math.max(2, Math.min(15, Math.ceil(seconds / 60)));
}

// ---------------------------------------------------------------------------

interface Added {
  lesson: Lesson;
  path: string;
  steps: LessonStep[];
  covered: ConceptId[];
  graded: number;
}

const packs = packArg ? [packArg] : listPacks();
const added: Added[] = [];
const short: { id: string; graded: number }[] = [];
let lessonsSeen = 0;
let touched = 0;

for (const code of packs) {
  const files = readPackFiles(code);
  const content = buildContentIndex(toRaw(files));
  const pathOf = new Map(files.lessons.map((f) => [(f.data as Lesson).id, f.path]));

  /** Mots présentés jusqu'ici, du plus récent au plus ancien, avec l'unité qui les a introduits. */
  const introduced: { id: ConceptId; unit: string }[] = [];

  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      const lesson = content.lessons.get(lessonId);
      const path = pathOf.get(lessonId);
      if (!lesson || !path) continue;
      lessonsSeen++;

      // Réserve de révision : les mots du thème déjà appris, du plus récent au plus ancien.
      const revision: Revision[] = introduced
        .filter(({ id }) => !lesson.concepts.includes(id))
        .map(({ id, unit: from }) => ({ concept: content.concepts.get(id), sameUnit: from === unit.id }))
        .flatMap((r) => (r.concept ? [{ concept: r.concept, sameUnit: r.sameUnit }] : []))
        .filter((r) => r.sameUnit);

      const { steps, covered } = practiceSteps(content, lesson, revision);
      for (const id of lesson.review.srsIntroduce) introduced.unshift({ id, unit: unit.id });
      if (steps.length > 0) lesson.steps.splice(insertAt(lesson), 0, ...steps);
      const graded = gradedSteps(content, lesson).length;
      const minutes = minutesFor(content, lesson);
      const changed = steps.length > 0 || minutes !== lesson.estimatedMinutes;
      lesson.estimatedMinutes = minutes;
      if (graded < GRADED_STEPS_PER_LESSON) short.push({ id: lesson.id, graded });
      if (!changed) continue;
      touched++;
      added.push({ lesson, path, steps, covered, graded });
    }
  }
}

if (write) for (const { lesson, path } of added) writeFileSync(path, `${JSON.stringify(lesson, null, 2)}\n`, "utf8");

const byType = (type: string) => added.flatMap((a) => a.steps).filter((s) => s.type === type).length;
const report = {
  packs,
  écrit: write,
  leçons: lessonsSeen,
  leçonsModifiées: touched,
  conceptsRepris: added.reduce((n, a) => n + a.covered.length, 0),
  étapesAjoutées: added.reduce((n, a) => n + a.steps.length, 0),
  parFormat: Object.fromEntries(
    ["listen_pick_text", "listen_pick_image", "fill_gap", "translate_to_fr", "build_sentence", "match_pairs"].map((t) => [t, byType(t)]),
  ),
  niveauxSousLeBarème: short,
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`derive-practice (${packs.join(", ")})${write ? "" : " — aperçu, rien n'est écrit"}`);
  console.log(`  niveaux lus : ${report.leçons} — modifiés : ${report.leçonsModifiées}`);
  console.log(`  étapes ajoutées : ${report.étapesAjoutées}`);
  for (const [type, n] of Object.entries(report.parFormat)) console.log(`    ${type} : ${n}`);
  if (short.length > 0) {
    console.log(`  n'atteignent pas ${GRADED_STEPS_PER_LESSON} exercices notés : ${short.length}`);
    for (const s of short.slice(0, 20)) console.log(`    ${s.id} : ${s.graded}`);
  }
  if (!write) console.log("  relancer avec --write pour appliquer");
}
