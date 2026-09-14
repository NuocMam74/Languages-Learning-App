import { BADGE_CODES, nextLesson, sessionItemsDone, sessionItemsRemaining, type ContentIndex, type SessionPhase } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccount } from "../account.ts";
import { BadgeIcon } from "../components/BadgeIcon.tsx";
import { ExerciseView } from "../components/exercises.tsx";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { getPlacement, getProfile, completedLessons } from "../learner.ts";
import { lessonsBefore } from "@parlo/core";
import { useSession } from "../session-store.ts";
import { askWhy, type WhyAnswer } from "../tutor.ts";

/** Durée d'affichage d'une bonne réponse avant d'enchaîner (pas d'écran intermédiaire). */
const CORRECT_PAUSE_MS = 700;

const PHASE_LABEL: Partial<Record<SessionPhase["kind"], MessageKey>> = {
  warmup: "session.block.warmup",
  review: "session.block.review",
  new: "session.block.new",
  practice: "session.block.practice",
};

/** Séance du jour (/seance), révision seule (/revision) ou leçon choisie sur la carte (/lecon/:id). */
export function SessionPage({ content, mode }: { content: ContentIndex; mode: "daily" | "review" | "lesson" }) {
  const { lessonId = "" } = useParams();
  const navigate = useNavigate();
  const { status, run, phase, exercise, feedback, recap, error, open, answer, next } = useSession();

  useEffect(() => {
    void open(content, mode === "lesson" ? { source: "lesson", lessonId } : { source: mode });
  }, [content, mode, lessonId, open]);

  useEffect(() => {
    if (status === "feedback" && feedback?.correct) {
      const id = setTimeout(() => void next(), CORRECT_PAUSE_MS);
      return () => clearTimeout(id);
    }
  }, [status, feedback, next]);

  if (status === "error") return <Screen><p className="text-son-mai">{error}</p></Screen>;
  if (status === "done" && recap) return <Recap content={content} onDone={() => navigate("/")} />;
  if (!run || !exercise || !phase) return <Screen><div /></Screen>;

  const done = sessionItemsDone(run);
  const total = Math.max(1, done + sessionItemsRemaining(run));
  const lesson = run.lesson ? content.lessons.get(run.lesson.lessonId) : undefined;
  const nudgeConcept = run.lesson?.tutorNudge ? content.concepts.get(run.lesson.tutorNudge) : undefined;
  const label = run.source !== "lesson" ? PHASE_LABEL[phase.kind] : undefined;
  const lessonStart = (phase.kind === "new" || phase.kind === "practice") && phase.lesson.cursor === 0;

  return (
    <div
      data-testid="lesson"
      data-status={status}
      data-cursor={done}
      data-phase={phase.kind}
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
      {label && <p className="mt-3 text-sm font-medium text-ngoc">{t(label)}</p>}
      {lesson && lessonStart && <p className="mt-1 text-sm text-phu-sa">{l(lesson.goal)}</p>}

      {nudgeConcept && status === "answering" && (
        <aside className="mt-4 rounded-2xl bg-nghe/15 px-4 py-3 text-sm">{t("lesson.tutorNudge", { word: nudgeConcept.vi })}</aside>
      )}

      <main className="flex flex-1 flex-col pt-6">
        <ExerciseView key={`${phase.kind}:${done}`} exercise={exercise} content={content} onAnswer={(r) => void answer(r)} locked={status !== "answering"} />
      </main>

      {status === "feedback" && feedback && <Feedback />}
    </div>
  );
}

