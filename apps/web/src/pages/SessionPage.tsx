import { BADGE_CODES, levelForXp, nextLesson, sessionItemsDone, sessionItemsRemaining, TONAL_STEP_TYPES, UNIT_TEST_PASS_SCORE, type ContentIndex, type Exercise, type SessionPhase } from "@parlo/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useAccount } from "../account.ts";
import { playConcept, ttsAllowed } from "../audio.ts";
import { BadgeIcon } from "../components/BadgeIcon.tsx";
import { ExerciseView } from "../components/exercises.tsx";
import { levelLabel, LevelLine } from "../components/LevelLine.tsx";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { Card, CountUp, EmptyState, Icon, IconButton, ProgressBar, ProgressRing, SectionTitle, Sheet, staggerStyle } from "../design/index.ts";
import { playCorrectSound } from "../feedback-sound.ts";
import { l, t, toneLabel, type MessageKey } from "../i18n/index.ts";
import { getProfile, progressState } from "../learner.ts";
import { LessonNoteBlock } from "../notes/NoteBlock.tsx";
import { usePrefs } from "../prefs.ts";
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

/**
 * Séance du jour (/seance), révision seule (/revision), leçon choisie sur la carte (/lecon/:id),
 * ou leçon rejouée en entraînement depuis « Réviser » (/lecon/:id/entrainement, contrat phase8 §2 :
 * mêmes exercices, le SRS reçoit les réponses, mais ni XP ni progression recomptées).
 */
export function SessionPage({ content, mode }: { content: ContentIndex; mode: "daily" | "review" | "lesson" | "practice" }) {
  const { lessonId = "" } = useParams();
  const practice = mode === "practice";
  const navigate = useNavigate();
  const { status, run, phase, exercise, feedback, recap, error, open, answer, next, remedial } = useSession();
  const [attempt, setAttempt] = useState(0);
  // Hauteur de la feuille de correction : le contenu est rembourré d'autant pour rester lisible dessous.
  const [sheetHeight, setSheetHeight] = useState(0);
  const onSheetHeight = useCallback((h: number) => setSheetHeight(Math.round(h)), []);
  // Option choisie : l'exercice est remonté après la réponse (sélection perdue), la feuille la resurligne.
  const [chosenId, setChosenId] = useState<string | null>(null);

  useEffect(() => {
    void open(content, mode === "lesson" || mode === "practice" ? { source: "lesson", lessonId, ...(mode === "practice" ? { practice: true } : {}) } : { source: mode });
  }, [content, mode, lessonId, open, attempt]);

  useEffect(() => {
    if (status === "feedback" && feedback?.correct) {
      playCorrectSound();
      const id = setTimeout(() => void next(), CORRECT_PAUSE_MS);
      return () => clearTimeout(id);
    }
  }, [status, feedback, next]);

  // Entraînement : on revient dans la bibliothèque, pas sur le parcours.
  const backTo = practice ? "/reviser/lecons" : "/apprendre";

  if (status === "error") {
    return (
      <Screen action={<Button onClick={() => setAttempt((n) => n + 1)}>{t("error.retry")}</Button>}>
        <Card tone="alert" className="my-auto flex items-start gap-3">
          <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-son-mai" />
          <p className="text-son-mai">{error}</p>
        </Card>
      </Screen>
    );
  }
  if (status === "locked") return <Navigate to="/apprendre" replace state={{ notice: "locked" }} />;
  if (status === "empty") {
    const review = mode === "review";
    return (
      <Screen action={<Button onClick={() => navigate("/apprendre", { replace: true })}>{t("recap.next")}</Button>}>
        <div className="flex flex-1 flex-col justify-center" data-testid="session-empty">
          <EmptyState
            art="boat"
            title={t(review ? "journey.empty.title" : "journey.empty.dailyTitle")}
            body={t(review ? "journey.empty.body" : "journey.empty.dailyBody")}
          />
        </div>
      </Screen>
    );
  }
  if (status === "done" && recap) return <Recap content={content} onDone={() => navigate(backTo)} onRetry={() => setAttempt((n) => n + 1)} />;
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
      data-correct={status === "feedback" && feedback ? String(feedback.correct) : undefined}
      className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] md:max-w-[720px]"
      style={status === "feedback" && feedback && !feedback.correct && sheetHeight > 0 ? { paddingBottom: sheetHeight } : undefined}
    >
      <header className="flex items-center gap-4">
        <IconButton icon="close" label={t("lesson.quit")} onClick={() => navigate(backTo)} className="-ml-2" />
        {/* La barre de séance se remplit seule : c'est le seul mouvement pendant qu'on répond. */}
        <ProgressBar value={done} max={total} label={t("lesson.progress", { i: done + 1, n: total })} className="h-3 flex-1" />
      </header>
      {practice && (
        <p className="mt-3 flex items-center gap-2 rounded-chip bg-surface-nghe px-3 py-1.5 text-sm" data-testid="practice-banner">
          <Icon name="refresh" size={15} />
          {t("review.practice.banner")}
        </p>
      )}
      {label && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-ngoc">
          <span className="h-4 w-1 rounded-full bg-ngoc" aria-hidden />
          {t(label)}
        </p>
      )}
      {lesson && lessonStart && <p className="mt-1 text-sm text-phu-sa">{l(lesson.goal)}</p>}

      {nudgeConcept && status === "answering" && (
        <Card tone="notice" as="aside" className="mt-4 flex items-start gap-2.5 py-3 text-sm" data-testid="tutor-nudge">
          <Icon name="tutor" size={18} className="mt-0.5 shrink-0 text-nghe" />
          <span>
            {t("lesson.tutorNudge", { word: nudgeConcept.vi })}
            {remedial && <span className="mt-1 block font-semibold">{t("journey.easier")}</span>}
          </span>
        </Card>
      )}

      <main className="flex flex-1 flex-col pt-6">
        <ExerciseView key={`${phase.kind}:${done}:${remedial ?? ""}`} exercise={exercise} content={content} onAnswer={(r) => {
          setChosenId(r.kind === "choice" ? r.optionId : null);
          void answer(r);
        }} locked={status !== "answering"} />
      </main>

      {status === "feedback" && feedback && <Feedback content={content} onHeight={onSheetHeight} chosenId={chosenId} />}
    </div>
  );
}

