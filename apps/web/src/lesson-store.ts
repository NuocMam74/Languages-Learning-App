import {
  buildExercise,
  currentItem,
  evaluate,
  isFinished,
  type ContentIndex,
  type Evaluation,
  type Exercise,
  type ExerciseResponse,
  type LessonRun,
} from "@parlo/core";
import { create } from "zustand";
import { finishLesson, openLesson, submitAnswer, type LessonRecap } from "./learner.ts";

/**
 * État de la leçon en cours (éphémère, en mémoire). La source de vérité
 * durable est le snapshot IndexedDB écrit à chaque réponse.
 */

type Status = "idle" | "loading" | "answering" | "feedback" | "done" | "error";

interface LessonState {
  status: Status;
  content: ContentIndex | null;
  run: LessonRun | null;
  exercise: Exercise | null;
  shownAt: number;
  feedback: Evaluation | null;
  recap: LessonRecap | null;
  error: string | null;
  open: (content: ContentIndex, lessonId: string) => Promise<void>;
  answer: (response: ExerciseResponse) => Promise<void>;
  next: () => Promise<void>;
  reset: () => void;
}

function exerciseFor(content: ContentIndex, run: LessonRun): Exercise | null {
  const item = currentItem(run);
  const lesson = content.lessons.get(run.lessonId);
  return item && lesson ? buildExercise(content, lesson, item.stepIndex, run.sessionId) : null;
}

export const useLesson = create<LessonState>((set, get) => ({
  status: "idle",
  content: null,
  run: null,
  exercise: null,
  shownAt: 0,
  feedback: null,
  recap: null,
  error: null,

  async open(content, lessonId) {
    set({ status: "loading", content, recap: null, feedback: null, error: null });
    try {
      const run = await openLesson(content, lessonId);
      if (isFinished(run)) {
        set({ run, recap: await finishLesson(content, run), status: "done" });
        return;
      }
      set({ run, exercise: exerciseFor(content, run), shownAt: performance.now(), status: "answering" });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  async answer(response) {
    const { content, run, exercise, shownAt, status } = get();
    if (!content || !run || !exercise || status !== "answering") return;
    const evaluation = evaluate(exercise, response);
    const next = await submitAnswer(content.pack.code, run, exercise, evaluation, performance.now() - shownAt);
    // Réussite : on enchaîne sans écran intermédiaire (spec §4.5). Non noté : idem.
    if (!evaluation.graded || evaluation.correct) {
      set({ run: next, feedback: evaluation.graded ? evaluation : null });
      if (!evaluation.graded) await get().next();
      else set({ status: "feedback" });
      return;
    }
    set({ run: next, feedback: evaluation, status: "feedback" });
  },

  async next() {
    const { content, run } = get();
    if (!content || !run) return;
    if (isFinished(run)) {
      set({ status: "loading" });
      set({ recap: await finishLesson(content, run), status: "done", feedback: null, exercise: null });
      return;
    }
    set({ exercise: exerciseFor(content, run), feedback: null, shownAt: performance.now(), status: "answering" });
  },

  reset() {
    set({ status: "idle", run: null, exercise: null, feedback: null, recap: null, error: null });
  },
}));
