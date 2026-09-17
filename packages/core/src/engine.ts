import { contentMedia, hasPitchRef } from "./media.ts";
import { compareAnswer, compareLoose, heardClassOf, normalizeAnswer, toneOf, type AnswerMatch } from "./text.ts";
import type {
  Concept,
  ConceptId,
  ContentIndex,
  CultureCard,
  Dialogue,
  GameId,
  LexicalVariantEntry,
  Lesson,
  LessonId,
  LessonStep,
  Localized,
  LocalizedQuestion,
  MatchPairsMode,
  StepType,
  Tone,
} from "./types.ts";

/**
 * Moteur d'exercices : transforme une étape de leçon (donnée) en exercice
 * jouable (options mélangées, bonne réponse), puis évalue la réponse.
 * Il ne connaît aucune langue : tout vient du ContentIndex.
 */

export interface ChoiceOption {
  id: string;
  /** Texte dans la langue cible (vietnamien). */
  text?: string;
  /** Libellé dans la langue d'interface (questions de culture). */
  label?: Localized;
  conceptId?: ConceptId;
  image?: string;
  /** Pour tone_identify : les tons écrits regroupés dans cette classe auditive. */
  tones?: Tone[];
}

interface ExerciseBase {
  stepIndex: number;
  conceptIds: ConceptId[];
  explain: Localized | null;
}

/** Association attendue (ou proposée) dans `match_pairs`. */
export interface PairMatch {
  leftId: string;
  rightId: string;
}

/** Une réponse possible d'un tour de `dialogue_choice`, telle que l'interface l'affiche. */
export interface DialogueReplyView {
  id: string;
  /** Réplique en langue cible, ou null si la réponse n'existe qu'en langue d'interface. */
  vi: string | null;
  label: Localized | null;
  /** Tour suivant, null = fin du dialogue. */
  next: string | null;
  best: boolean;
  feedback: Localized | null;
}

export interface DialogueTurnView {
  id: string;
  vi: string;
  translation: Localized;
  audio: string | null;
  /** Réponses mélangées (ordre déterministe, lié à la graine). */
  replies: DialogueReplyView[];
}

/** Une consigne de jeu de rôle, concept résolu. */
export interface RoleplayPromptView {
  cue: Localized;
  concept: Concept;
  /** Courbe F0 présente : la réplique est notée ; null = entraînement libre. */
  pitchRef: string | null;
}

export type Exercise =
  | (ExerciseBase & { type: "culture_card"; card: CultureCard; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "listen_pick_image" | "listen_pick_text"; audio: Concept; options: ChoiceOption[]; answerId: string })
  /** Écoute globale d'un dialogue puis une question de compréhension (options localisées, ordre du fichier). */
  | (ExerciseBase & { type: "listen_gist"; dialogue: Dialogue; question: LocalizedQuestion; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "tone_identify"; audio: Concept; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "tone_minimal_pair"; audio: Concept | null; target: string; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "spot_the_south"; entry: LexicalVariantEntry; options: ChoiceOption[]; answerId: string })
  | (ExerciseBase & { type: "build_sentence"; target: string; translation: Localized; audio: Concept | null; tokens: ChoiceOption[] })
  | (ExerciseBase & { type: "speak_repeat"; concept: Concept; pitchRef: string | null })
  /** Produire le mot avec le bon ton (une syllabe) : noté par la courbe de hauteur, comme speak_repeat. */
  | (ExerciseBase & { type: "tone_produce"; concept: Concept; tone: Tone; pitchRef: string | null })
  /** Trou dans une phrase : choix parmi des formes proches (l'erreur de ton est « presque »). */
  | (ExerciseBase & { type: "fill_gap"; text: string; translation: Localized | null; options: ChoiceOption[]; answerId: string })
  /** Transcrire ce qu'on entend (clavier vietnamien, spec §8.4). `accepted[0]` = forme de référence. */
  | (ExerciseBase & { type: "listen_transcribe"; audio: Concept; accepted: string[] })
  | (ExerciseBase & { type: "translate_to_vi"; source: Localized; accepted: string[] })
  /** Traduction vers la langue d'interface : comparaison relâchée (accents et article facultatifs). */
  | (ExerciseBase & { type: "translate_to_fr"; source: string; accepted: { fr: string[] } & Partial<Record<string, string[]>> })
  /** Appariement : chaque élément de `left` va avec un élément de `right` (mêmes concepts, ordres différents). */
  | (ExerciseBase & { type: "match_pairs"; mode: MatchPairsMode; left: ChoiceOption[]; right: ChoiceOption[]; answer: PairMatch[] })
  /** Répondre oralement à une question : noté seulement si une des réponses acceptées a une courbe F0. */
  | (ExerciseBase & { type: "speak_answer"; prompt: string; translation: Localized; audio: string | null; accepted: Concept[]; pitchRef: string | null })
  /** Jeu de rôle guidé : 2 à 4 répliques à dire ; noté si au moins une a une courbe F0. */
  | (ExerciseBase & { type: "speak_roleplay"; situation: Localized; prompts: RoleplayPromptView[] })
  /** Dialogue à embranchements : `bestReplyIds` = réponses attendues (vide = entraînement non noté). */
  | (ExerciseBase & { type: "dialogue_choice"; situation: Localized | null; startId: string; turns: DialogueTurnView[]; bestReplyIds: string[] })
  | (ExerciseBase & { type: "game"; game: GameId; conceptIds: ConceptId[] })
  | (ExerciseBase & { type: "unsupported"; stepType: StepType });

