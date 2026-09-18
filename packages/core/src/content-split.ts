import type { RawPackFiles } from "./content-index.ts";
import type { ExamFile } from "./exams.ts";
import type { XeOmData } from "./games/xe-om.ts";
import type { PlacementSpec } from "./placement.ts";
import type {
  Concept,
  ConceptId,
  ContentIndex,
  CultureCard,
  Curriculum,
  Dialogue,
  Guide,
  Lesson,
  LessonId,
  LexicalVariants,
  Pack,
  UnitId,
  UnitManifestEntry,
} from "./types.ts";

/**
 * Livraison du contenu en deux temps (audit mobile P1 #6, spec §8.1) :
 *   - `core.json` : tout ce qu'il faut pour afficher le hub et planifier (pack, cursus, index des leçons,
 *     index compact des concepts, examens, placement, jeux, variantes, médias, tailles des unités) ;
 *   - `units/<unitId>.json` : leçons complètes, concepts introduits dans l'unité, cartes culture.
 * Une seule source de vérité : le découpage est calculé ici à partir des fichiers du pack
 * (plugin Vite, client pour un ancien bundle) et reproduit à l'identique par l'API
 * (apps/api/app/services/content_split.py, fixture de parité).
 */

export const SPLIT_FORMAT = 2;

/** Leçon sans ses étapes. `srsIntroduce` absent = identique à `concepts`. */
export interface LessonSummary {
  id: LessonId;
  unit: UnitId;
  kind?: NonNullable<Lesson["kind"]>;
  title: Lesson["title"];
  estimatedMinutes: number;
  prerequisites: LessonId[];
  concepts: ConceptId[];
  srsIntroduce?: ConceptId[];
}

/** Concept compact : assez pour les distracteurs de révision, l'audio et les images. */
export interface ConceptSummary {
  id: ConceptId;
  type: Concept["type"];
  vi: string;
  tone?: NonNullable<Concept["tone"]>;
  gloss: Concept["gloss"];
  /** Catégorie grammaticale : l'index par catégorie doit pouvoir compter tout le pack hors ligne. */
  pos?: NonNullable<Concept["pos"]>;
  audio: Concept["audio"];
  image?: string;
  pitch?: string;
  /** Unité dont le fichier porte le concept complet. */
  unit?: UnitId;
}

export interface CoreFile {
  format: typeof SPLIT_FORMAT;
  pack: Pack;
  curriculum: Curriculum;
  lessonIndex: LessonSummary[];
  conceptIndex: ConceptSummary[];
  /**
   * Dialogues du pack (courts, cités par `listen_gist`) : dans le core, pas par unité —
   * absent tant qu'aucun pack n'en a, pour ne pas changer le core.json existant.
   */
  dialogues?: Dialogue[];
  /**
   * Fiches conseils : dans le core, comme les dialogues. Ce sont quelques kilo-octets de texte
   * qu'on veut lisibles hors ligne dès l'installation — on ne consulte pas un conseil au moment où
   * l'unité qui le porterait vient d'être téléchargée, mais au moment où on en a besoin.
   */
  guides?: Guide[];
  variants?: LexicalVariants;
  mediaIndex: string[];
  exams: ExamFile[];
  placement: PlacementSpec | null;
  games: { xe_om?: XeOmData };
  units: UnitManifestEntry[];
}

export interface UnitFile {
  format: typeof SPLIT_FORMAT;
  pack: string;
  version: number;
  unit: UnitId;
  lessons: Lesson[];
  concepts: Concept[];
  culture: CultureCard[];
  /** Médias présents utilisés par l'unité (chemins relatifs au pack). */
  media: string[];
}

export function isCoreFile(value: unknown): value is CoreFile {
  return typeof value === "object" && value !== null && (value as { format?: unknown }).format === SPLIT_FORMAT && Array.isArray((value as CoreFile).lessonIndex);
}

export function isUnitFile(value: unknown): value is UnitFile {
  return typeof value === "object" && value !== null && (value as { format?: unknown }).format === SPLIT_FORMAT && typeof (value as UnitFile).unit === "string";
}

/** Octets UTF-8 d'un texte (taille réelle du fichier servi). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Leçons dans l'ordre du cursus, puis celles qui n'y figurent pas (ordre des fichiers). */
function lessonOrder(raw: Pick<RawPackFiles, "curriculum" | "lessons">): Lesson[] {
  const byId = new Map(raw.lessons.map((l) => [l.id, l]));
  const seen = new Set<LessonId>();
  const out: Lesson[] = [];
  for (const unit of raw.curriculum.units) {
    for (const id of unit.lessons) {
      const lesson = byId.get(id);
      if (lesson && !seen.has(id)) {
        seen.add(id);
        out.push(lesson);
      }
    }
  }
  for (const lesson of raw.lessons) if (!seen.has(lesson.id)) out.push(lesson);
  return out;
}

