import type { LessonStep, StepType } from "@parlo/core";
import type { DocKind } from "./studio-api.ts";

/** Documents et étapes « vides mais bien formés » pour démarrer une création. */

export const STEP_TYPES: readonly StepType[] = [
  "culture_card",
  "listen_pick_image",
  "listen_pick_text",
  "listen_transcribe",
  "listen_gist",
  "tone_identify",
  "tone_minimal_pair",
  "tone_produce",
  "speak_repeat",
  "speak_answer",
  "speak_roleplay",
  "dialogue_choice",
  "match_pairs",
  "build_sentence",
  "fill_gap",
  "translate_to_vi",
  "translate_to_fr",
  "spot_the_south",
  "game",
];

/** Étapes permises dans un examen (exam.schema.json : ni carte culture ni mini-jeu). */
export const EXAM_STEP_TYPES: readonly StepType[] = STEP_TYPES.filter((t) => t !== "culture_card" && t !== "game");

/** Nouvelle étape d'un type ; garde le concept de l'étape précédente quand c'est possible. */
export function stepTemplate(type: StepType, previous?: LessonStep): LessonStep {
  const concept = previous && "concept" in previous ? previous.concept : "";
  switch (type) {
    case "culture_card":
      return { type, ref: "" };
    case "listen_pick_image":
      return { type, concept, distractors: [] };
    case "listen_pick_text":
      return { type, concept, distractors: [""] };
    case "listen_transcribe":
    case "tone_identify":
    case "tone_produce":
    case "speak_repeat":
      return { type, concept };
    case "tone_minimal_pair":
      return { type, pair: ["", ""] };
    case "match_pairs":
      return { type, concepts: [] };
    case "build_sentence":
      return { type, target: "", tokens: [], translation: { fr: "" } };
    case "fill_gap":
      return { type, text: "___", answer: "", options: ["", ""] };
    case "translate_to_vi":
      return { type, source: { fr: "" }, accepted: [""] };
    case "translate_to_fr":
      return { type, source: "", accepted: { fr: [""] } };
    case "spot_the_south":
      return { type, variant: "" };
    case "game":
      return { type, game: "cho_noi", conceptPool: "lesson" };
    case "listen_gist":
      return { type, dialogue: "" };
    case "speak_answer":
      return { type, prompt: "", translation: { fr: "" }, accepted: [concept].filter(Boolean) as string[] };
    case "speak_roleplay":
      return { type, situation: { fr: "" }, prompts: [{ cue: { fr: "" }, concept }, { cue: { fr: "" }, concept }] };
    case "dialogue_choice":
      return {
        type,
        // `next` absent sur le dernier tour = fin du dialogue.
        turns: [1, 2, 3].map((n) => ({
          id: `t${n}`,
          vi: "",
          translation: { fr: "" },
          replies: [
            { id: `t${n}a`, vi: "", best: true, ...(n < 3 ? { next: `t${n + 1}` } : {}) },
            { id: `t${n}b`, vi: "", best: false, ...(n < 3 ? { next: `t${n + 1}` } : {}) },
          ],
        })),
      };
  }
}

export function templateFor(kind: DocKind, id: string, code: string): unknown {
  switch (kind) {
    case "lesson": {
      const unit = /^(.+\.u\d{2})\.l\d{2}$/.exec(id)?.[1] ?? `${code}.u01`;
      return { id, unit, kind: "lesson", title: { fr: "" }, goal: { fr: "" }, estimatedMinutes: 5, prerequisites: [], concepts: [], steps: [], review: { srsIntroduce: [] }, reviewed: false };
    }
    case "concept":
      return { id, type: "word", vi: "", gloss: { fr: "" }, audio: [], reviewed: false };
    case "culture":
      return { id, title: { fr: "" }, body: { fr: "" }, question: { prompt: { fr: "" }, options: [{ fr: "" }, { fr: "" }], answer: 0 }, reviewed: false };
    case "lexical-variants":
      return { version: 1, entries: [] };
    case "exam": {
      const level = id.toUpperCase().replace(/^.*\.EXAM\./, "");
      return {
        id: id.includes(".exam.") ? id : `${code}.exam.${id.toLowerCase()}`,
        level,
        certificate: { fr: level },
        requiresUnits: [],
        durationMinutes: 20,
        passThreshold: 0.7,
        retryAfterHours: 24,
        sections: (["listening", "reading", "vocabulary", "speaking"] as const).map((skill) => ({ skill, items: [] })),
        reviewed: false,
      };
    }
    case "curriculum":
      return { pack: code, blocks: [], units: [], paths: {} };
    case "pack":
      return { code };
  }
}
