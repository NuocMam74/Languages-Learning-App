import type { ChoiceOption, ContentIndex, ExamAnswer, ExamQuestion, Exercise, ExerciseResponse } from "@parlo/core";
import { useEffect, useRef, useState } from "react";
import { TranscriptsAllowed } from "../components/AudioButton.tsx";
import { ExerciseView } from "../components/exercises.tsx";
import { Button, Vi } from "../components/ui.tsx";
import { l, t, type MessageKey } from "../i18n/index.ts";

/**
 * Déroulé d'un examen (blanc ou certifiant) : une question à la fois, compte à
 * rebours, aucune correction affichée. À la fin du temps, les questions
 * restantes sont envoyées comme non répondues.
 */

interface Props {
  content: ContentIndex;
  questions: readonly ExamQuestion[];
  /** Échéance (ms epoch). */
  deadline: number;
  initialAnswers?: readonly ExamAnswer[];
  onAnswer?: (answers: ExamAnswer[]) => void;
  onFinish: (answers: ExamAnswer[]) => void;
  onQuit: () => void;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function ExamRunner({ content, questions, deadline, initialAnswers = [], onAnswer, onFinish, onQuit }: Props) {
  const [answers, setAnswers] = useState<ExamAnswer[]>(() => [...initialAnswers]);
  const [now, setNow] = useState(() => Date.now());
  const [confirmQuit, setConfirmQuit] = useState(false);
  const shownAt = useRef(Date.now());
  const finished = useRef(false);

  const index = questions.findIndex((q) => !answers.some((a) => a.section === q.section && a.index === q.index));
  const question = index >= 0 ? questions[index] : undefined;
  const remaining = deadline - now;

  const finish = (final: ExamAnswer[]) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(final);
  };

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (remaining <= 0 || !question) finish(answers);
  }, [remaining <= 0, question === undefined]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  if (!question) return null;

  const answer = (response: ExerciseResponse) => {
    const next = [...answers, { section: question.section, index: question.index, response, responseMs: Math.round(Date.now() - shownAt.current) }];
    setAnswers(next);
    onAnswer?.(next);
  };

  const low = remaining < 60_000;
  return (
    <div
      data-testid="exam"
      data-index={index}
      data-section={question.section}
      className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]"
    >
      <header className="flex items-center gap-4">
        <button type="button" onClick={() => setConfirmQuit(true)} aria-label={t("exams.run.quit")} className="grid size-11 place-items-center rounded-full text-phu-sa">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div
          className="h-3 flex-1 overflow-hidden rounded-full bg-phu-sa/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={index}
          aria-label={t("exams.run.progress", { i: index + 1, n: questions.length })}
        >
          <div className="h-full rounded-full bg-ngoc transition-[width] duration-500" style={{ width: `${(index / questions.length) * 100}%` }} />
        </div>
        <span role="timer" aria-label={t("exams.run.time")} className={`min-w-14 text-right font-semibold tabular-nums ${low ? "text-son-mai" : "text-phu-sa"}`}>
          {formatClock(remaining)}
        </span>
      </header>
      <p className="mt-3 text-sm font-medium text-ngoc">
        {t(`exams.skill.${question.section}` as MessageKey)} · {t("exams.run.progress", { i: index + 1, n: questions.length })}
      </p>

      {confirmQuit && (
        <div role="alertdialog" aria-labelledby="quit-title" className="mt-4 flex flex-col gap-3 border-l-4 border-son-mai pl-3">
          <p id="quit-title">{t("exams.run.quitConfirm")}</p>
          <div className="flex gap-4">
            <button type="button" className="min-h-11 rounded-xl bg-son-mai px-4 font-semibold text-white" onClick={onQuit}>{t("exams.run.quitYes")}</button>
            <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => setConfirmQuit(false)}>{t("exams.run.stay")}</button>
          </div>
        </div>
      )}

      <main className="flex flex-1 flex-col pt-6">
        <TranscriptsAllowed.Provider value={false}>
          <QuestionView key={`${question.section}:${question.index}`} question={question} content={content} onAnswer={answer} />
        </TranscriptsAllowed.Provider>
      </main>
    </div>
  );
}

function QuestionView({ question, content, onAnswer }: { question: ExamQuestion; content: ContentIndex; onAnswer: (r: ExerciseResponse) => void }) {
  const ex = question.exercise;
  if (question.silent && ex.type === "listen_pick_text") return <SilentPickView exercise={ex} onAnswer={onAnswer} />;
  // Lecture pure : aucune piste audio.
  const exercise: Exercise = question.silent && ex.type === "build_sentence" ? { ...ex, audio: null } : ex;
  return <ExerciseView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />;
}

/** listen_pick_text en lecture : le sens est donné, on choisit le mot écrit. */
function SilentPickView({ exercise, onAnswer }: { exercise: Extract<Exercise, { type: "listen_pick_image" | "listen_pick_text" }>; onAnswer: (r: ExerciseResponse) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-medium text-phu-sa">{t("exams.run.silentPickText")}</h2>
      <p className="py-8 text-center font-serif text-2xl">{t("exams.run.silentPick", { gloss: l(exercise.audio.gloss) })}</p>
      <div role="radiogroup" className="flex flex-1 flex-col gap-3">
        {exercise.options.map((option: ChoiceOption) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected === option.id}
            onClick={() => setSelected(option.id)}
            className={`flex min-h-16 items-center justify-center rounded-2xl border-2 px-4 py-3 ${selected === option.id ? "border-ngoc bg-ngoc-sang" : "border-phu-sa/15 bg-white/70"}`}
          >
            <Vi size="2xl">{option.text}</Vi>
          </button>
        ))}
      </div>
      <div className="sticky bottom-0 bg-nuoc pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <Button disabled={selected === null} onClick={() => selected && onAnswer({ kind: "choice", optionId: selected })}>
          {t("lesson.check")}
        </Button>
      </div>
    </div>
  );
}