export type ChoiceExercise = Extract<Exercise, { answerId: string }>;

export type ExerciseResponse =
  | { kind: "choice"; optionId: string }
  | { kind: "tokens"; optionIds: string[] }
  /** Réponse écrite (transcription, traduction) — telle que tapée, normalisée à la comparaison. */
  | { kind: "text"; text: string }
  /** Appariement : une entrée par association proposée (les doublons de gauche sont ignorés). */
  | { kind: "pairs"; pairs: PairMatch[] }
  /** Chemin dans un dialogue à embranchements : identifiants des réponses choisies, dans l'ordre. */
  | { kind: "path"; turnIds: string[] }
  | { kind: "speech"; score: number | null }
  | { kind: "game"; correct: number; total: number }
  | { kind: "skip" };

export interface Evaluation {
  correct: boolean;
  /** Presque juste (erreur de ton seule) : message spécifique, note FSRS « hard ». */
  nearMiss: boolean;
  /** false = n'influence ni le score ni le SRS (micro refusé, exercice passé, type non géré). */
  graded: boolean;
  expected: string;
  explain: Localized | null;
  /** Nature de l'écart pour une réponse écrite (« presque : c'est má, pas mà »). */
  match?: AnswerMatch["kind"];
}

/** Score de prononciation (0–100) à partir duquel speak_repeat / tone_produce est réussi. */
export const SPEAK_PASS_SCORE = 60;
export const GAME_PASS_RATIO = 0.7;
/**
 * Exercices à score partiel (`match_pairs`, `dialogue_choice`) : tout juste pour être réussi,
 * « presque » à partir de ce taux.
 */
export const PARTIAL_NEAR_MISS_RATIO = 0.7;

// ---------------------------------------------------------------------------
// Aléa déterministe : même séance + même étape = même ordre d'options (reprise exacte).

export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// ---------------------------------------------------------------------------

export class ContentError extends Error {
  override name = "ContentError";
}

function requireConcept(content: ContentIndex, id: ConceptId): Concept {
  const c = content.concepts.get(id);
  if (!c) throw new ContentError(`Concept inconnu : ${id}`);
  return c;
}

export function buildExercise(content: ContentIndex, lesson: Lesson, stepIndex: number, seed: string): Exercise {
  const step = lesson.steps[stepIndex];
  if (!step) throw new ContentError(`Étape ${stepIndex} absente de ${lesson.id}`);
  const rand = seededRandom(`${seed}:${lesson.id}:${stepIndex}`);
  return buildFromStep(content, lesson, step, stepIndex, rand);
}