/** Ids de concepts cités par une leçon (concepts, révision, étapes), dans l'ordre. */
export function lessonConceptRefs(lesson: Lesson): ConceptId[] {
  const ids: ConceptId[] = [...lesson.concepts, ...lesson.review.srsIntroduce];
  for (const step of lesson.steps) {
    switch (step.type) {
      case "listen_pick_image":
        ids.push(step.concept, ...step.distractors);
        break;
      case "listen_pick_text":
      case "listen_transcribe":
      case "tone_identify":
      case "tone_produce":
      case "speak_repeat":
        ids.push(step.concept);
        break;
      case "speak_answer":
        ids.push(...step.accepted);
        break;
      case "speak_roleplay":
        ids.push(...step.prompts.map((p) => p.concept));
        break;
      case "tone_minimal_pair":
        ids.push(...(step.audioConcepts ?? []));
        break;
      case "match_pairs":
        ids.push(...step.concepts);
        break;
      case "build_sentence":
        if (step.audioConcept) ids.push(step.audioConcept);
        break;
      case "game":
        if (Array.isArray(step.conceptPool)) ids.push(...step.conceptPool);
        break;
      default:
        break;
    }
  }
  return ids;
}

function conceptMedia(concept: Concept): string[] {
  return [
    ...concept.audio.map((a) => a.src),
    ...(concept.pitch ? [concept.pitch] : []),
    ...(concept.image ? [concept.image] : []),
    ...(concept.examples ?? []).flatMap((e) => (e.audio ? [e.audio] : [])),
  ];
}

export interface SplitOptions {
  /** Taille d'un média (octets) ; défaut 0 (inconnue). */
  mediaSize?: (path: string) => number;
}

/** Découpe les fichiers d'un pack en core + unités. `raw` porte examens, placement, jeux et index des médias. */
export function splitPack(raw: RawPackFiles, options: SplitOptions = {}): { core: CoreFile; units: UnitFile[] } {
  const mediaIndex = [...(raw.mediaIndex ?? [])];
  const present = new Set(mediaIndex);
  const conceptById = new Map(raw.concepts.map((c) => [c.id, c]));
  const cultureById = new Map(raw.culture.map((c) => [c.id, c]));
  const dialogueById = new Map((raw.dialogues ?? []).map((d) => [d.id, d]));
  const ordered = lessonOrder(raw);

  const unitIds: UnitId[] = [];
  for (const lesson of ordered) if (!unitIds.includes(lesson.unit)) unitIds.push(lesson.unit);

  // Concept complet : dans l'unité qui le cite en premier (l'index compact sert ailleurs).
  // Carte culture : dans chaque unité qui la cite (une leçon se joue avec sa seule unité).
  const conceptUnit = new Map<ConceptId, UnitId>();
  const cultureUnits = new Map<string, Set<UnitId>>();
  for (const lesson of ordered) {
    for (const id of lessonConceptRefs(lesson)) if (conceptById.has(id) && !conceptUnit.has(id)) conceptUnit.set(id, lesson.unit);
    for (const step of lesson.steps) {
      if (step.type !== "culture_card" || !cultureById.has(step.ref)) continue;
      const set = cultureUnits.get(step.ref) ?? new Set<UnitId>();
      set.add(lesson.unit);
      cultureUnits.set(step.ref, set);
    }
  }
  // Concepts et cartes qu'aucune leçon ne cite : portés par la dernière unité (jamais perdus).
  const lastUnit = unitIds.at(-1);
  if (lastUnit !== undefined) {
    for (const c of raw.concepts) if (!conceptUnit.has(c.id)) conceptUnit.set(c.id, lastUnit);
    for (const c of raw.culture) if (!cultureUnits.has(c.id)) cultureUnits.set(c.id, new Set([lastUnit]));
  }

  const size = options.mediaSize ?? (() => 0);
  const units: UnitFile[] = unitIds.map((unit) => {
    const lessons = ordered.filter((l) => l.unit === unit);
    const media = new Set<string>();
    for (const lesson of lessons) {
      for (const id of lessonConceptRefs(lesson)) {
        const concept = conceptById.get(id);
        if (concept) for (const path of conceptMedia(concept)) media.add(path);
      }
      for (const step of lesson.steps) {
        if (step.type === "speak_repeat" && step.pitchRef) media.add(step.pitchRef);
        if (step.type === "speak_answer" && step.audio) media.add(step.audio);
        if (step.type === "dialogue_choice") for (const t of step.turns) if (t.audio) media.add(t.audio);
        if (step.type === "culture_card") {
          const audio = cultureById.get(step.ref)?.audio;
          if (audio) media.add(audio);
        }
        if (step.type === "listen_gist") {
          // Le dialogue vit dans le core, mais son audio se télécharge avec l'unité qui le joue.
          for (const t of dialogueById.get(step.dialogue)?.turns ?? []) if (t.audio) media.add(t.audio);
        }
      }
    }
    return {
      format: SPLIT_FORMAT,
      pack: raw.pack.code,
      version: raw.pack.version,
      unit,
      lessons,
      concepts: raw.concepts.filter((c) => conceptUnit.get(c.id) === unit),
      culture: raw.culture.filter((c) => cultureUnits.get(c.id)?.has(unit) === true),
      media: [...media].filter((p) => present.has(p)).sort(),
    };
  });

  const core: CoreFile = {
    format: SPLIT_FORMAT,
    pack: raw.pack,
    curriculum: raw.curriculum,
    lessonIndex: raw.lessons.map(summarizeLesson),
    conceptIndex: raw.concepts.map((c) => summarizeConcept(c, conceptUnit.get(c.id))),
    ...(raw.dialogues && raw.dialogues.length > 0 ? { dialogues: [...raw.dialogues] } : {}),
    ...(raw.guides && raw.guides.length > 0 ? { guides: [...raw.guides] } : {}),
    ...(raw.variants ? { variants: raw.variants } : {}),
    mediaIndex,
    exams: [...(raw.exams ?? [])],
    placement: raw.placement ?? null,
    games: raw.games ?? {},
    units: units.map((u) => ({
      id: u.unit,
      bytes: utf8Bytes(JSON.stringify(u)),
      mediaBytes: u.media.reduce((sum, p) => sum + size(p), 0),
      mediaCount: u.media.length,
    })),
  };
  return { core, units };
}