function Feedback() {
  const { feedback, exercise, run, phase, given, next } = useSession();
  const [why, setWhy] = useState<WhyAnswer | "loading" | null>(null);
  if (!feedback || !exercise || !run || !phase) return null;

  const expectedOption = "options" in exercise && "answerId" in exercise ? exercise.options.find((o) => o.id === exercise.answerId) : undefined;
  const expected = expectedOption?.label ? l(expectedOption.label) : feedback.expected;
  const isReview = phase.kind === "warmup" || phase.kind === "review";

  const ask = async () => {
    setWhy("loading");
    const lessonItem = run.lesson?.queue[run.lesson.cursor - 1];
    setWhy(
      await askWhy({
        lessonId: isReview ? null : (run.lesson?.lessonId ?? null),
        stepIndex: isReview ? exercise.stepIndex : (lessonItem?.stepIndex ?? exercise.stepIndex),
        given,
        expected: feedback.expected,
      }),
    );
  };

  return (
    <div
      role="status"
      className={`fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[720px] rounded-t-3xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] ${
        feedback.correct ? "bg-ngoc text-nuoc" : "bg-white text-muc shadow-[0_-8px_30px_rgb(20_32_30/0.12)]"
      }`}
    >
      {feedback.correct ? (
        <p className="text-2xl font-semibold motion-safe:animate-[rise_300ms_ease-out]">{t("lesson.correct")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-lg font-semibold text-son-mai">
            {feedback.nearMiss ? t("lesson.nearMiss", { expected }) : t("lesson.wrong")}
          </p>
          {!feedback.nearMiss && expected && (
            <p className="flex flex-wrap items-baseline gap-2">
              <span>{t("lesson.answerLabel")}</span>
              {expectedOption?.label ? <span className="text-lg font-semibold">{expected}</span> : <Vi size="2xl">{expected}</Vi>}
            </p>
          )}
          {feedback.explain && <p>{l(feedback.explain)}</p>}

          {why === null && (
            <button type="button" onClick={() => void ask()} className="min-h-11 self-start text-left font-semibold text-ngoc underline-offset-4 hover:underline">
              {t("tutor.why")}
            </button>
          )}
          {why === "loading" && <p className="min-h-11 text-sm text-phu-sa">{t("tutor.thinking")}</p>}
          {why !== null && why !== "loading" && (
            <p className="border-l-4 border-nghe pl-3 text-sm" aria-live="polite">
              <span className="font-semibold">{t("tutor.name")} : </span>
              {why.kind === "tutor" ? why.text : t(feedback.explain ? "tutor.why.offline" : "tutor.why.offlineNoExplain")}
            </p>
          )}

          <p className="text-sm text-phu-sa">{t(isReview ? "session.retryLater" : "lesson.retryLater")}</p>
          <Button onClick={() => void next()}>{t("lesson.continue")}</Button>
        </div>
      )}
    </div>
  );
}

function Recap({ content, onDone }: { content: ContentIndex; onDone: () => void }) {
  const recap = useSession((s) => s.recap);
  const account = useAccount((s) => s.status);
  const [nextTitle, setNextTitle] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getProfile(), completedLessons(), getPlacement()]).then(([profile, completed, placement]) => {
      const unlocked = new Set([...completed, ...(placement ? lessonsBefore(content.curriculum, placement.entryLessonId) : [])]);
      const upcoming = nextLesson(content.curriculum, content.lessons, unlocked, profile.motivation);
      setNextTitle(upcoming ? l(upcoming.title) : null);
    });
  }, [content]);

  if (!recap) return null;
  const concepts = (ids: readonly string[]) => ids.flatMap((id) => content.concepts.get(id) ?? []);
  const learned = concepts(recap.learned);
  const reviewed = concepts(recap.reviewed);
  const title: MessageKey = recap.source === "lesson" ? "recap.title" : recap.source === "review" ? "session.recap.reviewTitle" : "session.recap.title";
  const offerAccount = recap.firstLesson && account === "guest";
  const badges = BADGE_CODES.filter((code) => recap.badges.includes(code));

  return (
    <Screen action={<Button onClick={onDone}>{t("recap.next")}</Button>}>
      <div className="flex flex-1 flex-col gap-8 pt-8">
        <h1 className="font-serif text-2xl">{t(title)}</h1>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="text-vi font-semibold text-ngoc motion-safe:animate-[rise_600ms_ease-out]">{t("recap.xp", { n: recap.xp })}</span>
          <span className="text-lg text-phu-sa">{t("recap.streak", { n: recap.streak.current })}</span>
        </div>

        {learned.length > 0 && (
          <section>
            <h2 className="mb-3 text-phu-sa">{t("session.recap.canSay")}</h2>
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

        {reviewed.length > 0 && (
          <section>
            <h2 className="mb-2 text-phu-sa">{t("session.recap.reviewed", { n: reviewed.length })}</h2>
            <p lang="vi" className="font-serif text-lg">{reviewed.map((c) => c.vi).join(" · ")}</p>
          </section>
        )}

        {badges.length > 0 && (
          <section aria-live="polite">
            <h2 className="mb-3 text-phu-sa">{t("badges.recap.earned")}</h2>
            <ul className="flex flex-col gap-3">
              {badges.map((code) => (
                <li key={code} className="flex items-center gap-4">
                  <BadgeIcon code={code} earned size={56} />
                  <div>
                    <p className="font-semibold">{t(`badges.${code}.name` as MessageKey)}</p>
                    <p className="text-sm text-phu-sa">{t(`badges.${code}.desc` as MessageKey)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {nextTitle && (
          <p className="text-phu-sa">
            {t("session.recap.nextStep")} <span className="font-medium text-muc">{nextTitle}</span>
          </p>
        )}

        {offerAccount && (
          <section className="flex flex-col gap-3 border-l-4 border-nghe py-1 pl-4">
            <p className="font-semibold">{t("account.offer.title")}</p>
            <p className="text-sm text-phu-sa">{t("account.offer.body")}</p>
            <Link to="/compte" className="grid min-h-12 place-items-center rounded-2xl border-2 border-ngoc px-5 font-semibold text-ngoc">
              {t("account.offer.cta")}
            </Link>
            <p className="text-sm text-phu-sa">{t("account.offer.guestWarning")}</p>
          </section>
        )}
      </div>
    </Screen>
  );
}