function buildFromStep(content: ContentIndex, lesson: Lesson, step: LessonStep, stepIndex: number, rand: () => number): Exercise {
  const stepType: StepType = step.type;
  switch (step.type) {
    case "culture_card": {
      const card = content.culture.get(step.ref);
      if (!card) throw new ContentError(`Carte culture inconnue : ${step.ref}`);
      const options = card.question.options.map((label, i) => ({ id: String(i), label }));
      return {
        type: "culture_card", stepIndex, conceptIds: [], explain: card.question.explain ?? null,
        card, options, answerId: String(card.question.answer),
      };
    }

    case "listen_pick_image": {
      const audio = requireConcept(content, step.concept);
      const all = [step.concept, ...step.distractors].map((id) => requireConcept(content, id));
      const options = shuffle(all, rand).map((c) => ({ id: c.id, conceptId: c.id, ...(c.image ? { image: c.image } : {}), text: c.vi }));
      return { type: step.type, stepIndex, conceptIds: [audio.id], explain: step.explain ?? audio.note ?? null, audio, options, answerId: audio.id };
    }

    case "listen_pick_text": {
      const audio = requireConcept(content, step.concept);
      const texts = shuffle([audio.vi, ...step.distractors], rand);
      const options = texts.map((text, i) => ({ id: `t${i}`, text }));
      const answer = options.find((o) => o.text === audio.vi);
      return { type: step.type, stepIndex, conceptIds: [audio.id], explain: step.explain ?? audio.note ?? null, audio, options, answerId: answer?.id ?? "" };
    }

    case "listen_transcribe": {
      const audio = requireConcept(content, step.concept);
      // La forme du concept d'abord : c'est elle qu'on affiche en correction.
      const accepted = [...new Set([audio.vi, ...(step.accepted ?? [])])];
      return {
        type: step.type, stepIndex, conceptIds: [audio.id], explain: step.explain ?? audio.note ?? null,
        audio, accepted,
      };
    }

    case "listen_gist": {
      const dialogue = content.dialogues.get(step.dialogue);
      if (!dialogue) throw new ContentError(`Dialogue inconnu : ${step.dialogue}`);
      const question = dialogue.question;
      if (!question) throw new ContentError(`Dialogue ${dialogue.id} sans question : listen_gist impossible`);
      // Comme la carte culture, les options gardent l'ordre du fichier (la réponse est un index).
      const options = question.options.map((label, i) => ({ id: String(i), label }));
      return {
        type: step.type, stepIndex,
        conceptIds: conceptsInText(content, lesson, dialogue.turns.map((t) => t.vi).join(" ")),
        explain: step.explain ?? question.explain ?? null,
        dialogue, question, options, answerId: String(question.answer),
      };
    }

    case "tone_identify": {
      const audio = requireConcept(content, step.concept);
      const classes = content.pack.toneSystem?.heardClasses;
      if (!classes) throw new ContentError(`tone_identify sans toneSystem dans le pack`);
      const tone = audio.tone ?? toneOf(audio.vi);
      const answerClass = heardClassOf(tone, classes);
      // Les classes gardent un ordre fixe : l'oreille apprend une grille stable.
      const options = classes.map((tones, i) => ({ id: `tone${i}`, tones: [...tones] }));
      return { type: step.type, stepIndex, conceptIds: [audio.id], explain: step.explain ?? null, audio, options, answerId: `tone${answerClass}` };
    }

    case "tone_minimal_pair": {
      const targetIndex = Math.floor(rand() * step.pair.length);
      const target = step.pair[targetIndex] ?? step.pair[0] ?? "";
      const audioId = step.audioConcepts?.[targetIndex];
      const audio = audioId ? requireConcept(content, audioId) : null;
      const options = step.pair.map((text, i) => ({ id: `p${i}`, text }));
      return {
        type: step.type, stepIndex, conceptIds: audio ? [audio.id] : [], explain: step.explain ?? null,
        audio, target, options, answerId: `p${targetIndex}`,
      };
    }

    case "spot_the_south": {
      const entry = content.variants?.entries.find((e) => e.id === step.variant);
      if (!entry) throw new ContentError(`Variante inconnue : ${step.variant}`);
      const south = entry.south[0] ?? "";
      const north = entry.north[0] ?? "";
      const options = shuffle([{ id: "south", text: south }, { id: "north", text: north }], rand);
      return { type: step.type, stepIndex, conceptIds: [], explain: step.explain ?? entry.note ?? null, entry, options, answerId: "south" };
    }

    case "build_sentence": {
      const tokens = shuffle(step.tokens.map((text, i) => ({ id: `k${i}`, text })), rand);
      const audio = step.audioConcept ? requireConcept(content, step.audioConcept) : null;
      return {
        type: step.type, stepIndex, conceptIds: audio ? [audio.id] : conceptsInText(content, lesson, step.target),
        explain: step.explain ?? null, target: step.target, translation: step.translation, audio, tokens,
      };
    }

    case "speak_repeat": {
      const concept = requireConcept(content, step.concept);
      return {
        type: step.type, stepIndex, conceptIds: [concept.id], explain: step.explain ?? concept.note ?? null,
        concept, pitchRef: step.pitchRef ?? concept.pitch ?? null,
      };
    }

    case "tone_produce": {
      const concept = requireConcept(content, step.concept);
      return {
        type: step.type, stepIndex, conceptIds: [concept.id], explain: step.explain ?? concept.note ?? null,
        concept, tone: concept.tone ?? toneOf(concept.vi), pitchRef: concept.pitch ?? null,
      };
    }

    case "fill_gap": {
      const options = shuffle(step.options, rand).map((text, i) => ({ id: `o${i}`, text }));
      const answerId = options.find((o) => normalizeAnswer(o.text) === normalizeAnswer(step.answer))?.id ?? "";
      return {
        type: step.type, stepIndex,
        conceptIds: conceptsInText(content, lesson, step.text.replace(GAP, step.answer)),
        explain: step.explain ?? null,
        text: step.text, translation: step.translation ?? null, options, answerId,
      };
    }

    case "translate_to_vi":
      return {
        type: step.type, stepIndex,
        conceptIds: conceptsInText(content, lesson, step.accepted[0] ?? ""),
        explain: step.explain ?? null, source: step.source, accepted: [...step.accepted],
      };

    case "translate_to_fr":
      return {
        type: step.type, stepIndex, conceptIds: conceptsInText(content, lesson, step.source),
        explain: step.explain ?? null, source: step.source, accepted: step.accepted,
      };

    case "match_pairs": {
      const concepts = step.concepts.map((id) => requireConcept(content, id));
      const mode = step.mode ?? "text_gloss";
      // Deux mélanges indépendants : les deux colonnes ne sont pas dans le même ordre.
      const left = shuffle(concepts, rand).map((c) => matchOption(c, "l", mode === "text_gloss" ? "text" : "audio"));
      const right = shuffle(concepts, rand).map((c) => matchOption(c, "r", mode === "audio_text" ? "text" : mode === "audio_image" ? "image" : "gloss"));
      return {
        type: step.type, stepIndex, conceptIds: concepts.map((c) => c.id), explain: null,
        mode, left, right, answer: concepts.map((c) => ({ leftId: `l${c.id}`, rightId: `r${c.id}` })),
      };
    }

    case "speak_answer": {
      const media = contentMedia(content);
      const accepted = step.accepted.map((id) => requireConcept(content, id));
      const graded = accepted.find((c) => hasPitchRef(c, media));
      return {
        type: step.type, stepIndex, conceptIds: accepted.map((c) => c.id), explain: step.explain ?? null,
        prompt: step.prompt, translation: step.translation, audio: step.audio ?? null,
        accepted, pitchRef: graded?.pitch ?? null,
      };
    }

    case "speak_roleplay": {
      const media = contentMedia(content);
      const prompts = step.prompts.map((p) => {
        const concept = requireConcept(content, p.concept);
        return { cue: p.cue, concept, pitchRef: hasPitchRef(concept, media) ? concept.pitch ?? null : null };
      });
      return {
        type: step.type, stepIndex, conceptIds: prompts.map((p) => p.concept.id), explain: step.explain ?? null,
        situation: step.situation, prompts,
      };
    }

    case "dialogue_choice": {
      const turns: DialogueTurnView[] = step.turns.map((turn) => ({
        id: turn.id, vi: turn.vi, translation: turn.translation, audio: turn.audio ?? null,
        replies: shuffle(turn.replies, rand).map((r) => ({
          id: r.id, vi: r.vi ?? null, label: r.translation ?? null, next: r.next ?? null,
          best: r.best === true, feedback: r.feedback ?? null,
        })),
      }));
      const text = step.turns.flatMap((t) => [t.vi, ...t.replies.flatMap((r) => (r.vi ? [r.vi] : []))]).join(" ");
      return {
        type: step.type, stepIndex, conceptIds: conceptsInText(content, lesson, text), explain: step.explain ?? null,
        situation: step.situation ?? null, startId: step.turns[0]?.id ?? "",
        turns, bestReplyIds: turns.flatMap((t) => t.replies.filter((r) => r.best).map((r) => r.id)),
      };
    }

    case "game": {
      const pool = step.conceptPool === "lesson" || step.conceptPool === "unit" || step.conceptPool === "known"
        ? lesson.concepts
        : step.conceptPool;
      return { type: step.type, stepIndex, conceptIds: [...pool], explain: null, game: step.game };
    }

    default:
      // Inatteignable avec les types connus : filet pour un pack produit par une version plus récente.
      return { type: "unsupported", stepIndex, conceptIds: [], explain: null, stepType };
  }
}

