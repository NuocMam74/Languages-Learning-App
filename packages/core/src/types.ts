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

/**
 * Catégorie grammaticale d'un concept, pour l'étude par catégorie (contrat phase14 §1).
 *
 * Les classes fermées du vietnamien y figurent telles quelles — classificateurs, particules
 * finales, interrogatifs : elles n'ont pas d'équivalent français et ce sont justement celles qu'on
 * veut pouvoir réviser en bloc. `phrase` couvre les tournures entières (`type: "structure"`).
 */
export type PartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "pronoun"
  | "classifier"
  | "numeral"
  | "preposition"
  | "conjunction"
  | "particle"
  | "question"
  | "phrase";

export interface Concept {
  id: ConceptId;
  type: "word" | "structure" | "tone" | "sound";
  vi: string;
  ipaSouth?: string;
  tone?: Tone;
  gloss: Localized;
  northernEquivalent?: string;
  register?: "neutral" | "familiar" | "formal";
  /** Absente sur les tons et les sons : ce ne sont pas des parties du discours. */
  pos?: PartOfSpeech;
  audio: AudioRef[];
  pitch?: string;
  image?: string;
  examples?: { vi: string; fr: string; en?: string; audio?: string }[];
  note?: Localized;
  reviewed: boolean;
}

/** Question à choix unique posée dans la langue d'interface (carte culture, dialogue). */
export interface LocalizedQuestion {
  prompt: Localized;
  options: Localized[];
  answer: number;
  explain?: Localized;
}

export interface CultureCard {
  id: string;
  title: Localized;
  body: Localized;
  vi?: string;
  audio?: string;
  question: LocalizedQuestion;
  reviewed: boolean;
}

export type DialogueId = string;

/** Réplique d'un dialogue enregistré (content/<pack>/dialogues). */
export interface DialogueTurn {
  /** Qui parle (libre : « Cô Mai », « Anh Nam »…). */
  speaker: string;
  vi: string;
  translation: Localized;
  audio?: string;
}

/**
 * Dialogue court (~15 s) : support de `listen_gist`. Linéaire — les dialogues à
 * embranchements sont décrits dans l'étape `dialogue_choice` elle-même.
 */
export interface Dialogue {
  id: DialogueId;
  title: Localized;
  turns: DialogueTurn[];
  /** Question de compréhension globale (obligatoire pour servir un `listen_gist`). */
  question?: LocalizedQuestion;
  reviewed: boolean;
}

/** Au-delà, ce n'est plus un dialogue de 15 s (contrat phase6 §3). */
export const DIALOGUE_MAX_TURNS = 8;

/** Réponse possible à un tour de `dialogue_choice` : en cible (`vi`), en langue d'interface, ou les deux. */
export interface DialogueChoiceReply {
  id: string;
  vi?: string;
  translation?: Localized;
  /** Tour suivant ; absent = fin du dialogue. */
  next?: string;
  /** Réponse attendue d'un locuteur du Sud (registre, politesse, justesse). */
  best?: boolean;
  feedback?: Localized;
}

export interface DialogueChoiceTurn {
  id: string;
  /** Ce que dit le personnage (langue cible). */
  vi: string;
  translation: Localized;
  audio?: string;
  replies: DialogueChoiceReply[];
}

export const DIALOGUE_CHOICE_MIN_TURNS = 3;
export const DIALOGUE_CHOICE_MAX_TURNS = 5;
export const ROLEPLAY_MIN_PROMPTS = 2;
export const ROLEPLAY_MAX_PROMPTS = 4;

/** Une consigne de jeu de rôle : la situation en langue d'interface, la réplique à dire (concept). */
export interface RoleplayPrompt {
  cue: Localized;
  concept: ConceptId;
}

export type MatchPairsMode = "audio_text" | "text_gloss" | "audio_image";

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

export type GameId = "cho_noi" | "karaoke_tonal" | "xe_om" | "bua_com" | "doi_dap" | "nho_mat" | "lo_to" | "ca_phe";

export type LessonStep =
  | { type: "culture_card"; ref: string }
  | ({ type: "listen_pick_image"; concept: ConceptId; distractors: ConceptId[] } & WithExplain)
  | ({ type: "listen_pick_text"; concept: ConceptId; distractors: string[] } & WithExplain)
  | ({ type: "listen_transcribe"; concept: ConceptId; accepted?: string[] } & WithExplain)
  | ({ type: "tone_identify"; concept: ConceptId } & WithExplain)
  | ({ type: "tone_minimal_pair"; pair: string[]; audioConcepts?: ConceptId[] } & WithExplain)
  | ({ type: "tone_produce"; concept: ConceptId } & WithExplain)
  | ({ type: "speak_repeat"; concept: ConceptId; pitchRef?: string } & WithExplain)
  | ({ type: "listen_gist"; dialogue: DialogueId } & WithExplain)
  | ({ type: "speak_answer"; prompt: string; translation: Localized; audio?: string; accepted: ConceptId[] } & WithExplain)
  | ({ type: "speak_roleplay"; situation: Localized; prompts: RoleplayPrompt[] } & WithExplain)
  | ({ type: "dialogue_choice"; situation?: Localized; turns: DialogueChoiceTurn[] } & WithExplain)
  | { type: "match_pairs"; concepts: ConceptId[]; mode?: MatchPairsMode }
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
  /**
   * Fiches conseils à lire avant les leçons de l'unité (contrat phase16 §3). Le contenu décide de
   * ce qu'il faut avoir compris avant de pratiquer : on n'assemble pas une phrase sans savoir dans
   * quel ordre les mots se rangent.
   */
  guides?: string[];
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

