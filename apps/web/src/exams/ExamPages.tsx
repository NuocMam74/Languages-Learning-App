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
} from "@parlo/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError, getExamAttemptResult, getExams, NetworkError, startExam, submitExam, type ExamSubmitResult, type ExamSummary } from "../api.ts";
import { CertificateReady } from "../certificates/CertificatePages.tsx";
import { BackHeader } from "./BackHeader.tsx";
import { Button, Screen } from "../components/ui.tsx";
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
          return { exam, unlocked: remote?.unlocked ?? isExamUnlocked(content.curriculum, exam, done, content.lessons), next: next && next.getTime() > Date.now() ? next : null, last, unavailable };
        }),
      );
    })();
  }, [content, status, online]);

  return (
    <Screen top={<BackHeader title={t("exams.title")} />}>
      <p className="pb-4 text-phu-sa">{t("exams.intro")}</p>
      <div className="flex flex-col">
        {rows?.map(({ exam, unlocked, next, last, unavailable }) => {
          const slug = exam.level.toLowerCase();
          const units = exam.requiresUnits.map((u) => l(content.curriculum.units.find((x) => x.id === u)?.title) || u).join(", ");
          return (
            <section key={exam.id} className="flex flex-col gap-3 border-t border-phu-sa/10 py-5 first:border-t-0" data-testid={`exam-${slug}`}>
              <div className="flex items-baseline justify-between gap-4">
                <h2 lang="vi" className="font-serif text-2xl">{l(exam.certificate)}</h2>
                <span className={`text-sm ${unlocked ? "text-ngoc" : "text-phu-sa"}`}>{unlocked ? t("exams.unlocked") : null}</span>
              </div>
              {unavailable && <p className="text-sm text-phu-sa" data-testid="exam-unavailable">{t("journey.exam.unavailable")}</p>}
              {!unavailable && !unlocked && <p className="text-sm text-phu-sa">{t("exams.locked", { units })}</p>}
              {last && <p className="text-sm text-phu-sa">{t(last.passed ? "exams.lastPassed" : "exams.lastFailed", { date: formatDate(last.submittedAt) })}</p>}
              {next && <p className="text-sm text-phu-sa">{t("exams.nextAttempt", { date: formatDateTime(next) })}</p>}
              <div className={`flex flex-col gap-1 ${unavailable ? "hidden" : ""}`}>
                <Link to={`/examens/${slug}/blanc`} className="flex min-h-12 flex-col justify-center">
                  <span className="font-semibold text-ngoc">{t("exams.mock")}</span>
                  <span className="text-sm text-phu-sa">{t("exams.mock.hint")}</span>
                </Link>
                {unlocked && !next && (
                  <Link to={`/examens/${slug}`} className="flex min-h-12 items-center font-semibold text-ngoc">
                    {t("exams.real")}
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <Link to="/certificats" className="mt-2 flex min-h-12 items-center border-t border-phu-sa/10 font-medium">{t("exams.certificates")}</Link>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// /examens/:level/blanc — 100 % local

export function MockExamPage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const { exam } = useExam(content);
  const [stage, setStage] = useState<"intro" | "run" | "result">("intro");
  const [seed, setSeed] = useState(() => uuidv7());
  const [deadline, setDeadline] = useState(0);
  const [grade, setGrade] = useState<ExamGrade | null>(null);
  const questions = useMemo(() => (exam ? buildExam(content, exam, seed) : []), [content, exam, seed]);

  if (exam === undefined) return <Screen><div /></Screen>;
  if (exam === null) return <Screen top={<BackHeader title={t("exams.title")} to="/examens" />}><p>{t("exams.error.generic")}</p></Screen>;
  if (examAvailability(content, exam).unavailableReason) {
    return <Screen top={<BackHeader title={t("exams.mock")} to="/examens" />}><p data-testid="exam-unavailable">{t("journey.exam.unavailable")}</p></Screen>;
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
  const items = [
    t("exams.explain.duration", { n: exam.durationMinutes, items: exam.sections.reduce((n, s) => n + s.items.length, 0) || EXAM_ITEM_COUNT }),
    t("exams.explain.skills"),
    mock ? t("exams.mock.explain") : t("exams.explain.once", { hours: exam.retryAfterHours }),
    t("exams.explain.mic"),
    t("exams.explain.noFeedback"),
  ];
  return (
    <div className="flex flex-col gap-5 pt-2">
      <p lang="vi" className="font-serif text-vi text-ngoc">{l(exam.certificate)}</p>
      <h2 className="font-semibold">{t("exams.explain.title")}</h2>
      <ul className="flex flex-col gap-3">
        {items.map((text) => (
          <li key={text} className="border-l-4 border-ngoc-sang pl-3">{text}</li>
        ))}
      </ul>
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

  if (exam === undefined) return <Screen><div /></Screen>;
  if (exam === null) return <Screen top={<BackHeader title={t("exams.title")} to="/examens" />}><p>{t("exams.error.generic")}</p></Screen>;

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
          <p className="my-auto text-center text-lg" role="status">{stage.error ?? t("exams.run.submitting")}</p>
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
          {blocked && <p className="mt-5 border-l-4 border-nghe pl-3">{blocked}</p>}
          {status !== "signed_in" && <Link to="/compte" className="mt-2 min-h-11 self-start py-2 font-semibold text-ngoc">{t("account.offer.cta")}</Link>}
          {error && <p role="alert" className="mt-5 border-l-4 border-son-mai pl-3">{error}</p>}
        </Screen>
      );
    }
  }
}
