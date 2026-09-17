import {
  buildExam,
  EXAM_ITEM_COUNT,
  examAvailability,
  gradeExam,
  isExamUnlocked,
  lessonsForConcepts,
  nextExamAttemptAt,
  revisionLessons,
  uuidv7,
  type ContentIndex,
  type ExamAnswer,
  type ExamFile,
  type ExamGrade,
  type ExamQuestion,
  type LessonId,
} from "@parlo/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError, getExamAttemptResult, getExams, NetworkError, startExam, submitExam, type ExamSubmitResult, type ExamSummary } from "../api.ts";
import { CertificateReady } from "../certificates/CertificatePages.tsx";
import { BackHeader } from "./BackHeader.tsx";
import { Button, Screen } from "../components/ui.tsx";
import { Card, Chip, Diploma, EmptyState, Icon, Illustration, ProgressRing, Skeleton, type IconName } from "../design/index.ts";
import { getLocale, l, t } from "../i18n/index.ts";
import { useOnline } from "../use-online.ts";
import { doneLessons, getLocalAttempts, getOngoingAttempt, loadExam, loadExams, saveLocalAttempt, saveOngoingAttempt, type LocalAttempt, type OngoingAttempt } from "./exam-files.ts";
import { ExamResults } from "./ExamResults.tsx";
import { ExamRunner } from "./ExamRunner.tsx";