/** Marqueur du trou dans `fill_gap` (identique au schéma de leçon). */
export const GAP = "___";

/**
 * Une carte d'appariement. `side` évite toute collision d'identifiants entre les deux colonnes ;
 * une colonne « audio » ne porte volontairement aucun texte (sinon la réponse est écrite dessus).
 */
function matchOption(concept: Concept, side: "l" | "r", show: "audio" | "text" | "gloss" | "image"): ChoiceOption {
  const base = { id: `${side}${concept.id}`, conceptId: concept.id };
  switch (show) {
    case "audio":
      return base;
    case "text":
      return { ...base, text: concept.vi };
    case "gloss":
      return { ...base, label: concept.gloss };
    case "image":
      return { ...base, ...(concept.image ? { image: concept.image } : {}) };
  }
}

/** Concepts de la leçon dont la forme apparaît dans le texte (pour rattacher une phrase au SRS). */
function conceptsInText(content: ContentIndex, lesson: Lesson, text: string): ConceptId[] {
  const haystack = ` ${normalizeAnswer(text)} `;
  return lesson.concepts.filter((id) => {
    const c = content.concepts.get(id);
    return c !== undefined && haystack.includes(` ${normalizeAnswer(c.vi)} `);
  });
}

// ---------------------------------------------------------------------------

