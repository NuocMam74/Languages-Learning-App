import type { ChoiceOption, ContentIndex, ExamAnswer, ExamQuestion, Exercise, ExerciseResponse } from "@parlo/core";
import { useEffect, useRef, useState } from "react";
import { TranscriptsAllowed } from "../components/AudioButton.tsx";
import { ExerciseView } from "../components/exercises.tsx";
import { Button, Vi } from "../components/ui.tsx";
import { Card, Chip, IconButton, ProgressBar } from "../design/index.ts";
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
      className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] md:max-w-[720px]"
    >
      <header className="flex items-center gap-3">
        <IconButton icon="close" label={t("exams.run.quit")} onClick={() => setConfirmQuit(true)} className="-ml-2" />
        <ProgressBar
          className="flex-1"
          value={index}
          max={questions.length}
          label={t("exams.run.progress", { i: index + 1, n: questions.length })}
        />
        {/* Le temps ne clignote pas : il change simplement de ton sous la dernière minute. */}
        <span
          role="timer"
          aria-label={t("exams.run.time")}
          className={`min-w-14 rounded-chip px-2 py-1 text-right font-semibold tabular-nums ${low ? "bg-surface-son-mai text-son-mai" : "text-phu-sa"}`}
        >
          {formatClock(remaining)}
        </span>
      </header>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Chip tone="ngoc">{t(`exams.skill.${question.section}` as MessageKey)}</Chip>
        <span className="text-sm text-phu-sa">{t("exams.run.progress", { i: index + 1, n: questions.length })}</span>
      </div>

      {confirmQuit && (
        <Card tone="alert" className="mt-4">
          <div role="alertdialog" aria-labelledby="quit-title" className="flex flex-col gap-3">
            <p id="quit-title">{t("exams.run.quitConfirm")}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="min-h-11 rounded-chip bg-son-mai px-4 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98]" onClick={onQuit}>
                {t("exams.run.quitYes")}
              </button>
              <button type="button" className="min-h-11 rounded-chip px-4 font-semibold text-ngoc transition-colors hover:bg-phu-sa/5" onClick={() => setConfirmQuit(false)}>
                {t("exams.run.stay")}
              </button>
            </div>
          </div>
        </Card>
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
            className={`flex min-h-16 items-center justify-center rounded-card border-2 px-4 py-3 transition-[background-color,border-color,transform] motion-safe:active:scale-[.98] ${selected === option.id ? "border-ngoc bg-ngoc-sang" : "border-line-strong bg-surface"}`}
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
