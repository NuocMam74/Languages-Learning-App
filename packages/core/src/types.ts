/**
 * Types du contenu. Miroir TypeScript de content/schema/*.schema.json :
 * toute modification d'un schéma doit être répercutée ici (et inversement).
 */

export type Locale = "fr" | "en";
export type Localized = { fr: string } & Partial<Record<string, string>>;

export type Tone = "ngang" | "huyen" | "sac" | "hoi" | "nga" | "nang";
export type ConceptId = string;
export type LessonId = string;
export type UnitId = string;

export interface AudioRef {
  voice: string;
  src: string;
  source: "native" | "tts";
  speed: "natural" | "slow";
}

export interface Concept {
  id: ConceptId;
  type: "word" | "structure" | "tone" | "sound";
  vi: string;
  ipaSouth?: string;
  tone?: Tone;
  gloss: Localized;
  northernEquivalent?: string;
  register?: "neutral" | "familiar" | "formal";
  audio: AudioRef[];
  pitch?: string;
  image?: string;
  examples?: { vi: string; fr: string; en?: string; audio?: string }[];
  note?: Localized;
  reviewed: boolean;
}

export interface CultureCard {
  id: string;
  title: Localized;
  body: Localized;
  vi?: string;
  audio?: string;
  question: { prompt: Localized; options: Localized[]; answer: number; explain?: Localized };
  reviewed: boolean;
}

export interface LexicalVariantEntry {
  id: string;
  gloss: Localized;
  south: string[];
  north: string[];
  severity: "error" | "warning" | "none";
  exceptions?: string[];
  note?: Localized;
  reviewed: boolean;
}

export interface LexicalVariants {
  version: number;
  entries: LexicalVariantEntry[];
  familiar?: { form: string; standard: string; gloss: Localized }[];
}

type WithExplain = { explain?: Localized };

export type GameId = "cho_noi" | "karaoke_tonal" | "xe_om" | "bua_com" | "doi_dap" | "nho_mat";

export type LessonStep =
  | { type: "culture_card"; ref: string }
  | ({ type: "listen_pick_image"; concept: ConceptId; distractors: ConceptId[] } & WithExplain)
  | ({ type: "listen_pick_text"; concept: ConceptId; distractors: string[] } & WithExplain)
  | ({ type: "listen_transcribe"; concept: ConceptId; accepted?: string[] } & WithExplain)
  | ({ type: "tone_identify"; concept: ConceptId } & WithExplain)
  | ({ type: "tone_minimal_pair"; pair: string[]; audioConcepts?: ConceptId[] } & WithExplain)
  | ({ type: "tone_produce"; concept: ConceptId } & WithExplain)
  | ({ type: "speak_repeat"; concept: ConceptId; pitchRef?: string } & WithExplain)
  | { type: "match_pairs"; concepts: ConceptId[]; mode?: "audio_text" | "text_gloss" | "audio_image" }
  | ({ type: "build_sentence"; target: string; tokens: string[]; translation: Localized; audioConcept?: ConceptId } & WithExplain)
  | ({ type: "fill_gap"; text: string; answer: string; options: string[]; translation?: Localized } & WithExplain)
  | ({ type: "translate_to_vi"; source: Localized; accepted: string[] } & WithExplain)
  | ({ type: "translate_to_fr"; source: string; accepted: { fr: string[] } & Partial<Record<string, string[]>> } & WithExplain)
  | ({ type: "spot_the_south"; variant: string } & WithExplain)
  | { type: "game"; game: GameId; conceptPool: "lesson" | "unit" | "known" | ConceptId[] };

export type StepType = LessonStep["type"];

export interface Lesson {
  id: LessonId;
  unit: UnitId;
  kind?: "lesson" | "review" | "unit_test";
  title: Localized;
  goal: Localized;
  estimatedMinutes: number;
  prerequisites: LessonId[];
  concepts: ConceptId[];
  steps: LessonStep[];
  review: { srsIntroduce: ConceptId[] };
  reviewed: boolean;
}

export interface Unit {
  id: UnitId;
  title: Localized;
  status: "available" | "planned";
  tags?: string[];
  /** Unités à réussir avant celle-ci (défaut : la précédente). */
  requires?: UnitId[];
  lessons: LessonId[];
}

export interface Curriculum {
  pack: string;
  blocks: { id: string; title: Localized; units: UnitId[]; certificate?: "A0" | "A1" | "A2" }[];
  units: Unit[];
  paths: Record<string, { boostTags: string[]; extraUnits?: UnitId[] }>;
}

export type PackFeature = "tones" | "lexical_variants" | "diacritic_keyboard";

export interface Pack {
  code: string;
  lang: string;
  variant?: string;
  name: Localized;
  version: number;
  script: string;
  direction: "ltr" | "rtl";
  features: PackFeature[];
  toneSystem?: { written: Tone[]; heardClasses: Tone[][] };
  voices: { id: string; label: string; gender: "f" | "m"; accent: string }[];
  interfaceLocales: string[];
  welcome?: { vi: string; translation: Localized; audio?: string; reviewed: boolean };
  /** Noms des 5 divisions de ligue, de l'entrée au sommet. */
  leagueDivisions?: Localized[];
  /** 10 noms de tranches de niveaux (1–5, 6–10…). */
  levelNames?: Localized[];
  /** Persona du professeur IA ; absente = indisponible pour ce pack. */
  tutor?: { name: string; persona: Localized };
  comingSoon?: boolean;
}

/** Tout ce dont le moteur a besoin pour jouer les leçons d'un pack. */
export interface ContentIndex {
  pack: Pack;
  curriculum: Curriculum;
  lessons: ReadonlyMap<LessonId, Lesson>;
  concepts: ReadonlyMap<ConceptId, Concept>;
  culture: ReadonlyMap<string, CultureCard>;
  variants?: LexicalVariants;
  /**
   * Médias présents (contrat phase5 §1). Absent = inconnu (contenu lu sur disque en test) : tout est
   * considéré disponible. Le client le reçoit toujours avec le bundle.
   */
  mediaIndex?: ReadonlySet<string>;
}

/**
 * Module optionnel activé par le pack (spec §9, ADR 0002). Le moteur ne teste jamais
 * une langue : il teste une fonctionnalité déclarée dans pack.json.
 */
export function hasFeature(pack: Pick<Pack, "features">, feature: PackFeature): boolean {
  return pack.features.includes(feature);
}

/** Exercices qui n'ont de sens que pour un pack tonal (`features: ["tones"]`). */
export const TONAL_STEP_TYPES: ReadonlySet<StepType> = new Set<StepType>(["tone_identify", "tone_minimal_pair", "tone_produce"]);

export function localize(text: Localized, locale: string): string {
  return text[locale] ?? text.fr;
}