/** Note d'un oral : seuil SPEAK_PASS_SCORE, « presque » dans les 15 points en dessous. */
function speechEvaluation(score: number, expected: string, explain: Localized | null): Evaluation {
  const correct = score >= SPEAK_PASS_SCORE;
  return { correct, nearMiss: !correct && score >= SPEAK_PASS_SCORE - 15, graded: true, expected, explain };
}

/** Note d'un exercice à score partiel : tout juste pour être réussi, « presque » au-delà du seuil. */
function partialEvaluation(correctCount: number, total: number, expected: string, explain: Localized | null): Evaluation {
  const ratio = total === 0 ? 0 : correctCount / total;
  return {
    correct: total > 0 && correctCount === total,
    nearMiss: correctCount < total && ratio >= PARTIAL_NEAR_MISS_RATIO,
    graded: true,
    expected,
    explain,
  };
}

/** Correction lisible d'un appariement : « má → maman · ba → papa ». */
function pairsExpected(left: readonly ChoiceOption[], right: readonly ChoiceOption[], answer: readonly PairMatch[]): string {
  const text = (o: ChoiceOption | undefined) => o?.text ?? o?.label?.fr ?? o?.image ?? o?.conceptId ?? "";
  return answer.map((p) => `${text(left.find((o) => o.id === p.leftId))} → ${text(right.find((o) => o.id === p.rightId))}`).join(" · ");
}

