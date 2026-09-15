import type { ContentIndex } from "@parlo/core";
import { localDay } from "@parlo/core";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { BackHeader } from "../exams/BackHeader.tsx";
import { t, type MessageKey } from "../i18n/index.ts";
import { completedLessons } from "../learner.ts";
import { useOnline } from "../use-online.ts";
import { assignmentProgress, nextLesson } from "./assignments.ts";
import { clearMyClassesCache, getMyClasses, joinClass, leaveClass, normalizeJoinCode, type JoinedClass, type MyClass } from "./classes-api.ts";
import { Confirm, Explain, inputClass, linkButton, primaryLink, ProgressBar, whenLabel } from "./widgets.tsx";

/**
 * Classes côté élève (spec §15 Phase 4, RGPD §14) : rejoindre avec un consentement explicite
 * qui dit exactement ce que l'enseignant voit et ne voit pas ; quitter révoque le partage.
 */

const accountPath = (kind: "register" | "login", next: string) => `${kind === "register" ? "/compte" : "/connexion"}?next=${encodeURIComponent(next)}`;

function AccountLinks({ next, text }: { next: string; text: string }) {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <p>{text}</p>
      <Link to={accountPath("register", next)} className={primaryLink}>{t("classes.join.register")}</Link>
      <Link to={accountPath("login", next)} className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("classes.join.login")}</Link>
    </div>
  );
}

// --- /classe/:code -----------------------------------------------------------------

type JoinState = { kind: "idle" } | { kind: "joining" } | { kind: "joined"; joined: JoinedClass } | { kind: "error"; message: MessageKey };

export function JoinClassPage() {
  const { code: rawCode = "" } = useParams();
  const code = normalizeJoinCode(rawCode) ?? rawCode.toUpperCase();
  const here = `/classe/${encodeURIComponent(code)}`;
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<JoinState>({ kind: "idle" });

  const join = async () => {
    if (!consent) return;
    setState({ kind: "joining" });
    try {
      const joined = await joinClass(code);
      clearMyClassesCache();
      setState({ kind: "joined", joined });
    } catch (error) {
      const message: MessageKey =
        error instanceof ApiError && (error.status === 404 || error.status === 410)
          ? "classes.join.notFound"
          : error instanceof ApiError && error.status === 409
            ? "classes.join.conflict"
            : "classes.join.error";
      setState({ kind: "error", message });
    }
  };

  let body: ReactNode;
  if (status === "loading") body = null;
  else if (status !== "signed_in") body = <AccountLinks next={here} text={t("classes.join.guest")} />;
  else if (state.kind === "joined") {
    body = (
      <div className="flex flex-col gap-3 pt-2" role="status" data-testid="class-joined">
        <p className="font-serif text-2xl text-ngoc">{t("classes.join.done", { name: state.joined.name })}</p>
        <p>{t("classes.join.teacher", { name: state.joined.teacherName })}</p>
        <Link to="/mes-classes" className={linkButton}>{t("classes.join.toClasses")}</Link>
      </div>
    );
  } else {
    body = (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
        data-testid="class-join-form"
      >
        <section aria-labelledby="sees-title" className="flex flex-col gap-1">
          <h2 id="sees-title" className="font-semibold">{t("classes.join.sees")}</h2>
          <ul className="list-disc pl-5">
            {(["name", "activity", "lessons", "results"] as const).map((k) => (
              <li key={k}>{t(`classes.join.sees.${k}`)}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="never-title" className="flex flex-col gap-1">
          <h2 id="never-title" className="font-semibold">{t("classes.join.never")}</h2>
          <ul className="list-disc pl-5">
            {(["email", "audio", "messages"] as const).map((k) => (
              <li key={k}>{t(`classes.join.never.${k}`)}</li>
            ))}
          </ul>
        </section>
        <p className="text-sm text-phu-sa">{t("classes.join.revoke")}</p>
        <label className="flex min-h-11 items-start gap-3 border-l-4 border-ngoc pl-3">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-6 shrink-0 accent-ngoc" />
          <span className="font-medium">{t("classes.join.consent")}</span>
        </label>
        {!online && <p className="text-phu-sa">{t("classes.join.offline")}</p>}
        {state.kind === "error" && <p role="alert" className="font-medium text-son-mai">{t(state.message)}</p>}
        <Button type="submit" disabled={!consent || !online || state.kind === "joining"}>
          {state.kind === "joining" ? t("classes.join.busy") : t("classes.join.submit")}
        </Button>
      </form>
    );
  }

  return (
    <Screen top={<BackHeader title={t("classes.join.title")} />}>
      <p className="mb-4 text-phu-sa">
        {t("classes.join.code", { code })}
      </p>
      {body}
    </Screen>
  );
}

// --- /mes-classes ------------------------------------------------------------------

type MineState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; classes: MyClass[] };

export function MyClassesPage({ content }: { content: ContentIndex }) {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [state, setState] = useState<MineState>({ kind: "loading" });
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const load = (force = false) => {
    setState({ kind: "loading" });
    getMyClasses(force).then((classes) => setState({ kind: "ready", classes }), () => setState({ kind: "error" }));
  };

  useEffect(() => {
    void completedLessons(content.pack.code).then(setCompleted);
  }, [content]);

  useEffect(() => {
    if (status === "signed_in" && online) load(true);
  }, [status, online]);

  let body: ReactNode;
  if (status === "loading") body = null;
  else if (status !== "signed_in") body = <AccountLinks next="/mes-classes" text={t("classes.mine.guest")} />;
  else if (!online) body = <Explain text={t("classes.mine.offline")} />;
  else if (state.kind === "loading") body = null;
  else if (state.kind === "error") {
    body = (
      <Explain text={t("classes.mine.error")}>
        <button type="button" className={linkButton} onClick={() => load(true)}>{t("teacher.retry")}</button>
      </Explain>
    );
  } else if (state.classes.length === 0) {
    body = (
      <div className="flex flex-col gap-4 pt-2" data-testid="my-classes-empty">
        <p className="text-lg">{t("classes.mine.empty")}</p>
        <CodeForm />
      </div>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-8">
        {state.classes.map((c) => (
          <ClassCard key={c.id} cls={c} content={content} completed={completed} onLeft={() => setState({ kind: "ready", classes: state.classes.filter((x) => x.id !== c.id) })} />
        ))}
      </ul>
    );
  }

  return (
    <Screen top={<BackHeader title={t("classes.mine.title")} to="/reglages" />}>
      <div className="flex flex-col gap-5" data-testid="my-classes">{body}</div>
    </Screen>
  );
}

function CodeForm() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeJoinCode(raw);
    if (!code) return setInvalid(true);
    navigate(`/classe/${code}`);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="join-code" className="font-medium">{t("classes.mine.codeLabel")}</label>
      <input id="join-code" className={`${inputClass} font-mono uppercase`} value={raw} maxLength={8} autoComplete="off" autoCapitalize="characters" onChange={(e) => { setRaw(e.target.value); setInvalid(false); }} aria-invalid={invalid} />
      {invalid && <p role="alert" className="text-sm font-medium text-son-mai">{t("classes.mine.codeInvalid")}</p>}
      <button type="submit" className="min-h-12 self-start rounded-xl bg-ngoc px-5 font-semibold text-nuoc">{t("classes.mine.codeSubmit")}</button>
    </form>
  );
}