function summarizeLesson(lesson: Lesson): LessonSummary {
  const same = lesson.review.srsIntroduce.length === lesson.concepts.length && lesson.review.srsIntroduce.every((id, i) => lesson.concepts[i] === id);
  return {
    id: lesson.id,
    unit: lesson.unit,
    ...(lesson.kind ? { kind: lesson.kind } : {}),
    title: lesson.title,
    estimatedMinutes: lesson.estimatedMinutes,
    prerequisites: lesson.prerequisites,
    concepts: lesson.concepts,
    ...(same ? {} : { srsIntroduce: lesson.review.srsIntroduce }),
  };
}

function summarizeConcept(c: Concept, unit: UnitId | undefined): ConceptSummary {
  return {
    id: c.id,
    type: c.type,
    vi: c.vi,
    ...(c.tone ? { tone: c.tone } : {}),
    gloss: c.gloss,
    ...(c.pos ? { pos: c.pos } : {}),
    audio: c.audio,
    ...(c.image ? { image: c.image } : {}),
    ...(c.pitch ? { pitch: c.pitch } : {}),
    ...(unit ? { unit } : {}),
  };
}

/** Leçon de l'index (étapes absentes tant que l'unité n'est pas chargée). */
function stubLesson(s: LessonSummary): Lesson {
  return {
    id: s.id,
    unit: s.unit,
    ...(s.kind ? { kind: s.kind } : {}),
    title: s.title,
    goal: { fr: "" },
    estimatedMinutes: s.estimatedMinutes,
    prerequisites: s.prerequisites,
    concepts: s.concepts,
    steps: [],
    review: { srsIntroduce: s.srsIntroduce ?? s.concepts },
    reviewed: false,
  };
}

function stubConcept(s: ConceptSummary): Concept {
  const { unit: _unit, ...rest } = s;
  return { ...rest, reviewed: false };
}

/** Index de contenu à partir du core : unités fournies fusionnées, les autres en résumé. */
export function buildSplitContentIndex(core: CoreFile, units: readonly UnitFile[] = []): ContentIndex {
  const index: ContentIndex = {
    pack: core.pack,
    curriculum: core.curriculum,
    lessons: new Map(core.lessonIndex.map((l) => [l.id, stubLesson(l)])),
    concepts: new Map(core.conceptIndex.map((c) => [c.id, stubConcept(c)])),
    culture: new Map(),
    dialogues: new Map((core.dialogues ?? []).map((d) => [d.id, d])),
    guides: new Map((core.guides ?? []).map((g) => [g.id, g])),
    ...(core.variants ? { variants: core.variants } : {}),
    mediaIndex: new Set(core.mediaIndex),
    split: {
      version: core.pack.version,
      loaded: new Set(),
      units: new Map(core.units.map((u) => [u.id, u])),
      conceptUnits: new Map(core.conceptIndex.flatMap((c) => (c.unit ? [[c.id, c.unit] as const] : []))),
    },
  };
  for (const unit of units) addUnitToIndex(index, unit);
  return index;
}

