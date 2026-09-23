import type { Concept, ContentIndex, LessonId, LessonStep, Localized, UnitId } from "./types.ts";

/**
 * Fiche mémoire d'un niveau (contrat phase23 §4) : ce qu'on emporte quand le niveau est fini.
 *
 * Un bilan de séance se referme et ne se relit pas. La fiche, elle, est faite pour sortir de
 * l'application — on la garde ouverte à côté de soi en commandant un café, on la relit dans le
 * métro. D'où trois règles qui ont guidé tout ce fichier :
 *
 *  - **rien d'inventé.** Chaque ligne vient du pack : la forme et le sens d'un concept, ses phrases
 *    d'exemple, les `explain` écrits à la main dans les étapes, les cartes culture, les dialogues.
 *    Aucune phrase n'est composée ici, aucune traduction n'est devinée (même discipline qu'au
 *    contrat phase20, et pour la même raison : personne ici ne parle le Sud) ;
 *  - **le niveau, et lui seul.** Un niveau en révise d'autres depuis le contrat phase21 §2 : ces
 *    mots-là sont déjà sur leur propre fiche. Les répéter la diluerait — la fiche doit tenir sur
 *    une page qu'on relit en trente secondes ;
 *  - **fonction pure.** Ni Dexie, ni React, ni fetch : l'unité du niveau est déjà chargée quand le
 *    bilan s'affiche, donc la fiche se construit sans attente et se teste sans navigateur.
 */

/** Ce qu'une entrée de fiche dit d'un mot : sa forme, son sens, et ce qui se trompe. */
export interface MemoEntry {
  id: string;
  vi: string;
  gloss: Localized;
  ipaSouth?: string;
  register?: Concept["register"];
  /** Remarque du contenu (« s'emploie entre amis », « toujours avec le classificateur »). */
  note?: Localized;
  /** Forme du Nord quand elle diffère : c'est là que l'oreille d'un francophone se perd. */
  northernEquivalent?: string;
  /** Phrases d'exemple du concept, telles qu'elles sont dans le pack. */
  examples: { vi: string; translation: Localized }[];
}

/** Une phrase entière rencontrée dans les exercices du niveau : le pense-bête « prêt à dire ». */
export interface MemoPhrase {
  vi: string;
  translation: Localized;
}

export interface MemoCulture {
  title: Localized;
  body: Localized;
  /** Expression vietnamienne portée par la carte, quand elle en porte une. */
  vi?: string;
}

export interface MemoDialogue {
  title: Localized;
  turns: { speaker: string; vi: string; translation: Localized }[];
}

/**
 * Fiche complète. Les sections vides restent vides : l'écran et le PDF sautent celles qui n'ont
 * rien à dire plutôt que d'afficher un titre suivi de blanc.
 */
export interface MemoSheet {
  lessonId: LessonId;
  unit: UnitId;
  unitTitle: Localized;
  title: Localized;
  goal: Localized;
  /** Mots et expressions introduits par le niveau. */
  words: MemoEntry[];
  /** Tournures et structures (`type: "structure"`). */
  structures: MemoEntry[];
  /** Tons et sons travaillés : ils ne se révisent pas comme du vocabulaire. */
  sounds: MemoEntry[];
  phrases: MemoPhrase[];
  /** Les `explain` du niveau, dans l'ordre où ils sont rencontrés, sans doublon. */
  tips: Localized[];
  culture: MemoCulture[];
  dialogues: MemoDialogue[];
  /** Mots dont la forme du Nord diffère : le piège nommé, pas seulement signalé. */
  pitfalls: { vi: string; north: string; gloss: Localized }[];
}

/** Une fiche sans rien à retenir n'a pas lieu d'être proposée. */
export function isMemoEmpty(sheet: MemoSheet): boolean {
  return (
    sheet.words.length === 0 &&
    sheet.structures.length === 0 &&
    sheet.sounds.length === 0 &&
    sheet.phrases.length === 0 &&
    sheet.tips.length === 0 &&
    sheet.culture.length === 0 &&
    sheet.dialogues.length === 0
  );
}

/** Au-delà, ce n'est plus un pense-bête : les exemples sont coupés au plus parlant. */
const MAX_EXAMPLES_PER_ENTRY = 2;

function toEntry(concept: Concept): MemoEntry {
  return {
    id: concept.id,
    vi: concept.vi,
    gloss: concept.gloss,
    ...(concept.ipaSouth ? { ipaSouth: concept.ipaSouth } : {}),
    ...(concept.register && concept.register !== "neutral" ? { register: concept.register } : {}),
    ...(concept.note ? { note: concept.note } : {}),
    // Le Nord n'est un piège que s'il s'écrit autrement : « cùng » contre « cùng » ne dit rien.
    ...(concept.northernEquivalent && concept.northernEquivalent !== concept.vi
      ? { northernEquivalent: concept.northernEquivalent }
      : {}),
    examples: (concept.examples ?? []).slice(0, MAX_EXAMPLES_PER_ENTRY).map((example) => ({
      vi: example.vi,
      translation: { fr: example.fr, ...(example.en ? { en: example.en } : {}) },
    })),
  };
}