const formatDateTime = (d: Date | string) =>
  new Date(d).toLocaleString(getLocale(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const formatDate = (d: string) => new Date(d).toLocaleDateString(getLocale(), { day: "numeric", month: "long" });

function useExam(content: ContentIndex) {
  const { level = "" } = useParams();
  const [exam, setExam] = useState<ExamFile | null | undefined>(undefined);
  useEffect(() => {
    void loadExam(content.pack.code, level).then(setExam);
  }, [content, level]);
  return { level, exam };
}

// ---------------------------------------------------------------------------
// /examens

interface Row {
  exam: ExamFile;
  unlocked: boolean;
  next: Date | null;
  last: LocalAttempt | null;
  /** Moins de 15 items notables faute de médias (contrat phase5 §1). */
  unavailable: boolean;
  /** Part des unités requises déjà validées : l'anneau dit « il te reste ça », pas « c'est fermé ». */
  ready: number;
}

/** Même règle que `isExamUnlocked` (tests d'unité s'il y en a, sinon toutes les leçons), en fraction. */
function readiness(content: ContentIndex, exam: ExamFile, done: ReadonlySet<LessonId>): number {
  if (exam.requiresUnits.length === 0) return 1;
  const parts = exam.requiresUnits.map((unitId) => {
    const unit = content.curriculum.units.find((u) => u.id === unitId);
    if (!unit || unit.lessons.length === 0) return 0;
    const tests = unit.lessons.filter((id) => content.lessons.get(id)?.kind === "unit_test");
    const required = tests.length > 0 ? tests : unit.lessons;
    return required.filter((id) => done.has(id)).length / required.length;
  });
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Une entrée de carte : pictogramme, libellé, chevron — même gabarit pour le blanc et le certifiant. */
function ExamLink({ to, icon, label, hint, tone }: { to: string; icon: IconName; label: string; hint?: string; tone: "ngoc" | "nghe" }) {
  return (
    <Link
      to={to}
      className="-mx-2 flex min-h-12 items-center gap-3 rounded-field px-2 py-2 transition-colors hover:bg-phu-sa/5"
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${tone === "ngoc" ? "bg-ngoc-sang text-ngoc" : "bg-surface-nghe text-muc"}`}>
        <Icon name={icon} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-ngoc">{label}</span>
        {hint && <span className="text-sm text-phu-sa">{hint}</span>}
      </span>
      <Icon name="chevronRight" size={20} className="text-phu-sa/50" />
    </Link>
  );
}

export function ExamsPage({ content }: { content: ContentIndex }) {
  const online = useOnline();
  const status = useAccount((s) => s.status);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    void (async () => {
      const [exams, done, attempts] = await Promise.all([loadExams(content.pack.code), doneLessons(content), getLocalAttempts()]);
      let server: ExamSummary[] = [];
      if (status === "signed_in" && online) server = await getExams().catch(() => []);
      setRows(
        exams.map((exam) => {
          const remote = server.find((s) => s.id === exam.id);
          const local = attempts[exam.id] ?? null;
          const last: LocalAttempt | null = remote?.lastAttempt ? { submittedAt: remote.lastAttempt.submittedAt, passed: remote.lastAttempt.passed, scores: remote.lastAttempt.scores } : local;
          const next = remote ? (remote.nextAttemptAt ? new Date(remote.nextAttemptAt) : null) : nextExamAttemptAt(exam, last?.submittedAt ?? null);
          const unavailable = remote?.unavailableReason ? remote.unavailableReason === "media_missing" : examAvailability(content, exam).unavailableReason !== null;
          return {
            exam,
            unlocked: remote?.unlocked ?? isExamUnlocked(content.curriculum, exam, done, content.lessons),
            next: next && next.getTime() > Date.now() ? next : null,
            last,
            unavailable,
            ready: readiness(content, exam, done),
          };
        }),
      );
    })();
  }, [content, status, online]);

  // Une seule carte porte l'écran : le premier palier ouvert et pas encore réussi. Si tout est
  // réussi — ou tout fermé — aucune n'est mise en avant (deux « feature » se neutralisent, §1).
  const featured = rows?.findIndex((r) => r.unlocked && !r.unavailable && !r.last?.passed) ?? -1;
  const firstMock = rows?.find((r) => !r.unavailable)?.exam.level.toLowerCase() ?? null;
  const noAttempt = rows !== null && rows.every((r) => r.last === null);

  return (
    <Screen top={<BackHeader title={t("exams.title")} />}>
      <p className="pb-4 text-phu-sa">{t("exams.intro")}</p>

      {rows === null && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} rounded="card" className="h-40" />
          ))}
        </div>
      )}

      {rows !== null && noAttempt && (
        <EmptyState
          art="diploma"
          compact={rows.length > 0}
          className="mb-5"
          title={t("exams.empty.title")}
          body={t("exams.empty.body")}
          action={
            firstMock ? (
              <Link to={`/examens/${firstMock}/blanc`} className="inline-flex min-h-11 items-center gap-2 rounded-chip px-3 font-semibold text-ngoc">
                <Icon name="play" size={18} />
                {t("exams.mock")}
              </Link>
            ) : undefined
          }
        />
      )}

      <ul className="flex flex-col gap-3">
        {rows?.map(({ exam, unlocked, next, last, unavailable, ready }, i) => {
          const slug = exam.level.toLowerCase();
          const units = exam.requiresUnits.map((u) => l(content.curriculum.units.find((x) => x.id === u)?.title) || u).join(", ");
          return (
            <Card
              key={exam.id}
              as="li"
              tone={i === featured ? "feature" : unlocked ? "plain" : "quiet"}
              stagger={i}
              className="flex flex-col gap-3"
              data-testid={`exam-${slug}`}
            >
              <div className="flex items-start gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <h2 lang="vi" className="font-serif text-2xl">{l(exam.certificate)}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {unlocked && <Chip tone="ngoc" icon="check" className="max-w-full">{t("exams.unlocked")}</Chip>}
                    {last && (
                      // `max-w-full` : une date longue revient à la ligne dans le jeton au lieu de déborder de la carte.
                      <Chip tone={last.passed ? "solid" : "neutral"} icon={last.passed ? "trophy" : "clock"} className="max-w-full">
                        {t(last.passed ? "exams.lastPassed" : "exams.lastFailed", { date: formatDate(last.submittedAt) })}
                      </Chip>
                    )}
                  </div>
                </div>
                {/* L'anneau remplace le mot « verrouillé » : on voit le chemin qu'il reste. */}
                <ProgressRing value={unlocked ? 1 : ready} size={56} label={t("exams.readiness")} tone={unlocked ? "ngoc" : "nghe"}>
                  <Icon name={unlocked ? "check" : "lock"} size={20} className={unlocked ? "text-ngoc" : "text-phu-sa"} />
                </ProgressRing>
              </div>

              {unavailable && <p className="text-sm text-phu-sa" data-testid="exam-unavailable">{t("journey.exam.unavailable")}</p>}
              {!unavailable && !unlocked && <p className="text-sm text-phu-sa">{t("exams.locked", { units })}</p>}
              {next && <p className="text-sm text-phu-sa">{t("exams.nextAttempt", { date: formatDateTime(next) })}</p>}

              {!unavailable && (
                <div className="flex flex-col gap-1 border-t border-line pt-2">
                  <ExamLink to={`/examens/${slug}/blanc`} icon="play" tone="ngoc" label={t("exams.mock")} hint={t("exams.mock.hint")} />
                  {unlocked && !next && <ExamLink to={`/examens/${slug}`} icon="diploma" tone="nghe" label={t("exams.real")} />}
                </div>
              )}
            </Card>
          );
        })}
      </ul>

      <Link
        to="/certificats"
        className="mt-4 flex min-h-12 items-center gap-3 rounded-card border border-line bg-surface px-5 py-3 font-medium transition-colors hover:bg-surface-2"
      >
        <Icon name="diploma" size={20} className="text-ngoc" />
        <span className="min-w-0 flex-1">{t("exams.certificates")}</span>
        <Icon name="chevronRight" size={20} className="text-phu-sa/50" />
      </Link>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// /examens/:level/blanc — 100 % local

/** Lecture du fichier d'examen : un squelette au gabarit de l'écran, jamais une page blanche (§1). */
function ExamLoading({ title }: { title: string }) {
  return (
    <Screen top={<BackHeader title={title} to="/examens" />}>
      <div className="flex flex-col gap-4">
        <Skeleton rounded="card" className="h-48" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton rounded="card" className="h-44" />
      </div>
    </Screen>
  );
}

/** Examen introuvable ou non notable : l'écran le dit dans une carte, pas dans une ligne perdue. */
function ExamProblem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Screen top={<BackHeader title={title} to="/examens" />}>
      <Card tone="alert" className="flex items-start gap-3">
        <Icon name="alert" className="mt-0.5 shrink-0 text-son-mai" />
        {children}
      </Card>
    </Screen>
  );
}

export function MockExamPage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const { exam } = useExam(content);
  const [stage, setStage] = useState<"intro" | "run" | "result">("intro");
  const [seed, setSeed] = useState(() => uuidv7());
  const [deadline, setDeadline] = useState(0);
  const [grade, setGrade] = useState<ExamGrade | null>(null);
  const questions = useMemo(() => (exam ? buildExam(content, exam, seed) : []), [content, exam, seed]);

  if (exam === undefined) return <ExamLoading title={t("exams.mock")} />;
  if (exam === null) return <ExamProblem title={t("exams.title")}><p>{t("exams.error.generic")}</p></ExamProblem>;
  if (examAvailability(content, exam).unavailableReason) {
    return (
      <ExamProblem title={t("exams.mock")}>
        <p data-testid="exam-unavailable">{t("journey.exam.unavailable")}</p>
      </ExamProblem>
    );
  }

  if (stage === "run") {
    return (
      <ExamRunner
        content={content}
        questions={questions}
        deadline={deadline}
        onQuit={() => navigate("/examens")}
        onFinish={(answers) => {
          setGrade(gradeExam(exam, questions, answers, { allowUngradedSpeech: true }));
          setStage("result");
        }}
      />
    );
  }

  if (stage === "result" && grade) {
    return (
      <ExamResults
        content={content}
        exam={exam}
        mock
        passed={grade.passed}
        global={grade.global}
        scores={grade.scores}
        lessons={revisionLessons(content, exam, questions, grade)}
        action={
          <div className="flex flex-col gap-2">
            <Button onClick={() => navigate("/examens")}>{t("exams.back")}</Button>
            <Button variant="quiet" onClick={() => { setSeed(uuidv7()); setStage("intro"); }}>{t("exams.result.retryMock")}</Button>
          </div>
        }
      />
    );
  }

  return (
    <Screen
      top={<BackHeader title={t("exams.mock")} to="/examens" />}
      action={<Button onClick={() => { setDeadline(Date.now() + exam.durationMinutes * 60_000); setStage("run"); }}>{t("exams.mock.start")}</Button>}
    >
      <ExplainList exam={exam} mock />
    </Screen>
  );
}

function ExplainList({ exam, mock }: { exam: ExamFile; mock: boolean }) {
  const items: { icon: IconName; text: string }[] = [
    { icon: "clock", text: t("exams.explain.duration", { n: exam.durationMinutes, items: exam.sections.reduce((n, s) => n + s.items.length, 0) || EXAM_ITEM_COUNT }) },
    { icon: "target", text: t("exams.explain.skills") },
    { icon: "refresh", text: mock ? t("exams.mock.explain") : t("exams.explain.once", { hours: exam.retryAfterHours }) },
    { icon: "mic", text: t("exams.explain.mic") },
    { icon: "info", text: t("exams.explain.noFeedback") },
  ];
  return (
    <div className="flex flex-col gap-5">
      {/* Le seul moment héroïque de l'écran : le diplôme visé se pose avant les règles du jeu. */}
      <Card tone="feature" className="flex flex-col items-center gap-2 text-center motion-safe:parlo-enter">
        <Illustration className="max-w-[11rem]">
          <Diploma />
        </Illustration>
        <p lang="vi" className="font-serif text-vi leading-tight text-ngoc">{l(exam.certificate)}</p>
      </Card>
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-serif text-lg">
          <Icon name="info" size={20} className="text-ngoc" />
          {t("exams.explain.title")}
        </h2>
        {/* Une seule carte de regroupement : cinq cartes identiques empilées seraient un mur (§1). */}
        <Card tone="quiet">
          <ul className="flex flex-col divide-y divide-line">
            {items.map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface text-ngoc">
                  <Icon name={icon} size={18} />
                </span>
                <span className="min-w-0 flex-1">{text}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /examens/:level — certifiant, en ligne seulement

type RealStage =
  | { kind: "intro" }
  | { kind: "starting" }
  | { kind: "run"; attempt: OngoingAttempt; questions: ExamQuestion[] }
  | { kind: "submitting"; attempt: OngoingAttempt; questions: ExamQuestion[]; answers: ExamAnswer[]; error: string | null }
  | { kind: "result"; result: ExamSubmitResult }
  | { kind: "certificate"; result: ExamSubmitResult };

export function RealExamPage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const online = useOnline();
  const status = useAccount((s) => s.status);
  const { exam } = useExam(content);
  const [stage, setStage] = useState<RealStage>({ kind: "intro" });
  const [error, setError] = useState<string | null>(null);

  /** Une seule soumission à la fois : la fin du temps et le dernier « Valider » ne doivent pas s'additionner. */
  const submitting = useRef(false);

  /** Tentative déjà soumise (409 already_submitted) : on affiche son résultat au lieu d'une erreur. */
  const resultOf = async (attemptId: string, examId: string): Promise<ExamSubmitResult | null> => {
    const direct = await getExamAttemptResult(attemptId);
    if (direct) return direct;
    const summary = (await getExams().catch(() => [] as ExamSummary[])).find((e) => e.id === examId);
    const last = summary?.lastAttempt;
    if (!last) return null;
    const values = Object.values(last.scores).filter((v): v is number => typeof v === "number");
    const global = last.global ?? (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    return { passed: last.passed, global, scores: last.scores, gaps: [], certificate: null };
  };

  const submit = async (attempt: OngoingAttempt, questions: ExamQuestion[], answers: ExamAnswer[]) => {
    if (!exam || submitting.current) return;
    submitting.current = true;
    setStage({ kind: "submitting", attempt, questions, answers, error: null });
    try {
      const result = await submitExam(attempt.attemptId, answers);
      await saveOngoingAttempt(null);
      await saveLocalAttempt(exam.id, { submittedAt: new Date().toISOString(), passed: result.passed, scores: result.scores });
      setStage({ kind: "result", result });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.detail === "already_submitted") {
        await saveOngoingAttempt(null);
        const result = await resultOf(attempt.attemptId, exam.id);
        if (result) {
          await saveLocalAttempt(exam.id, { submittedAt: new Date().toISOString(), passed: result.passed, scores: result.scores });
          setStage({ kind: "result", result });
        } else {
          setStage({ kind: "intro" });
          setError(t("exams.error.generic"));
        }
        return;
      }
      if (e instanceof ApiError && (e.status === 410 || e.status === 409 || e.status === 404)) {
        await saveOngoingAttempt(null);
        setStage({ kind: "intro" });
        setError(t("exams.error.expired"));
        return;
      }
      setStage({ kind: "submitting", attempt, questions, answers, error: e instanceof NetworkError ? t("exams.error.network") : t("exams.error.generic") });
    } finally {
      submitting.current = false;
    }
  };

  // Reprise d'une tentative en cours (rechargement de la page) ; soumission automatique seulement si elle a expiré.
  const resumed = useRef(false);
  useEffect(() => {
    if (!exam || resumed.current) return;
    resumed.current = true;
    void getOngoingAttempt().then((ongoing) => {
      if (!ongoing || ongoing.examId !== exam.id) return;
      const questions = buildExam(content, exam, ongoing.seed, ongoing.items);
      if (Date.parse(ongoing.expiresAt) <= Date.now()) {
        if (navigator.onLine) void submit(ongoing, questions, ongoing.answers);
        else setStage({ kind: "submitting", attempt: ongoing, questions, answers: ongoing.answers, error: t("exams.error.network") });
        return;
      }
      setStage({ kind: "run", attempt: ongoing, questions });
    });
  }, [content, exam]);

  if (exam === undefined) return <ExamLoading title={t("exams.real")} />;
  if (exam === null) return <ExamProblem title={t("exams.title")}><p>{t("exams.error.generic")}</p></ExamProblem>;

  const begin = async () => {
    setError(null);
    setStage({ kind: "starting" });
    try {
      const start = await startExam(exam.id);
      const attempt: OngoingAttempt = { examId: exam.id, attemptId: start.attemptId, seed: start.seed, expiresAt: start.expiresAt, items: start.items, answers: [] };
      await saveOngoingAttempt(attempt);
      setStage({ kind: "run", attempt, questions: buildExam(content, exam, start.seed, start.items.length > 0 ? start.items : undefined) });
    } catch (e) {
      setStage({ kind: "intro" });
      if (e instanceof ApiError && e.status === 409) {
        const next = (e.body as { nextAttemptAt?: string } | null)?.nextAttemptAt;
        setError(next ? t("exams.error.retry", { date: formatDateTime(next) }) : t("exams.error.generic"));
      } else if (e instanceof ApiError && e.status === 403) setError(t("exams.error.locked"));
      else setError(e instanceof NetworkError ? t("exams.real.offline") : t("exams.error.generic"));
    }
  };

  switch (stage.kind) {
    case "run": {
      const { attempt, questions } = stage;
      // L'échéance officielle : durée annoncée à partir du début côté serveur (expiresAt).
      const deadline = Math.min(Date.parse(attempt.expiresAt), Date.now() + exam.durationMinutes * 60_000 + 1000);
      return (
        <ExamRunner
          content={content}
          questions={questions}
          deadline={deadline}
          initialAnswers={attempt.answers}
          onAnswer={(answers) => void saveOngoingAttempt({ ...attempt, answers })}
          onQuit={() => void submit(attempt, questions, attempt.answers)}
          onFinish={(answers) => void submit(attempt, questions, answers)}
        />
      );
    }
    case "submitting":
      return (
        <Screen action={stage.error ? <Button disabled={!online} onClick={() => void submit(stage.attempt, stage.questions, stage.answers)}>{t("exams.retrySubmit")}</Button> : undefined}>
          <div className="my-auto flex flex-col items-center gap-5 text-center">
            <p className="text-lg" role="status">{stage.error ?? t("exams.run.submitting")}</p>
            {/* L'envoi n'est pas un écran vide : trois lignes de squelette disent que ça travaille. */}
            {!stage.error && (
              <div className="flex w-full max-w-[18rem] flex-col items-center gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            )}
          </div>
        </Screen>
      );
    case "result": {
      const { result } = stage;
      const certificate = result.certificate;
      return (
        <ExamResults
          content={content}
          exam={exam}
          mock={false}
          passed={result.passed}
          global={result.global}
          scores={result.scores}
          lessons={lessonsForConcepts(content, exam, result.gaps.flatMap((g) => g.conceptIds))}
          action={
            result.passed && certificate ? (
              <Button onClick={() => setStage({ kind: "certificate", result })}>{t("exams.result.certificate")}</Button>
            ) : (
              <Button onClick={() => navigate("/examens")}>{t("exams.back")}</Button>
            )
          }
        />
      );
    }
    case "certificate": {
      const cert = stage.result.certificate;
      if (!cert) return null;
      return (
        <CertificateReady
          content={content}
          certificate={{ id: cert.id, verificationCode: cert.verificationCode, level: exam.level, issuedAt: new Date().toISOString() }}
          onDone={() => navigate("/")}
        />
      );
    }
    default: {
      const blocked = status !== "signed_in" ? t("exams.real.account") : !online ? t("exams.real.offline") : null;
      return (
        <Screen
          top={<BackHeader title={t("exams.real")} to="/examens" />}
          action={
            <Button disabled={blocked !== null || stage.kind === "starting"} onClick={() => void begin()}>
              {stage.kind === "starting" ? t("exams.explain.starting") : t("exams.explain.start")}
            </Button>
          }
        >
          <ExplainList exam={exam} mock={false} />
          {blocked && (
            <Card tone="notice" className="mt-5 flex items-start gap-3">
              <Icon name="info" className="mt-0.5 shrink-0 text-muc" />
              <p className="min-w-0 flex-1">{blocked}</p>
            </Card>
          )}
          {status !== "signed_in" && (
            <Link to="/compte" className="mt-2 flex min-h-11 items-center gap-2 self-start font-semibold text-ngoc">
              {t("account.offer.cta")}
              <Icon name="chevronRight" size={18} />
            </Link>
          )}
          {error && (
            <Card tone="alert" className="mt-5 flex items-start gap-3">
              <Icon name="alert" className="mt-0.5 shrink-0 text-son-mai" />
              <p role="alert" className="min-w-0 flex-1">{error}</p>
            </Card>
          )}
        </Screen>
      );
    }
  }
}