/**
 * Fusionne une unité dans l'index (en place : les écrans qui tiennent déjà l'index voient les leçons
 * complètes). Une unité d'une autre version est ignorée.
 */
export function addUnitToIndex(index: ContentIndex, unit: UnitFile): boolean {
  const split = index.split;
  if (!split || unit.version !== split.version || unit.pack !== index.pack.code) return false;
  const lessons = index.lessons as Map<LessonId, Lesson>;
  const concepts = index.concepts as Map<ConceptId, Concept>;
  const culture = index.culture as Map<string, CultureCard>;
  for (const l of unit.lessons) lessons.set(l.id, l);
  for (const c of unit.concepts) concepts.set(c.id, c);
  for (const c of unit.culture) culture.set(c.id, c);
  split.loaded.add(unit.unit);
  return true;
}

export function isUnitLoaded(index: ContentIndex, unitId: UnitId): boolean {
  return !index.split || index.split.loaded.has(unitId) || !index.split.units.has(unitId);
}

/** Unités (connues du manifeste) pas encore chargées parmi `unitIds`, sans doublon. */
export function missingUnits(index: ContentIndex, unitIds: Iterable<UnitId>): UnitId[] {
  const split = index.split;
  if (!split) return [];
  return [...new Set(unitIds)].filter((id) => split.units.has(id) && !split.loaded.has(id));
}

export function unitsOfLessons(index: ContentIndex, lessonIds: Iterable<LessonId>): UnitId[] {
  return [...new Set([...lessonIds].flatMap((id) => index.lessons.get(id)?.unit ?? []))];
}

export function unitsOfConcepts(index: ContentIndex, conceptIds: Iterable<ConceptId>): UnitId[] {
  const map = index.split?.conceptUnits;
  if (!map) return [];
  return [...new Set([...conceptIds].flatMap((id) => map.get(id) ?? []))];
}

/**
 * Unités à charger pour jouer des leçons : la leçon elle-même, puis les unités des concepts qu'elle
 * cite (distracteurs, audio). Appeler deux fois : après chargement, les étapes révèlent d'autres concepts.
 */
export function unitsForLessons(index: ContentIndex, lessonIds: Iterable<LessonId>): UnitId[] {
  const ids = [...lessonIds];
  const out = new Set(unitsOfLessons(index, ids));
  for (const id of ids) {
    const lesson = index.lessons.get(id);
    if (lesson) for (const unit of unitsOfConcepts(index, lessonConceptRefs(lesson))) out.add(unit);
  }
  return [...out];
}

/** Recompose les fichiers bruts (ordre des leçons et concepts du core ; cartes culture par unité). */
export function mergeSplit(core: CoreFile, units: readonly UnitFile[]): RawPackFiles {
  const lessons = new Map(units.flatMap((u) => u.lessons.map((l) => [l.id, l] as const)));
  const concepts = new Map(units.flatMap((u) => u.concepts.map((c) => [c.id, c] as const)));
  const missing = [...core.lessonIndex.filter((l) => !lessons.has(l.id)).map((l) => l.id), ...core.conceptIndex.filter((c) => !concepts.has(c.id)).map((c) => c.id)];
  if (missing.length > 0) throw new Error(`Unités incomplètes : ${missing.slice(0, 5).join(", ")}`);
  return {
    pack: core.pack,
    curriculum: core.curriculum,
    lessons: core.lessonIndex.map((l) => lessons.get(l.id) as Lesson),
    concepts: core.conceptIndex.map((c) => concepts.get(c.id) as Concept),
    culture: [...new Map(units.flatMap((u) => u.culture.map((c) => [c.id, c] as const))).values()],
    ...(core.dialogues ? { dialogues: core.dialogues } : {}),
    ...(core.guides ? { guides: core.guides } : {}),
    ...(core.variants ? { variants: core.variants } : {}),
    mediaIndex: core.mediaIndex,
    exams: core.exams,
    placement: core.placement,
    games: core.games,
  };
}

/** Octets d'une unité à télécharger pour le hors ligne (JSON + médias présents). */
export function unitDownloadBytes(entry: UnitManifestEntry): number {
  return entry.bytes + entry.mediaBytes;
}