/**
 * Phrases entières du niveau. Trois étapes en portent une **avec sa traduction** :
 * `build_sentence` (la phrase à assembler), `fill_gap` (le trou rebouché, depuis le contrat
 * phase21 §2 chaque `fill_gap` dérivé a sa traduction) et `speak_answer` (la réplique à dire).
 * Les autres formats n'ont qu'une forme isolée — elle est déjà dans la liste des mots.
 */
function phrasesOf(steps: readonly LessonStep[]): MemoPhrase[] {
  const phrases: MemoPhrase[] = [];
  const seen = new Set<string>();
  const push = (vi: string, translation: Localized | undefined) => {
    const text = vi.trim();
    if (!translation || text === "" || seen.has(text)) return;
    seen.add(text);
    phrases.push({ vi: text, translation });
  };
  for (const step of steps) {
    switch (step.type) {
      case "build_sentence":
        push(step.target, step.translation);
        break;
      case "fill_gap":
        // Le trou rebouché : c'est la phrase telle qu'elle se dit, pas le gabarit à trous.
        push(step.text.replace(/_{2,}|…|\.{3}/, step.answer), step.translation);
        break;
      case "speak_answer":
        push(step.prompt, step.translation);
        break;
      default:
        break;
    }
  }
  return phrases;
}

/** Clé de dédoublonnage d'une explication : deux `explain` identiques ne valent qu'une ligne. */
const tipKey = (tip: Localized) => JSON.stringify(tip);

/**
 * Fiche mémoire du niveau `lessonId`, ou `null` si le contenu n'est pas là (unité pas encore
 * chargée, lien profond vers une leçon inconnue). L'appelant décide quoi faire d'une fiche
 * absente ; il n'a jamais à attraper une exception pour une leçon qu'il a lui-même demandée.
 */
export function memoSheet(content: ContentIndex, lessonId: LessonId): MemoSheet | null {
  const lesson = content.lessons.get(lessonId);
  if (!lesson) return null;
  const unit = content.curriculum.units.find((u) => u.id === lesson.unit);
  // L'épreuve d'un thème n'introduit rien : sa fiche est celle **du thème entier** (contrat
  // phase26 §5) — le pense-bête qu'on garde une fois le thème bouclé.
  if (lesson.kind === "unit_test" && unit) return unitMemoSheet(content, unit.id, lessonId);

  const words: MemoEntry[] = [];
  const structures: MemoEntry[] = [];
  const sounds: MemoEntry[] = [];
  const pitfalls: MemoSheet["pitfalls"] = [];

  /**
   * Ce que le niveau **introduit**, pas ce qu'il interroge. Depuis le contrat phase21 §2 un niveau
   * pioche des mots déjà présentés de son unité pour atteindre 20 exercices : ils appartiennent à
   * la fiche de leur propre niveau. `srsIntroduce` est la liste juste — c'est elle qui décide de ce
   * qui entre en rappel espacé, donc de ce qui est neuf ici. Repli sur `concepts` pour les rares
   * niveaux qui n'introduisent rien en propre (les tests d'unité, les révisions).
   */
  const introduced = lesson.review.srsIntroduce.length > 0 ? lesson.review.srsIntroduce : lesson.concepts;
  for (const id of introduced) {
    const concept = content.concepts.get(id);
    if (!concept) continue;
    const entry = toEntry(concept);
    if (concept.type === "structure") structures.push(entry);
    else if (concept.type === "tone" || concept.type === "sound") sounds.push(entry);
    else words.push(entry);
    if (entry.northernEquivalent) pitfalls.push({ vi: entry.vi, north: entry.northernEquivalent, gloss: entry.gloss });
  }

  const tips: Localized[] = [];
  const seenTips = new Set<string>();
  const culture: MemoCulture[] = [];
  const dialogues: MemoDialogue[] = [];
  for (const step of lesson.steps) {
    const explain = "explain" in step ? step.explain : undefined;
    if (explain && !seenTips.has(tipKey(explain))) {
      seenTips.add(tipKey(explain));
      tips.push(explain);
    }
    if (step.type === "culture_card") {
      const card = content.culture.get(step.ref);
      if (card) culture.push({ title: card.title, body: card.body, ...(card.vi ? { vi: card.vi } : {}) });
    }
    if (step.type === "listen_gist") {
      const dialogue = content.dialogues.get(step.dialogue);
      if (dialogue) {
        dialogues.push({
          title: dialogue.title,
          turns: dialogue.turns.map((turn) => ({ speaker: turn.speaker, vi: turn.vi, translation: turn.translation })),
        });
      }
    }
  }

  return {
    lessonId,
    unit: lesson.unit,
    unitTitle: unit?.title ?? lesson.title,
    title: lesson.title,
    goal: lesson.goal,
    words,
    structures,
    sounds,
    phrases: phrasesOf(lesson.steps),
    tips,
    culture,
    dialogues,
    pitfalls,
  };
}

