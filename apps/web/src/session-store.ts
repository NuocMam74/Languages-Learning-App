import {
  buildExercise,
  currentItem,
  evaluate,
  reviewSeed,
  sessionPhase,
  buildReviewExercise,
  type ContentIndex,
  type Evaluation,
  type Exercise,
  type ExerciseResponse,
  type SessionPhase,
  type SessionRun,
} from "@parlo/core";
import { create } from "zustand";
import { ttsAllowed } from "./audio.ts";
import { l, toneLabel } from "./i18n/index.ts";
import { finishSession, openSession, saveLessonPart, submitSessionAnswer, type SessionRecap, type SessionRequest } from "./learner.ts";

/**
 * État de la séance en cours (éphémère, en mémoire). La source de vérité
 * durable est le snapshot IndexedDB écrit à chaque réponse.
 */

type Status = "idle" | "loading" | "answering" | "feedback" | "done" | "error";

interface SessionState {
  status: Status;
  content: ContentIndex | null;
  run: SessionRun | null;
  phase: SessionPhase | null;
  exercise: Exercise | null;
  shownAt: number;
  feedback: Evaluation | null;
  /** Réponse donnée, en texte (pour « Cô Mai, pourquoi ? »). */
  given: string;
  recap: SessionRecap | null;
  error: string | null;
  open: (content: ContentIndex, request: SessionRequest) => Promise<void>;
  answer: (response: ExerciseResponse) => Promise<void>;
  next: () => Promise<void>;
  reset: () => void;
}

export function exerciseFor(content: ContentIndex, run: SessionRun, phase: SessionPhase): Exercise | null {
  switch (phase.kind) {
    case "warmup":
    case "review":
      // Réveil : format le plus simple, pour commencer par gagner.
      return buildReviewExercise(content, phase.item.conceptId, reviewSeed(run, phase.index), phase.kind === "warmup" ? "listen_pick_text" : undefined, {
        known: run.knownAtStart,
        stepIndex: phase.index,
        allowTtsTone: ttsAllowed(true),
      });
    case "new":
    case "practice": {
      const item = currentItem(phase.lesson);
      const lesson = content.lessons.get(phase.lesson.lessonId);
      return item && lesson ? buildExercise(content, lesson, item.stepIndex, run.sessionId) : null;
    }
    default:
      return null;
  }
}

export function givenText(exercise: Exercise, response: ExerciseResponse): string {
  if (response.kind === "choice" && "options" in exercise) {
    const option = exercise.options.find((o) => o.id === response.optionId);
    return option?.text ?? (option?.label ? l(option.label) : option?.tones ? toneLabel(option.tones) : "");
  }
  if (response.kind === "tokens" && exercise.type === "build_sentence") {
    const byId = new Map(exercise.tokens.map((t) => [t.id, t.text ?? ""]));
    return response.optionIds.map((id) => byId.get(id) ?? "").join(" ");
  }
  return "";
}

export const useSession = create<SessionState>((set, get) => {
  /** Avance jusqu'au prochain exercice jouable, en enregistrant leçon et bilan au passage. */
  async function advance(content: ContentIndex, start: SessionRun): Promise<void> {
    let run = start;
    for (;;) {
      const phase = sessionPhase(run, content);
      if (phase.kind === "save_lesson") {
        run = await saveLessonPart(content, run);
        continue;
      }
      if (phase.kind === "recap") {
        set({ status: "loading", run });
        set({ recap: await finishSession(content, run), status: "done", feedback: null, exercise: null, phase });
        return;
      }
      set({ run, phase, exercise: exerciseFor(content, run, phase), feedback: null, given: "", shownAt: performance.now(), status: "answering" });
      return;
    }
  }

  return {
    status: "idle",
    content: null,
    run: null,
    phase: null,
    exercise: null,
    shownAt: 0,
    feedback: null,
    given: "",
    recap: null,
    error: null,

    async open(content, request) {
      set({ status: "loading", content, run: null, exercise: null, recap: null, feedback: null, error: null });
      try {
        await advance(content, await openSession(content, request));
      } catch (e) {
        set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },

    async answer(response) {
      const { content, run, exercise, shownAt, status } = get();
      if (!content || !run || !exercise || status !== "answering") return;
      const evaluation = evaluate(exercise, response);
      const next = await submitSessionAnswer(content, run, exercise, evaluation, performance.now() - shownAt);
      // Réussite : on enchaîne sans écran intermédiaire (spec §4.5). Non noté : idem.
      if (!evaluation.graded) {
        await advance(content, next);
        return;
      }
      set({ run: next, feedback: evaluation, given: givenText(exercise, response), status: "feedback" });
    },

    async next() {
      const { content, run } = get();
      if (!content || !run) return;
      await advance(content, run);
    },

    reset() {
      set({ status: "idle", run: null, phase: null, exercise: null, feedback: null, recap: null, error: null });
    },
  };
});