function ClassCard({ cls, content, completed, onLeft }: { cls: MyClass; content: ContentIndex; completed: Set<string>; onLeft: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const today = localDay(new Date());
  const assignments = [...cls.assignments].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  const leave = async () => {
    setBusy(true);
    setError(false);
    try {
      await leaveClass(cls.id);
      clearMyClassesCache();
      onLeft();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3" data-testid="my-class">
      <div>
        <h2 className="font-serif text-2xl">{cls.name}</h2>
        <p className="text-phu-sa">{t("classes.mine.with", { name: cls.teacherName })}</p>
      </div>
      {assignments.length === 0 ? (
        <p className="text-phu-sa">{t("classes.mine.noAssignments")}</p>
      ) : (
        <ul className="flex flex-col border-y border-phu-sa/10">
          {assignments.map((a) => {
            const { done, total } = assignmentProgress(a, completed);
            const finished = total > 0 && done >= total;
            const next = finished ? null : nextLesson(a, completed, (id) => content.lessons.has(id));
            const label = t("classes.mine.progress", { done, total });
            return (
              <li key={a.id} className="flex flex-col gap-2 border-t border-phu-sa/10 py-3 first:border-t-0" data-testid="my-assignment">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="font-semibold">{a.title}</p>
                  {a.dueDate && <p className="text-sm text-phu-sa">{t("classes.due.label", { when: whenLabel(a.dueDate, today) })}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1"><ProgressBar label={`${a.title} — ${label}`} value={done} max={Math.max(1, total)} done={finished} /></div>
                  <span className="text-sm tabular-nums text-phu-sa">{finished ? t("classes.mine.done") : label}</span>
                </div>
                {next && <Link to={`/lecon/${encodeURIComponent(next)}`} className={linkButton}>{t("classes.mine.continue")}</Link>}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="font-medium text-son-mai">{t("classes.mine.error")}</p>}
      {confirm ? (
        <Confirm id={`leave-${cls.id}`} text={t("classes.mine.leave.confirm", { name: cls.name, teacher: cls.teacherName })} confirmLabel={t("classes.mine.leave.do")} busy={busy} onConfirm={() => void leave()} onCancel={() => setConfirm(false)} />
      ) : (
        <button type="button" className="min-h-11 self-start font-semibold text-son-mai" onClick={() => setConfirm(true)}>{t("classes.mine.leave")}</button>
      )}
    </li>
  );
}
