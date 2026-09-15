import {
  buildExercise,
  currentItem,
  evaluate,
  isFinished,
  lessonScore,
  recordResult,
  startLesson,
  type ContentIndex,
  type Evaluation,
  type Exercise,
  type ExerciseResponse,
  type Lesson,
  type LessonRun,
} from "@parlo/core";
import { Component, useMemo, useState, type ReactNode } from "react";
import { ExerciseView } from "../components/exercises.tsx";
import { l } from "../i18n/index.ts";
import { st } from "./i18n.ts";

/**
 * Aperçu en direct : l'étape passe par le vrai moteur (buildExercise → ExerciseView → evaluate)
 * avec le contenu du brouillon. Rien n'est enregistré dans la progression de l'apprenant.
 */

class PreviewBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: string | null; key: string }> {
  override state = { error: null as string | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: string | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  override render() {
    return this.state.error ? <p className="text-son-mai">{st("preview.impossible", { message: this.state.error })}</p> : this.props.children;
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[32rem] w-full max-w-[420px] flex-col rounded-3xl border-4 border-phu-sa/15 bg-nuoc px-4 pt-4" data-testid="step-preview">
      {children}
    </div>
  );
}

function Verdict({ evaluation }: { evaluation: Evaluation }) {
  return (
    <div role="status" className={`flex flex-col gap-1 rounded-2xl p-3 ${evaluation.correct ? "bg-ngoc-sang" : "bg-son-mai/10"}`}>
      <p className="font-semibold">
        {!evaluation.graded ? st("preview.ungraded") : evaluation.correct ? st("preview.correct") : evaluation.nearMiss ? st("preview.nearMiss") : st("preview.wrong")}
      </p>
      {!evaluation.correct && evaluation.expected && (
        <p>
          {st("preview.expected")} <span lang="vi" className="font-serif text-lg">{evaluation.expected}</span>
        </p>
      )}
      {evaluation.explain && <p className="text-sm">{l(evaluation.explain)}</p>}
    </div>
  );
}

function build(content: ContentIndex, lesson: Lesson, stepIndex: number, seed: string): { exercise: Exercise } | { error: string } {
  try {
    return { exercise: buildExercise(content, lesson, stepIndex, seed) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function StepPreview({ content, lesson, stepIndex }: { content: ContentIndex; lesson: Lesson; stepIndex: number }) {
  const [attempt, setAttempt] = useState(0);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const seed = `studio-${attempt}`;
  const built = useMemo(() => build(content, lesson, stepIndex, seed), [content, lesson, stepIndex, seed]);
  const resetKey = `${seed}:${JSON.stringify(lesson.steps[stepIndex] ?? null)}`;

  if ("error" in built) return <p className="text-son-mai">{st("preview.impossible", { message: built.error })}</p>;
  const { exercise } = built;
  const answer = (response: ExerciseResponse) => setEvaluation(evaluate(exercise, response));

  return (
    <div className="flex flex-col gap-3">
      <Frame>
        <PreviewBoundary resetKey={resetKey}>
          <ExerciseView key={resetKey} exercise={exercise} content={content} onAnswer={answer} locked={evaluation !== null} />
        </PreviewBoundary>
      </Frame>
      {evaluation && <Verdict evaluation={evaluation} />}
      <button
        type="button"
        className="min-h-11 self-start font-semibold text-ngoc"
        onClick={() => {
          setEvaluation(null);
          setAttempt((n) => n + 1);
        }}
      >
        {st("preview.again")}
      </button>
    </div>
  );
}

/** « Jouer la leçon » : déroulé complet (relance des erreurs comprise), sans enregistrement. */
export function LessonPlayer({ content, lesson, onClose }: { content: ContentIndex; lesson: Lesson; onClose: () => void }) {
  const [run, setRun] = useState<LessonRun>(() => startLesson(lesson, `studio-${Date.now()}`, new Date()));
  const [feedback, setFeedback] = useState<{ exercise: Exercise; evaluation: Evaluation } | null>(null);
  const item = currentItem(run);
  const built = useMemo(() => (item ? build(content, lesson, item.stepIndex, `${run.sessionId}:${item.attempt}`) : null), [content, lesson, item, run.sessionId]);

  if (isFinished(run)) {
    return (
      <div className="flex flex-col items-start gap-4" data-testid="lesson-player-done">
        <h2 className="font-serif text-2xl">{st("player.done")}</h2>
        <p>{st("player.score", { n: Math.round(lessonScore(run) * 100) })}</p>
        <div className="flex gap-4">
          <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => setRun(startLesson(lesson, `studio-${Date.now()}`, new Date()))}>
            {st("player.restart")}
          </button>
          <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={onClose}>{st("player.close")}</button>
        </div>
      </div>
    );
  }

  const next = () => {
    if (!feedback) return;
    setRun(recordResult(run, feedback.exercise, feedback.evaluation, 0));
    setFeedback(null);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="lesson-player">
      <p className="text-sm text-phu-sa">{st("player.progress", { n: run.cursor + 1, total: run.queue.length })}</p>
      {built && "error" in built ? (
        <>
          <p className="text-son-mai">{st("preview.impossible", { message: built.error })}</p>
          <button type="button" className="min-h-11 self-start font-semibold text-ngoc" onClick={() => setRun({ ...run, cursor: run.cursor + 1 })}>{st("player.skip")}</button>
        </>
      ) : built ? (
        <>
          <Frame>
            <PreviewBoundary resetKey={`${run.cursor}`}>
              <ExerciseView
                key={run.cursor}
                exercise={built.exercise}
                content={content}
                locked={feedback !== null}
                onAnswer={(response) => setFeedback({ exercise: built.exercise, evaluation: evaluate(built.exercise, response) })}
              />
            </PreviewBoundary>
          </Frame>
          {feedback && (
            <>
              <Verdict evaluation={feedback.evaluation} />
              <button type="button" className="min-h-14 rounded-2xl bg-ngoc px-6 text-lg font-semibold text-nuoc" onClick={next}>{st("player.next")}</button>
            </>
          )}
        </>
      ) : null}
      <button type="button" className="min-h-11 self-start text-ngoc" onClick={onClose}>{st("player.close")}</button>
    </div>
  );
}