export function evaluate(exercise: Exercise, response: ExerciseResponse): Evaluation {
  const ungraded = (expected = ""): Evaluation => ({ correct: true, nearMiss: false, graded: false, expected, explain: null });
  if (response.kind === "skip") return { ...ungraded(), correct: false };

  switch (exercise.type) {
    case "culture_card":
    case "listen_pick_image":
    case "listen_pick_text":
    case "listen_gist":
    case "fill_gap":
    case "tone_identify":
    case "tone_minimal_pair":
    case "spot_the_south": {
      if (response.kind !== "choice") return { ...ungraded(), correct: false };
      const expectedOption = exercise.options.find((o) => o.id === exercise.answerId);
      const chosen = exercise.options.find((o) => o.id === response.optionId);
      const correct = response.optionId === exercise.answerId;
      const expected = expectedOption?.text ?? expectedOption?.label?.fr ?? expectedOption?.tones?.join(" / ") ?? "";
      // Une confusion de ton sur le même mot est « presque juste ».
      const nearMiss =
        !correct && chosen?.text !== undefined && expectedOption?.text !== undefined &&
        compareAnswer(chosen.text, [expectedOption.text]).kind === "tone_only";
      // Les cartes culture informent, elles ne notent pas.
      const graded = exercise.type !== "culture_card";
      return { correct, nearMiss, graded, expected, explain: exercise.explain };
    }

    case "build_sentence": {
      if (response.kind !== "tokens") return { ...ungraded(exercise.target), correct: false };
      const byId = new Map(exercise.tokens.map((t) => [t.id, t.text ?? ""]));
      const sentence = response.optionIds.map((id) => byId.get(id) ?? "").join(" ");
      const match = compareAnswer(sentence, [exercise.target]);
      return {
        correct: match.kind === "correct",
        nearMiss: match.kind === "tone_only",
        graded: true,
        expected: exercise.target,
        explain: exercise.explain,
      };
    }

    case "speak_repeat":
    case "tone_produce": {
      if (response.kind !== "speech") return { ...ungraded(exercise.concept.vi), correct: false };
      // Micro refusé ou indisponible : l'exercice devient de l'écoute, sans note.
      if (response.score === null) return ungraded(exercise.concept.vi);
      return speechEvaluation(response.score, exercise.concept.vi, exercise.explain);
    }

    case "speak_answer": {
      const expected = exercise.accepted[0]?.vi ?? "";
      if (response.kind !== "speech") return { ...ungraded(expected), correct: false };
      // Sans courbe F0 de référence (ou sans micro) : écoute et répétition libres, jamais notées.
      if (response.score === null || exercise.pitchRef === null) return ungraded(expected);
      return speechEvaluation(response.score, expected, exercise.explain);
    }

    case "speak_roleplay": {
      const expected = exercise.prompts.map((p) => p.concept.vi).join(" · ");
      if (response.kind !== "speech") return { ...ungraded(expected), correct: false };
      if (response.score === null || !exercise.prompts.some((p) => p.pitchRef !== null)) return ungraded(expected);
      return speechEvaluation(response.score, expected, exercise.explain);
    }

    case "listen_transcribe":
    case "translate_to_vi": {
      const expected = exercise.accepted[0] ?? "";
      if (response.kind !== "text") return { ...ungraded(expected), correct: false };
      const match = compareAnswer(response.text, exercise.accepted);
      // Écrit à un ton (ou un accent) près : « presque », noté « hard » par le SRS.
      return {
        correct: match.kind === "correct",
        nearMiss: match.kind === "tone_only" || match.kind === "diacritics_only",
        graded: true,
        expected: match.kind === "correct" ? expected : match.expected,
        explain: exercise.explain,
        match: match.kind,
      };
    }

    case "translate_to_fr": {
      const forms = Object.values(exercise.accepted).flatMap((list) => list ?? []);
      const expected = exercise.accepted.fr[0] ?? "";
      if (response.kind !== "text") return { ...ungraded(expected), correct: false };
      // Langue d'interface : accents, ponctuation et article initial facultatifs (toutes langues acceptées).
      const correct = compareLoose(response.text, forms);
      return { correct, nearMiss: false, graded: true, expected, explain: exercise.explain, match: correct ? "correct" : "wrong" };
    }

    case "match_pairs": {
      const expected = pairsExpected(exercise.left, exercise.right, exercise.answer);
      if (response.kind !== "pairs") return { ...ungraded(expected), correct: false };
      const wanted = new Map(exercise.answer.map((p) => [p.leftId, p.rightId]));
      const seen = new Set<string>();
      let ok = 0;
      for (const pair of response.pairs) {
        if (seen.has(pair.leftId)) continue;
        seen.add(pair.leftId);
        if (wanted.get(pair.leftId) === pair.rightId) ok++;
      }
      const total = exercise.answer.length;
      return partialEvaluation(ok, total, expected, exercise.explain);
    }

    case "dialogue_choice": {
      const best = new Set(exercise.bestReplyIds);
      const expected = exercise.turns.flatMap((t) => t.replies.filter((r) => best.has(r.id)).map((r) => r.vi ?? r.label?.fr ?? r.id)).join(" · ");
      if (response.kind !== "path") return { ...ungraded(expected), correct: false };
      // Aucun « meilleur choix » déclaré : dialogue d'exploration, on ne note pas.
      if (best.size === 0) return ungraded(expected);
      const known = new Set(exercise.turns.flatMap((t) => t.replies.map((r) => r.id)));
      const played = response.turnIds.filter((id) => known.has(id));
      if (played.length === 0) return { ...ungraded(expected), correct: false };
      return partialEvaluation(played.filter((id) => best.has(id)).length, played.length, expected, exercise.explain);
    }

    case "game": {
      if (response.kind !== "game" || response.total === 0) return ungraded();
      const correct = response.correct / response.total >= GAME_PASS_RATIO;
      return { correct, nearMiss: false, graded: true, expected: "", explain: null };
    }

    case "unsupported":
      return ungraded();
  }
}