/**
 * Fiche d'un thème entier (contrat phase26 §5) : la réunion des fiches de ses niveaux, sans
 * doublon, dans l'ordre du cursus. Les révisions et l'épreuve n'y ajoutent rien — elles reprennent
 * ce que les niveaux ont présenté. `lessonId` est le niveau qui la porte (l'épreuve, en général).
 */
export function unitMemoSheet(content: ContentIndex, unitId: UnitId, lessonId: LessonId): MemoSheet | null {
  const unit = content.curriculum.units.find((u) => u.id === unitId);
  if (!unit) return null;
  const sheets = unit.lessons
    .filter((id) => {
      const lesson = content.lessons.get(id);
      return lesson !== undefined && (lesson.kind ?? "lesson") === "lesson";
    })
    .flatMap((id) => memoSheet(content, id) ?? []);
  const byKey = <T>(items: T[], key: (item: T) => string): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const k = key(item);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const holder = content.lessons.get(lessonId);
  return {
    lessonId,
    unit: unit.id,
    unitTitle: unit.title,
    title: unit.title,
    goal: holder?.goal ?? unit.title,
    words: byKey(sheets.flatMap((s) => s.words), (e) => e.id),
    structures: byKey(sheets.flatMap((s) => s.structures), (e) => e.id),
    sounds: byKey(sheets.flatMap((s) => s.sounds), (e) => e.id),
    phrases: byKey(sheets.flatMap((s) => s.phrases), (p) => p.vi),
    tips: byKey(sheets.flatMap((s) => s.tips), tipKey),
    culture: byKey(sheets.flatMap((s) => s.culture), (c) => JSON.stringify(c.title)),
    dialogues: byKey(sheets.flatMap((s) => s.dialogues), (d) => JSON.stringify(d.title)),
    pitfalls: byKey(sheets.flatMap((s) => s.pitfalls), (p) => p.vi),
  };
}

/**
 * Le pense-bête affiché au bilan (contrat phase26 §5) : ce qu'on relit en dix secondes avant de
 * fermer l'écran. La fiche complète reste à un geste (écran, PDF) ; ici, seulement l'essentiel :
 * les mots du niveau, les règles à ne pas oublier, les pièges.
 *
 * Les règles viennent des fiches conseils du niveau (leurs « pièges », écrits pour être retenus),
 * puis des explications du niveau. Rien n'est écrit ici : tout est tiré du pack.
 */
export interface MemoEssentials {
  words: MemoEntry[];
  /** Mots au-delà de ceux affichés : « et 12 autres dans la fiche ». */
  moreWords: number;
  rules: Localized[];
  pitfalls: MemoSheet["pitfalls"];
}

export const ESSENTIAL_WORDS = 8;
export const ESSENTIAL_RULES = 3;
export const ESSENTIAL_PITFALLS = 3;

export function memoEssentials(content: ContentIndex, sheet: MemoSheet): MemoEssentials {
  const all = [...sheet.words, ...sheet.structures, ...sheet.sounds];
  const lesson = content.lessons.get(sheet.lessonId);
  const unit = content.curriculum.units.find((u) => u.id === sheet.unit);
  // Les fiches du niveau d'abord ; pour l'épreuve, toutes celles du thème.
  const guideIds =
    lesson?.kind === "unit_test"
      ? [...(unit?.guides ?? []), ...(unit?.lessons ?? []).flatMap((id) => content.lessons.get(id)?.guides ?? [])]
      : [...(lesson?.guides ?? [])];
  const fromGuides = [...new Set(guideIds)].flatMap((id) => content.guides.get(id)?.pitfalls ?? []);
  const rules: Localized[] = [];
  const seen = new Set<string>();
  for (const rule of [...fromGuides, ...sheet.tips]) {
    if (rules.length >= ESSENTIAL_RULES) break;
    if (seen.has(tipKey(rule))) continue;
    seen.add(tipKey(rule));
    rules.push(rule);
  }
  return {
    words: all.slice(0, ESSENTIAL_WORDS),
    moreWords: Math.max(0, all.length - ESSENTIAL_WORDS),
    rules,
    pitfalls: sheet.pitfalls.slice(0, ESSENTIAL_PITFALLS),
  };
}
