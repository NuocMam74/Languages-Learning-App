import { remainingSteps, type ContentIndex } from "@parlo/core";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { ExerciseView } from "../components/exercises.tsx";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { useLesson } from "../lesson-store.ts";

/** Durée d'affichage d'une bonne réponse avant d'enchaîner (pas d'écran intermédiaire). */
const CORRECT_PAUSE_MS = 700;

export function LessonPage({ content }: { content: ContentIndex }) {
  const { lessonId = "" } = useParams();
  const navigate = useNavigate();
  const { status, run, exercise, feedback, recap, error, open, answer, next } = useLesson();

  useEffect(() => {
    void open(content, lessonId);
  }, [content, lessonId, open]);

  useEffect(() => {
    if (status === "feedback" && feedback?.correct) {
      const id = setTimeout(() => void next(), CORRECT_PAUSE_MS);
      return () => clearTimeout(id);
    }
  }, [status, feedback, next]);

  if (status === "error") return <Screen><p className="text-son-mai">{error}</p></Screen>;
  if (status === "done" && recap) return <Recap content={content} onDone={() => navigate("/")} />;
  if (!run || !exercise) return <Screen><div /></Screen>;

  const done = run.cursor;
  const total = done + remainingSteps(run);
  const lesson = content.lessons.get(run.lessonId);
  const nudgeConcept = run.tutorNudge ? content.concepts.get(run.tutorNudge) : undefined;

  return (
    <div
      data-testid="lesson"
      data-status={status}
      data-cursor={run.cursor}
      className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]"
    >
      <header className="flex items-center gap-4">
        <button type="button" onClick={() => navigate("/")} aria-label={t("lesson.quit")} className="grid size-11 place-items-center rounded-full text-phu-sa">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div
          className="h-3 flex-1 overflow-hidden rounded-full bg-phu-sa/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={t("lesson.progress", { i: done + 1, n: total })}
        >
          <div className="h-full rounded-full bg-ngoc transition-[width] duration-500" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </header>
      {lesson && done === 0 && <p className="mt-3 text-sm text-phu-sa">{l(lesson.goal)}</p>}

      {nudgeConcept && status === "answering" && (
        <aside className="mt-4 rounded-2xl bg-nghe/15 px-4 py-3 text-sm">{t("lesson.tutorNudge", { word: nudgeConcept.vi })}</aside>
      )}

      <main className="flex flex-1 flex-col pt-6">
        <ExerciseView key={`${run.cursor}`} exercise={exercise} content={content} onAnswer={(r) => void answer(r)} locked={status !== "answering"} />
      </main>

      {status === "feedback" && feedback && (
        <div
          role="status"
          className={`fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[720px] rounded-t-3xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] ${
            feedback.correct ? "bg-ngoc text-nuoc" : "bg-white text-muc shadow-[0_-8px_30px_rgb(20_32_30/0.12)]"
          }`}
        >
          {feedback.correct ? (
            <p className="text-2xl font-semibold">{t("lesson.correct")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-lg font-semibold text-son-mai">
                {feedback.nearMiss ? t("lesson.nearMiss", { expected: feedback.expected }) : t("lesson.wrong")}
              </p>
              {!feedback.nearMiss && feedback.expected && (
                <p className="flex items-baseline gap-2">
                  <span>{t("lesson.answerLabel")}</span>
                  <Vi size="2xl">{feedback.expected}</Vi>
                </p>
              )}
              {feedback.explain && <p>{l(feedback.explain)}</p>}
              <p className="text-sm text-phu-sa">{t("lesson.retryLater")}</p>
              <Button onClick={() => void next()}>{t("lesson.continue")}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Recap({ content, onDone }: { content: ContentIndex; onDone: () => void }) {
  const recap = useLesson((s) => s.recap);
  if (!recap) return null;
  const learned = recap.learned.flatMap((id) => {
    const c = content.concepts.get(id);
    return c ? [c] : [];
  });

  return (
    <Screen action={<Button onClick={onDone}>{t("recap.next")}</Button>}>
      <div className="flex flex-1 flex-col gap-8 pt-8">
        <h1 className="font-serif text-2xl">{t("recap.title")}</h1>
        <div className="flex items-baseline gap-6">
          <span className="text-vi font-semibold text-ngoc motion-safe:animate-[rise_600ms_ease-out]">{t("recap.xp", { n: recap.xp })}</span>
          <span className="text-lg text-phu-sa">{t("recap.streak", { n: recap.streak.current })}</span>
        </div>
        {learned.length > 0 && (
          <section>
            <h2 className="mb-3 text-phu-sa">{t("recap.canSay")}</h2>
            <ul className="flex flex-col gap-3">
              {learned.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-4 border-b border-phu-sa/10 pb-2">
                  <Vi size="2xl">{c.vi}</Vi>
                  <span className="text-right text-phu-sa">{l(c.gloss)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Screen>
  );
}