// ---------------------------------------------------------------------------
// Déroulé d'une leçon : file d'étapes, relance des erreurs, intervention du professeur.

export interface QueueItem {
  stepIndex: number;
  attempt: number;
}

export interface StepResult extends QueueItem {
  correct: boolean;
  nearMiss: boolean;
  graded: boolean;
  responseMs: number;
  conceptIds: ConceptId[];
}

/** État sérialisable (JSON) : réécrit après chaque réponse pour une reprise exacte. */
export interface LessonRun {
  sessionId: string;
  lessonId: LessonId;
  queue: QueueItem[];
  cursor: number;
  results: StepResult[];
  /** Erreurs consécutives par concept. */
  errorStreaks: Record<ConceptId, number>;
  /** Concept sur lequel Cô Mai doit intervenir (3 erreurs d'affilée), sinon null. */
  tutorNudge: ConceptId | null;
  startedAt: string;
}

export const MAX_ATTEMPTS = 2;
export const TUTOR_NUDGE_AFTER = 3;

/**
 * `playable` : étapes à jouer (indices d'origine) ; les autres sont retirées de la séance, ni affichées
 * ni notées (contrat phase5 §1, étapes tonales sans audio natif). Défaut : toutes.
 */
export function startLesson(lesson: Lesson, sessionId: string, now: Date, playable?: readonly number[]): LessonRun {
  const keep = playable ? new Set(playable) : null;
  return {
    sessionId,
    lessonId: lesson.id,
    queue: lesson.steps.flatMap((_, stepIndex) => (keep && !keep.has(stepIndex) ? [] : [{ stepIndex, attempt: 1 }])),
    cursor: 0,
    results: [],
    errorStreaks: {},
    tutorNudge: null,
    startedAt: now.toISOString(),
  };
}

export function currentItem(run: LessonRun): QueueItem | null {
  return run.queue[run.cursor] ?? null;
}

export function isFinished(run: LessonRun): boolean {
  return run.cursor >= run.queue.length;
}

export function recordResult(run: LessonRun, exercise: Exercise, evaluation: Evaluation, responseMs: number): LessonRun {
  const item = currentItem(run);
  if (!item) return run;

  const result: StepResult = {
    ...item,
    correct: evaluation.correct,
    nearMiss: evaluation.nearMiss,
    graded: evaluation.graded,
    responseMs,
    conceptIds: exercise.conceptIds,
  };

  const errorStreaks = { ...run.errorStreaks };
  let tutorNudge: ConceptId | null = null;
  if (evaluation.graded) {
    for (const id of exercise.conceptIds) {
      errorStreaks[id] = evaluation.correct ? 0 : (errorStreaks[id] ?? 0) + 1;
      if ((errorStreaks[id] ?? 0) >= TUTOR_NUDGE_AFTER) tutorNudge = id;
    }
  }

  // Une erreur relance l'exercice en fin de leçon, sans interrompre (spec §3.3).
  // Les mini-jeux (mise en pratique) ne sont jamais relancés : le résultat compte, on avance.
  const queue = [...run.queue];
  if (evaluation.graded && !evaluation.correct && item.attempt < MAX_ATTEMPTS && exercise.type !== "game") {
    queue.push({ stepIndex: item.stepIndex, attempt: item.attempt + 1 });
  }

  return { ...run, queue, cursor: run.cursor + 1, results: [...run.results, result], errorStreaks, tutorNudge };
}

/** Score de leçon (0–1) : réussites au premier essai parmi les étapes notées. */
export function lessonScore(run: LessonRun): number {
  const firsts = run.results.filter((r) => r.attempt === 1 && r.graded);
  if (firsts.length === 0) return 1;
  return firsts.filter((r) => r.correct).length / firsts.length;
}

/** Nombre d'étapes restantes, relances connues comprises (pour la barre de progression). */
export function remainingSteps(run: LessonRun): number {
  return Math.max(0, run.queue.length - run.cursor);
}