/** Audio de l'exercice (réécoute après une erreur, spec §4.5). */
function exerciseAudio(exercise: Exercise) {
  switch (exercise.type) {
    case "listen_pick_image":
    case "listen_pick_text":
    case "tone_identify":
      return exercise.audio;
    case "tone_minimal_pair":
    case "build_sentence":
      return exercise.audio;
    default:
      return null;
  }
}

/** Échappe un identifiant d'option pour un sélecteur d'attribut (CSS.escape absent de jsdom). */
const cssId = (id: string) => (typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&"));

/**
 * Après une erreur : fait défiler pour que l'option choisie et la bonne réponse restent visibles
 * au-dessus de la feuille (priorité à la bonne réponse si les deux ne tiennent pas).
 */
function revealAnswers(sheet: HTMLElement, expectedId: string | undefined, chosenId: string | null) {
  const main = document.querySelector('[data-testid="lesson"] main');
  if (!main) return;
  const chosen = chosenId ? main.querySelector<HTMLElement>(`[data-option-id="${cssId(chosenId)}"]`) : null;
  const expected = expectedId ? main.querySelector<HTMLElement>(`[data-option-id="${cssId(expectedId)}"]`) : null;
  const targets = [chosen, expected].filter((el): el is HTMLElement => el !== null);
  if (targets.length === 0) return;
  const rects = targets.map((el) => el.getBoundingClientRect());
  const visibleTop = 12;
  const visibleBottom = sheet.getBoundingClientRect().top - 12;
  let top = Math.min(...rects.map((r) => r.top));
  let bottom = Math.max(...rects.map((r) => r.bottom));
  if (bottom - top > visibleBottom - visibleTop && expected) {
    const r = expected.getBoundingClientRect();
    top = r.top;
    bottom = r.bottom;
  }
  let delta = 0;
  if (bottom > visibleBottom) delta = bottom - visibleBottom;
  if (top - delta < visibleTop) delta = top - visibleTop;
  if (Math.abs(delta) < 2) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
}

function Feedback({ content, onHeight, chosenId }: { content: ContentIndex; onHeight: (height: number) => void; chosenId: string | null }) {
  const { feedback, exercise, run, phase, given, next, remedial } = useSession();
  const silent = usePrefs((s) => s.silent);
  const [why, setWhy] = useState<WhyAnswer | "loading" | null>(null);
  const replayed = useRef(false);
  const sheet = useRef<HTMLDivElement>(null);
  const expectedId = exercise && "options" in exercise && "answerId" in exercise ? exercise.answerId : undefined;
  // Lus par l'observateur de taille : la feuille grandit (« Cô Mai, pourquoi ? ») → on refait de la place.
  const reveal = useRef<{ wrong: boolean; expectedId: string | undefined; chosenId: string | null; height: number }>({ wrong: false, expectedId: undefined, chosenId: null, height: 0 });
  reveal.current.wrong = feedback !== null && !feedback.correct;
  reveal.current.expectedId = expectedId;
  reveal.current.chosenId = chosenId;

  // La page réserve la hauteur de la feuille (padding) : rien n'est caché sans pouvoir défiler.
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const report = () => {
      const height = el.getBoundingClientRect().height;
      onHeight(height);
      const grew = reveal.current.height > 0 && height > reveal.current.height + 8;
      reveal.current.height = height;
      if (grew && reveal.current.wrong) requestAnimationFrame(() => revealAnswers(el, reveal.current.expectedId, reveal.current.chosenId));
    };
    report();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      onHeight(0);
    };
  }, [onHeight]);

  useEffect(() => {
    if (!feedback || feedback.correct) return;
    // Deux images : le padding de la page est appliqué avant de mesurer.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (sheet.current) revealAnswers(sheet.current, expectedId, chosenId);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [feedback, expectedId, chosenId]);

  // Erreur : la bonne réponse se fait réentendre (sauf mode silencieux).
  useEffect(() => {
    if (!feedback || feedback.correct || !exercise || silent || replayed.current) return;
    replayed.current = true;
    const audio = exerciseAudio(exercise);
    if (audio) void playConcept(content, audio, { allowTts: ttsAllowed(TONAL_STEP_TYPES.has(exercise.type as never)) });
  }, [feedback, exercise, silent, content]);

  if (!feedback || !exercise || !run || !phase) return null;

  const expectedOption = "options" in exercise && "answerId" in exercise ? exercise.options.find((o) => o.id === exercise.answerId) : undefined;
  // Options de ton : libellé lisible (« sắc — monte »), jamais le code interne (« sac »).
  const optionLabel = expectedOption?.label ? l(expectedOption.label) : expectedOption?.tones ? toneLabel(expectedOption.tones) : null;
  const expected = optionLabel ?? feedback.expected;
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
    <Sheet
      ref={sheet}
      role="status"
      tone={feedback.correct ? "ngoc" : "surface"}
      data-testid="feedback-sheet"
      className="max-h-[70dvh] short:max-h-[55dvh] short:pt-3 short:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {expectedId && !feedback.correct && (
        // Bonne réponse surlignée dans la liste, l'option choisie (fausse) en rouge.
        <style>{`${chosenId && chosenId !== expectedId ? `[data-testid="lesson"] [data-option-id="${cssId(chosenId)}"]{border-color:var(--color-son-mai);background-color:color-mix(in srgb,var(--color-son-mai) 8%,white)}` : ""}[data-testid="lesson"] [data-option-id="${cssId(expectedId)}"]{border-color:var(--color-ngoc);background-color:var(--color-ngoc-sang);box-shadow:0 0 0 2px var(--color-ngoc)}`}</style>
      )}
      {feedback.correct ? (
        // Le moment héroïque de la séance : la feuille jade monte, la coche se pose avec elle.
        <p className="flex items-center gap-3 text-2xl font-semibold motion-safe:animate-[rise_300ms_ease-out]">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-nuoc/20">
            <Icon name="check" size={22} strokeWidth={3} />
          </span>
          {t("lesson.correct")}
        </p>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 short:grid short:grid-cols-[minmax(0,1fr)_auto] short:items-end short:gap-x-6">
          <div className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-1 short:max-h-[calc(55dvh-1.5rem)] short:gap-1">
            <p className="text-lg font-semibold text-son-mai">
              {feedback.nearMiss ? t("lesson.nearMiss", { expected }) : t("lesson.wrong")}
            </p>
            {!feedback.nearMiss && expected && (
              <p className="flex flex-wrap items-baseline gap-2">
                <span>{t("lesson.answerLabel")}</span>
                {optionLabel ? <span className="text-lg font-semibold" data-testid="feedback-expected">{expected}</span> : <Vi size="2xl">{expected}</Vi>}
              </p>
            )}
            {feedback.explain && <p>{l(feedback.explain)}</p>}

            {why === null && !remedial && (
              <button type="button" onClick={() => void ask()} className="min-h-11 self-start text-left font-semibold text-ngoc underline-offset-4 hover:underline">
                {t("tutor.why")}
              </button>
            )}
            {why === "loading" && <p className="min-h-11 text-sm text-phu-sa">{t("tutor.thinking")}</p>}
            {why !== null && why !== "loading" && (
              <p className="rounded-field bg-surface-nghe px-3 py-2 text-sm" aria-live="polite">
                <span className="font-semibold">{t("tutor.name")} : </span>
                {why.kind === "tutor"
                  ? why.text
                  : why.kind === "unavailable"
                    ? feedback.explain
                      ? l(feedback.explain)
                      : t("journey.why.fallback")
                    : t(feedback.explain ? "tutor.why.offline" : "tutor.why.offlineNoExplain")}
              </p>
            )}

            <p className="text-sm text-phu-sa">{t(isReview ? "session.retryLater" : "lesson.retryLater")}</p>
          </div>
          <Button className="shrink-0 short:w-auto" onClick={() => void next()}>{t("lesson.continue")}</Button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * XP du bilan, compté à l'écran (contrat phase8 §1). La chaîne traduite garde son ordre et son
 * unité (« 40 XP », « +40 XP ») : seul le nombre qu'elle contient est remplacé par le compteur.
 */
function XpCount({ xp }: { xp: number }) {
  const text = t("recap.xp", { n: xp });
  const [before, ...after] = text.split(String(xp));
  if (after.length === 0) return <>{text}</>;
  return (
    <>
      {before}
      <CountUp to={xp} />
      {after.join(String(xp))}
    </>
  );
}

function Recap({ content, onDone, onRetry }: { content: ContentIndex; onDone: () => void; onRetry: () => void }) {
  const recap = useSession((s) => s.recap);
  const account = useAccount((s) => s.status);
  const [nextTitle, setNextTitle] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getProfile(), progressState(content)]).then(([profile, progress]) => {
      const upcoming = nextLesson(content.curriculum, content.lessons, progress.unlocked, profile.motivation, progress.passed);
      setNextTitle(upcoming ? l(upcoming.title) : null);
    });
  }, [content]);

  if (!recap) return null;

  // Entraînement (contrat phase8 §2) : ni XP, ni série, ni leçon recomptée — le bilan le dit franchement.
  if (recap.practice) {
    return (
      <Screen action={<Button onClick={onDone}>{t("review.practice.back")}</Button>}>
        <div className="flex flex-1 flex-col justify-center gap-4" data-testid="practice-recap">
          <h1 className="font-serif text-2xl">{t("review.practice.doneTitle")}</h1>
          <p className="text-lg text-phu-sa">{t("review.practice.doneBody")}</p>
          {recap.lessonId && <LessonNoteBlock lessonId={recap.lessonId} />}
        </div>
      </Screen>
    );
  }

  const concepts = (ids: readonly string[]) => ids.flatMap((id) => content.concepts.get(id) ?? []);
  const learned = concepts(recap.canSay);
  const reviewed = concepts(recap.reviewed);
  const title: MessageKey = recap.source === "lesson" ? "recap.title" : recap.source === "review" ? "session.recap.reviewTitle" : "session.recap.title";
  const offerAccount = recap.firstLesson && account === "guest";
  const badges = BADGE_CODES.filter((code) => recap.badges.includes(code));
  const before = levelForXp(recap.xpBefore).value;
  const after = levelLabel(content.pack, recap.xpAfter);
  const levelUp = after.value > before;

  // Test d'unité sous le seuil : écran « Presque ! Refais le test » (contrat phase5 §2).
  if (recap.unitTest && !recap.unitTest.passed) {
    const lessonId = recap.unitTest.lessonId;
    return (
      <Screen
        action={
          <div className="flex flex-col gap-2">
            <Button onClick={onRetry} data-lesson={lessonId}>{t("journey.unitTest.retry")}</Button>
            <Button variant="quiet" onClick={onDone}>{t("recap.next")}</Button>
          </div>
        }
      >
        <div className="flex flex-1 flex-col justify-center gap-5" data-testid="unit-test-failed">
          <h1 className="font-serif text-2xl">{t("journey.unitTest.almost")}</h1>
          <p className="text-lg">{t("journey.unitTest.almostBody", { pass: Math.round(UNIT_TEST_PASS_SCORE * 100), n: Math.round(recap.unitTest.score * 100) })}</p>
          {recap.xp > 0 && <p className="text-lg font-semibold text-ngoc">{t("recap.xp", { n: recap.xp })}</p>}
        </div>
      </Screen>
    );
  }

  return (
    <Screen action={<Button onClick={onDone}>{t("recap.next")}</Button>}>
      <div className="flex flex-1 flex-col gap-6 pt-6">
        <h1 className="font-serif text-2xl">{t(title)}</h1>

        {/* Le moment héroïque du bilan : l'XP se compte, la série s'allume. */}
        <Card tone="raised" className="flex items-center justify-between gap-4 py-5">
          <p className="flex flex-col">
            <span className="text-vi font-semibold text-ngoc">
              <XpCount xp={recap.xp} />
            </span>
            <span className="flex items-center gap-1.5 text-lg text-phu-sa">
              {recap.streak.current > 0 && <Icon name="flame" size={18} className="text-son-mai motion-safe:parlo-flame" />}
              {t("recap.streak", { n: recap.streak.current })}
            </span>
          </p>
          {recap.unitTest && (
            <ProgressRing
              value={Math.round(recap.unitTest.score * 100)}
              max={100}
              size={84}
              tone={recap.unitTest.passed ? "ngoc" : "nghe"}
              label={t("journey.unitTest.passed")}
            >
              <span className="text-lg font-semibold tabular-nums">{Math.round(recap.unitTest.score * 100)}%</span>
            </ProgressRing>
          )}
        </Card>

        {levelUp ? (
          <Card tone="notice" as="section" className="flex flex-col gap-1 motion-safe:animate-[rise_700ms_ease-out]" aria-live="polite" data-testid="level-up">
            <Icon name="star" size={22} className="text-nghe" />
            <p className="font-serif text-2xl">{t("journey.level.up", { n: after.value })}</p>
            {after.name && <p className="text-lg">{t("journey.level.upName", { name: after.name })}</p>}
          </Card>
        ) : (
          <LevelLine pack={content.pack} xp={recap.xpAfter} />
        )}

        {recap.unitTest?.passed && (
          <p className="flex items-center gap-2 font-medium text-ngoc" data-testid="unit-test-passed">
            <Icon name="check" size={18} strokeWidth={3} />
            {t("journey.unitTest.passed")}
          </p>
        )}

        {learned.length > 0 && (
          <section>
            <SectionTitle icon="star" className="mb-3">{t("session.recap.canSay")}</SectionTitle>
            <Card tone="plain" as="ul" className="flex flex-col gap-3 py-3">
              {learned.map((c, i) => (
                <li
                  key={c.id}
                  style={staggerStyle(i)}
                  className="flex items-baseline justify-between gap-4 border-b border-line pb-2 last:border-b-0 last:pb-0 motion-safe:parlo-enter"
                >
                  <Vi size="2xl">{c.vi}</Vi>
                  <span className="text-right text-phu-sa">{l(c.gloss)}</span>
                </li>
              ))}
            </Card>
          </section>
        )}

        {reviewed.length > 0 && (
          <section>
            <SectionTitle icon="cards" className="mb-2">{t("session.recap.reviewed", { n: reviewed.length })}</SectionTitle>
            <p lang="vi" className="font-serif text-lg">{reviewed.map((c) => c.vi).join(" · ")}</p>
          </section>
        )}

        {badges.length > 0 && (
          <section aria-live="polite">
            <SectionTitle icon="trophy" className="mb-3">{t("badges.recap.earned")}</SectionTitle>
            <ul className="flex flex-col gap-3">
              {badges.map((code, i) => (
                <Card key={code} as="li" tone="notice" stagger={i} className="flex items-center gap-4 py-3">
                  <BadgeIcon code={code} earned size={56} />
                  <div>
                    <p className="font-semibold">{t(`badges.${code}.name` as MessageKey)}</p>
                    <p className="text-sm text-phu-sa">{t(`badges.${code}.desc` as MessageKey)}</p>
                  </div>
                </Card>
              ))}
            </ul>
          </section>
        )}

        {/* Note personnelle sur la leçon qu'on vient de faire (contrat phase8 §3). */}
        {recap.lessonId && <LessonNoteBlock lessonId={recap.lessonId} />}

        {nextTitle && (
          <p className="flex items-center gap-2 text-phu-sa">
            <Icon name="boat" size={18} />
            {t("session.recap.nextStep")} <span className="font-medium text-muc">{nextTitle}</span>
          </p>
        )}

        {offerAccount && (
          <Card tone="notice" as="section" className="flex flex-col gap-3">
            <p className="font-semibold">{t("account.offer.title")}</p>
            <p className="text-sm text-phu-sa">{t("account.offer.body")}</p>
            <Link
              to="/compte"
              className="grid min-h-12 place-items-center rounded-card border-2 border-ngoc bg-surface px-5 font-semibold text-ngoc transition-transform motion-safe:active:scale-[.98]"
            >
              {t("account.offer.cta")}
            </Link>
            <p className="text-sm text-phu-sa">{t("account.offer.guestWarning")}</p>
          </Card>
        )}
      </div>
    </Screen>
  );
}