/**
 * Fiche conseil (contrat phase15 §1) : ce qu'un apprenant cherche hors séance — comment construire
 * une phrase, quoi dire dans une situation, ce qui se fait et ne se fait pas.
 *
 * C'est du contenu, pas de l'interface : une fiche se relit hors ligne, passe la garde du Sud et
 * attend sa relecture par un locuteur natif comme le reste du corpus.
 */
export interface GuideExample {
  vi: string;
  fr: string;
  en?: string;
  note?: Localized;
}

export interface GuideSection {
  heading: Localized;
  body: Localized;
  examples?: GuideExample[];
}

export interface Guide {
  id: string;
  kind: "grammar" | "situation" | "usage";
  /** Ordre de lecture dans son rayon ; absent = à la fin, par titre. */
  order?: number;
  title: Localized;
  summary: Localized;
  sections: GuideSection[];
  pitfalls?: Localized[];
  /** Concepts traités : la fiche renvoie au vocabulaire. */
  related?: ConceptId[];
  reviewed: boolean;
}

/** Tout ce dont le moteur a besoin pour jouer les leçons d'un pack. */
export interface ContentIndex {
  pack: Pack;
  curriculum: Curriculum;
  lessons: ReadonlyMap<LessonId, Lesson>;
  concepts: ReadonlyMap<ConceptId, Concept>;
  culture: ReadonlyMap<string, CultureCard>;
  /** Fiches conseils (contrat phase15 §1). Vide si le pack n'en a pas. */
  guides: ReadonlyMap<string, Guide>;
  /** Dialogues enregistrés (`listen_gist`). Vide si le pack n'en a pas. */
  dialogues: ReadonlyMap<DialogueId, Dialogue>;
  variants?: LexicalVariants;
  /**
   * Médias présents (contrat phase5 §1). Absent = inconnu (contenu lu sur disque en test) : tout est
   * considéré disponible. Le client le reçoit toujours avec le bundle.
   */
  mediaIndex?: ReadonlySet<string>;
  /**
   * Contenu découpé par unité (core.json + units/<unit>.json) : leçons et concepts des unités non
   * chargées sont des résumés (sans étapes, concepts compacts). Absent = tout est chargé.
   */
  split?: SplitState;
}

/** Taille d'un fichier d'unité et de ses médias présents (octets), pour le téléchargement hors ligne. */
export interface UnitManifestEntry {
  id: UnitId;
  bytes: number;
  mediaBytes: number;
  mediaCount: number;
}

export interface SplitState {
  version: number;
  /** Unités dont les leçons, concepts et cartes culture complets sont dans l'index. */
  loaded: Set<UnitId>;
  units: ReadonlyMap<UnitId, UnitManifestEntry>;
  /** Unité qui porte le concept complet. */
  conceptUnits: ReadonlyMap<ConceptId, UnitId>;
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

/**
 * Exercices de production orale : l'apprenant devait parler dans le micro (« Répète à voix
 * haute »). Ils sont retirés des séances — l'app n'écoute plus la voix, et un exercice qui
 * demande de parler sans jamais rien corriger n'apprend rien.
 *
 * Retirés comme une étape sans enregistrement : ni affichés, ni notés, ni comptés dans la barre
 * de progression. Le contenu garde ces étapes (les packs ne sont pas réécrits) ; c'est le moteur
 * qui ne les joue plus.
 */
export const SPEAKING_STEP_TYPES: ReadonlySet<StepType> = new Set<StepType>([
  "speak_repeat",
  "speak_answer",
  "speak_roleplay",
  "tone_produce",
]);

/**
 * Exercices qui exigent un enregistrement natif : sans le média, l'étape est retirée de la
 * séance (ni affichée, ni notée), comme les étapes tonales (contrat phase5 §1, phase6 §1).
 */
export const NATIVE_AUDIO_STEP_TYPES: ReadonlySet<StepType> = new Set<StepType>([
  ...TONAL_STEP_TYPES,
  "listen_transcribe",
  "listen_gist",
]);

export function localize(text: Localized, locale: string): string {
  return text[locale] ?? text.fr;
}
