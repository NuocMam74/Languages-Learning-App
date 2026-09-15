import type { ContentIndex } from "@parlo/core";
import { localDay } from "@parlo/core";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../api.ts";
import { Confirm, Explain, inputClass, linkButton, ProgressBar } from "../classes/widgets.tsx";
import { Button, Screen } from "../components/ui.tsx";
import { loadPack } from "../content.ts";
import { BackHeader } from "../exams/BackHeader.tsx";
import { getLocale, l, plural, t, type MessageKey } from "../i18n/index.ts";
import { activePackCode, availablePacks } from "../packs/active.ts";
import { usePackChoices } from "../packs/use-packs.ts";
import { QrCode } from "./QrCode.tsx";
import {
  assignmentPayload,
  classCompletion,
  daysSince,
  defaultDirection,
  percent,
  selectedLessons,
  sortRoster,
  weakest,
  type RosterSortKey,
  type SortDirection,
} from "./roster.ts";
import {
  createAssignment,
  createClass,
  deleteAssignment,
  getClass,
  getClasses,
  joinUrl,
  regenerateCode,
  removeStudent,
  type ClassDetail,
  type ClassSummary,
  type RosterStudent,
  type TeacherAssignment,
} from "./teacher-api.ts";
import { useTeacherAccess } from "./use-teacher.ts";

/**
 * Espace enseignant (spec §15 Phase 4, contrat phase4 §2) : classes, tableau de suivi,
 * devoirs. Réservé au rôle `teacher` ; l'élève a consenti au partage (RGPD §14) et
 * l'enseignant ne voit que le nom affiché — jamais email, audio ni messages.
 */

function Gate({ here, children }: { here: string; children: ReactNode }) {
  const access = useTeacherAccess();
  switch (access) {
    case "loading":
      return <p className="pt-2 text-phu-sa" role="status">{t("teacher.loading")}</p>;
    case "guest":
      return (
        <Explain text={t("teacher.guest")}>
          <Link to={`/connexion?next=${encodeURIComponent(here)}`} className={linkButton}>{t("teacher.login")}</Link>
        </Explain>
      );
    case "offline":
      return <Explain text={t("teacher.offline")} />;
    case "notTeacher":
      return (
        <div className="flex flex-col gap-3 pt-2" data-testid="teacher-not-teacher">
          <h2 className="font-serif text-2xl">{t("teacher.notTeacher.title")}</h2>
          <p>{t("teacher.notTeacher.body")}</p>
        </div>
      );
    case "teacher":
      return <>{children}</>;
  }
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Explain text={t("teacher.error")}>
      <button type="button" className={linkButton} onClick={onRetry}>{t("teacher.retry")}</button>
    </Explain>
  );
}

// --- /prof ------------------------------------------------------------------------

export function TeacherHomePage() {
  return (
    <Screen top={<BackHeader title={t("teacher.title")} to="/reglages" />}>
      <Gate here="/prof">
        <ClassList />
      </Gate>
    </Screen>
  );
}

function ClassList() {
  const [classes, setClasses] = useState<ClassSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    getClasses().then(setClasses, () => setFailed(true));
  };
  useEffect(load, []);

  if (failed) return <LoadError onRetry={load} />;
  if (!classes) return <p className="pt-2 text-phu-sa" role="status">{t("teacher.loading")}</p>;

  return (
    <div className="flex flex-col gap-6" data-testid="teacher-home">
      <p className="text-sm text-phu-sa">{t("teacher.privacy")}</p>
      <CreateClassForm onCreated={(c) => setClasses([c, ...classes])} />
      <section aria-labelledby="teacher-classes" className="flex flex-col gap-3">
        <h2 id="teacher-classes" className="font-semibold">{t("teacher.classes")}</h2>
        {classes.length === 0 ? (
          <p className="text-phu-sa">{t("teacher.classes.empty")}</p>
        ) : (
          <ul className="flex flex-col border-y border-phu-sa/10">
            {classes.map((c) => (
              <ClassRow key={c.id} summary={c} onChange={(next) => setClasses(classes.map((x) => (x.id === next.id ? next : x)))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreateClassForm({ onCreated }: { onCreated: (c: ClassSummary) => void }) {
  const packs = usePackChoices();
  const [name, setName] = useState("");
  const [packCode, setPackCode] = useState(activePackCode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(false);
    try {
      const created = await createClass(name.trim(), packCode);
      onCreated({ ...created, studentCount: created.studentCount ?? 0 });
      setName("");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-labelledby="create-class-title">
      <h2 id="create-class-title" className="font-semibold">{t("teacher.create.title")}</h2>
      <label htmlFor="class-name" className="font-medium">{t("teacher.create.name")}</label>
      <input id="class-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder={t("teacher.create.namePlaceholder")} />
      {availablePacks().length > 1 && (
        <>
          <label htmlFor="class-pack" className="font-medium">{t("teacher.create.pack")}</label>
          <select id="class-pack" className={inputClass} value={packCode} onChange={(e) => setPackCode(e.target.value)}>
            {packs.map((p) => (
              <option key={p.code} value={p.code}>{p.name ? l(p.name) : p.code}</option>
            ))}
          </select>
        </>
      )}
      {error && <p role="alert" className="font-medium text-son-mai">{t("teacher.error")}</p>}
      <button type="submit" disabled={busy || !name.trim()} className="min-h-12 self-start rounded-xl bg-ngoc px-5 font-semibold text-nuoc disabled:bg-phu-sa/25 disabled:text-phu-sa/60">
        {busy ? t("teacher.create.busy") : t("teacher.create.submit")}
      </button>
    </form>
  );
}

function ClassRow({ summary, onChange }: { summary: ClassSummary; onChange: (c: ClassSummary) => void }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = joinUrl(summary.joinCode);
  const canShare = typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const { joinCode } = await regenerateCode(summary.id);
      onChange({ ...summary, joinCode });
      setConfirmRegen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 border-t border-phu-sa/10 py-4 first:border-t-0" data-testid="class-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <Link to={`/prof/classes/${encodeURIComponent(summary.id)}`} className="min-h-11 py-2 text-lg font-semibold text-ngoc" aria-label={t("teacher.open", { name: summary.name })}>
          {summary.name}
        </Link>
        <span className="text-sm text-phu-sa">{plural("teacher.students", "teacher.students.plural", summary.studentCount)}</span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm text-phu-sa">{t("teacher.code")}</span>
        <span className="font-mono text-xl font-semibold tabular-nums" data-testid="join-code">{summary.joinCode}</span>
      </p>
      <p className="break-all text-sm text-phu-sa">{url}</p>
      <div className="flex flex-wrap gap-x-5">
        <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => void copy()}>
          {copied ? t("teacher.copied") : t("teacher.copy")}
        </button>
        {canShare && (
          <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => void navigator.share({ title: summary.name, text: t("teacher.share.text", { name: summary.name }), url }).catch(() => undefined)}>
            {t("teacher.share")}
          </button>
        )}
        <button type="button" className="min-h-11 font-semibold text-ngoc" aria-expanded={qr} onClick={() => setQr(!qr)}>
          {qr ? t("teacher.qr.hide") : t("teacher.qr.show")}
        </button>
        <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => setConfirmRegen(true)}>
          {t("teacher.regenerate")}
        </button>
      </div>
      {copied && <span className="sr-only" role="status">{t("teacher.copied")}</span>}
      {qr && <QrCode text={url} label={t("teacher.qr.label", { name: summary.name })} className="size-56 self-start" />}
      {confirmRegen && (
        <Confirm id={`regen-${summary.id}`} text={t("teacher.regenerate.confirm")} confirmLabel={t("teacher.regenerate.do")} busy={busy} onConfirm={() => void regenerate()} onCancel={() => setConfirmRegen(false)} />
      )}
    </li>
  );
}

// --- /prof/classes/:id --------------------------------------------------------------

export function ClassPage() {
  const { id = "" } = useParams();
  return (
    <Screen top={<div className="print:hidden"><BackHeader title={t("teacher.title")} to="/prof" /></div>}>
      <Gate here={`/prof/classes/${id}`}>
        <ClassView classId={id} />
      </Gate>
    </Screen>
  );
}

type ClassState = { kind: "loading" } | { kind: "error" } | { kind: "notFound" } | { kind: "ready"; detail: ClassDetail };

function ClassView({ classId }: { classId: string }) {
  const [state, setState] = useState<ClassState>({ kind: "loading" });
  const [content, setContent] = useState<ContentIndex | null>(null);

  const load = async () => {
    try {
      const detail = await getClass(classId);
      setState({ kind: "ready", detail });
      const packCode = detail.packCode ?? (await getClasses().catch(() => [])).find((c) => c.id === classId)?.packCode ?? activePackCode();
      setContent(await loadPack(packCode).catch(() => null));
    } catch (error) {
      setState(error instanceof ApiError && (error.status === 404 || error.status === 403) ? { kind: "notFound" } : { kind: "error" });
    }
  };

  useEffect(() => {
    void load();
  }, [classId]);

  if (state.kind === "loading") return <p className="pt-2 text-phu-sa" role="status">{t("teacher.loading")}</p>;
  if (state.kind === "error") return <LoadError onRetry={() => void load()} />;
  if (state.kind === "notFound") {
    return (
      <Explain text={t("teacher.class.notFound")}>
        <Link to="/prof" className={linkButton}>{t("teacher.class.back")}</Link>
      </Explain>
    );
  }

  const { detail } = state;
  const update = (patch: Partial<ClassDetail>) => setState({ kind: "ready", detail: { ...detail, ...patch } });

  return (
    <div className="flex flex-col gap-8" data-testid="class-page">
      <header className="flex flex-col gap-1">
        <h2 className="font-serif text-2xl">{detail.name}</h2>
        <p className="flex flex-wrap items-baseline gap-x-3 text-phu-sa">
          <span>{plural("teacher.students", "teacher.students.plural", detail.students.length)}</span>
          <span>
            {t("teacher.code")} <span className="font-mono font-semibold text-muc">{detail.joinCode}</span>
          </span>
        </p>
      </header>
      <Roster detail={detail} content={content} onRemoved={(userId) => update({ students: detail.students.filter((s) => s.id !== userId) })} />
      <Assignments detail={detail} content={content} onChange={(assignments) => update({ assignments })} onReload={() => void load()} />
    </div>
  );
}

// --- Tableau ---------------------------------------------------------------------------

const COLUMNS: { key: RosterSortKey | null; label: MessageKey; numeric?: boolean }[] = [
  { key: "name", label: "teacher.col.name" },
  { key: "lastActive", label: "teacher.col.lastActive" },
  { key: "streak", label: "teacher.col.streak", numeric: true },
  { key: "xpWeek", label: "teacher.col.xpWeek", numeric: true },
  { key: "lessons", label: "teacher.col.lessons", numeric: true },
  { key: null, label: "teacher.col.current" },
  { key: "exams", label: "teacher.col.exams" },
];

function lastActiveText(date: string | null, today: string): string {
  const days = daysSince(date, today);
  if (days === null) return t("teacher.lastActive.never");
  if (days === 0) return t("teacher.lastActive.today");
  if (days === 1) return t("teacher.lastActive.yesterday");
  return t("teacher.lastActive.days", { n: days });
}

function examText(exam: RosterStudent["exams"][number]): string {
  return exam.passed ? t("teacher.exam.passed", { level: exam.level }) : t("teacher.exam.score", { level: exam.level, p: percent(exam.global) });
}

function Roster({ detail, content, onRemoved }: { detail: ClassDetail; content: ContentIndex | null; onRemoved: (userId: string) => void }) {
  const [sort, setSort] = useState<{ key: RosterSortKey; direction: SortDirection }>({ key: "name", direction: "asc" });
  const [openId, setOpenId] = useState<string | null>(null);
  const today = localDay(new Date());
  const rows = sortRoster(detail.students, sort.key, sort.direction, getLocale());
  const open = detail.students.find((s) => s.id === openId) ?? null;

  const toggle = (key: RosterSortKey) =>
    setSort((s) => (s.key === key ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : { key, direction: defaultDirection(key) }));

  return (
    <section aria-labelledby="roster-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="roster-title" className="font-semibold">{t("teacher.roster")}</h2>
        {detail.students.length > 0 && (
          <button type="button" className="min-h-11 font-semibold text-ngoc print:hidden" onClick={() => window.print()}>
            {t("teacher.class.print")}
          </button>
        )}
      </div>
      {detail.students.length === 0 ? (
        <p className="text-phu-sa" data-testid="roster-empty">{t("teacher.roster.empty", { code: detail.joinCode })}</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5 print:mx-0 print:overflow-visible print:px-0">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm print:min-w-0 print:text-xs" data-testid="roster">
            <thead>
              <tr className="border-b-2 border-phu-sa/20">
                {COLUMNS.map((col) => {
                  const active = col.key !== null && sort.key === col.key;
                  return (
                    <th
                      key={col.label}
                      scope="col"
                      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                      className={`py-2 pr-3 align-bottom font-semibold ${col.numeric ? "text-right" : ""}`}
                    >
                      {col.key ? (
                        <button
                          type="button"
                          className={`inline-flex min-h-11 items-center gap-1 print:min-h-0 ${active ? "text-ngoc" : ""}`}
                          onClick={() => toggle(col.key!)}
                          aria-label={t("teacher.sortBy", { col: t(col.label) })}
                        >
                          {t(col.label)}
                          <span aria-hidden className={`text-xs print:hidden ${active ? "" : "invisible"}`}>{sort.direction === "asc" ? "▲" : "▼"}</span>
                        </button>
                      ) : (
                        t(col.label)
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const lesson = s.currentLessonId ? content?.lessons.get(s.currentLessonId) : undefined;
                return (
                  <tr key={s.id} className="border-b border-phu-sa/10 align-top break-inside-avoid" data-testid="roster-row">
                    <td className="py-2 pr-3">
                      <button type="button" className="min-h-11 text-left font-semibold text-ngoc underline-offset-4 hover:underline print:min-h-0 print:text-muc" onClick={() => setOpenId(s.id)}>
                        {s.displayName}
                      </button>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{lastActiveText(s.lastActiveDate, today)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t("teacher.streak.days", { n: s.streak })}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.xpWeek}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.lessonsCompleted}</td>
                    <td className="py-2 pr-3">{lesson ? l(lesson.title) : s.currentLessonId ? s.currentLessonId : t("teacher.none")}</td>
                    <td className="py-2 pr-3">{s.exams.length ? s.exams.map(examText).join(" · ") : t("teacher.none")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && <StudentDrawer student={open} classId={detail.id} content={content} onClose={() => setOpenId(null)} onRemoved={() => { setOpenId(null); onRemoved(open.id); }} />}
    </section>
  );
}

function StudentDrawer({ student, classId, content, onClose, onRemoved }: { student: RosterStudent; classId: string; content: ContentIndex | null; onClose: () => void; onRemoved: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lang = content?.pack.lang ?? "vi";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  const remove = async () => {
    setBusy(true);
    setError(false);
    try {
      await removeStudent(classId, student.id);
      onRemoved();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  const joined = new Date(student.joinedAt).toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="fixed inset-0 z-30 bg-muc/40 print:hidden" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-drawer-title"
        data-testid="student-drawer"
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col gap-5 overflow-y-auto rounded-t-2xl bg-nuoc px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[420px] md:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="student-drawer-title" className="font-serif text-2xl">{student.displayName}</h2>
            <p className="text-sm text-phu-sa">{t("teacher.student.joined", { date: joined })}</p>
          </div>
          <button ref={closeRef} type="button" className="min-h-11 shrink-0 font-semibold text-ngoc" onClick={onClose}>{t("teacher.student.close")}</button>
        </div>

        <section className="flex flex-col gap-2" aria-labelledby="weak-title">
          <h3 id="weak-title" className="font-semibold">{t("teacher.student.weak")}</h3>
          {student.weakConcepts.length === 0 ? (
            <p className="text-phu-sa">{t("teacher.student.weak.none")}</p>
          ) : (
            <ul className="flex flex-col">
              {weakest(student.weakConcepts).map((c) => {
                const gloss = content?.concepts.get(c.id)?.gloss;
                return (
                  <li key={c.id} className="flex items-baseline justify-between gap-3 border-t border-phu-sa/10 py-2 first:border-t-0" data-testid="weak-concept">
                    <span className="min-w-0">
                      <span lang={lang} data-target-text="" className="font-serif text-2xl">{c.vi}</span>
                      {gloss && <span className="block text-sm text-phu-sa">{l(gloss)}</span>}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-son-mai">{t("teacher.student.errorRate", { p: percent(c.errorRate) })}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="exams-title">
          <h3 id="exams-title" className="font-semibold">{t("teacher.student.exams")}</h3>
          {student.exams.length === 0 ? (
            <p className="text-phu-sa">{t("teacher.student.exams.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {student.exams.map((e) => (
                <li key={e.level} className={e.passed ? "font-semibold text-ngoc" : ""}>{examText(e)}</li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-auto flex flex-col gap-3 border-t border-phu-sa/10 pt-4">
          {error && <p role="alert" className="font-medium text-son-mai">{t("teacher.error")}</p>}
          {confirm ? (
            <Confirm id="remove-student" text={t("teacher.student.remove.confirm", { name: student.displayName })} confirmLabel={t("teacher.student.remove.do")} busy={busy} onConfirm={() => void remove()} onCancel={() => setConfirm(false)} />
          ) : (
            <button type="button" className="min-h-11 self-start font-semibold text-son-mai" onClick={() => setConfirm(true)}>{t("teacher.student.remove")}</button>
          )}
        </div>
      </aside>
    </div>
  );
}

// --- Devoirs ---------------------------------------------------------------------------

function Assignments({ detail, content, onChange, onReload }: { detail: ClassDetail; content: ContentIndex | null; onChange: (a: TeacherAssignment[]) => void; onReload: () => void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const locale = getLocale();
  const sorted = [...detail.assignments].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  const remove = async (assignmentId: string) => {
    setBusy(true);
    setError(false);
    try {
      await deleteAssignment(detail.id, assignmentId);
      onChange(detail.assignments.filter((a) => a.id !== assignmentId));
      setConfirmId(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="assignments-title" className="flex flex-col gap-4 print:hidden">
      <h2 id="assignments-title" className="font-semibold">{t("teacher.assignments")}</h2>
      {sorted.length === 0 ? (
        <p className="text-phu-sa" data-testid="assignments-empty">{t("teacher.assignments.empty")}</p>
      ) : (
        <ul className="flex flex-col border-y border-phu-sa/10">
          {sorted.map((a) => {
            const { done, total } = classCompletion(a, detail.students.length);
            const label = t("teacher.assignment.completion", { done, total });
            return (
              <li key={a.id} className="flex flex-col gap-2 border-t border-phu-sa/10 py-3 first:border-t-0" data-testid="assignment-row">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-sm text-phu-sa">
                    {a.dueDate && t("teacher.assignment.dueOn", { date: new Date(`${a.dueDate}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }) })}
                    {a.dueDate && " · "}
                    {plural("teacher.assignment.lessonCount", "teacher.assignment.lessonCount.plural", a.lessonIds.length)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1"><ProgressBar label={label} value={done} max={Math.max(1, total)} done={total > 0 && done >= total} /></div>
                  <span className="text-sm tabular-nums text-phu-sa">{label}</span>
                </div>
                {confirmId === a.id ? (
                  <Confirm id={`del-${a.id}`} text={t("teacher.assignment.delete.confirm", { title: a.title })} confirmLabel={t("teacher.assignment.delete.do")} busy={busy} onConfirm={() => void remove(a.id)} onCancel={() => setConfirmId(null)} />
                ) : (
                  <button type="button" className="min-h-11 self-start text-sm font-semibold text-son-mai" onClick={() => setConfirmId(a.id)}>{t("teacher.assignment.delete")}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="font-medium text-son-mai">{t("teacher.error")}</p>}
      {content ? <AssignmentForm classId={detail.id} content={content} onCreated={onReload} /> : <p className="text-sm text-phu-sa">{t("teacher.content.unavailable")}</p>}
    </section>
  );
}

function AssignmentForm({ classId, content, onCreated }: { classId: string; content: ContentIndex; onCreated: () => void }) {
  const today = localDay(new Date());
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [units, setUnits] = useState<Set<string>>(new Set());
  const [lessons, setLessons] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const selection = { units, lessons };
  const count = selectedLessons(content.curriculum, selection).length;
  const playable = content.curriculum.units.filter((u) => u.lessons.some((id) => content.lessons.has(id)));

  const flip = (set: Set<string>, value: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const payload = assignmentPayload(content.curriculum, title, dueDate, selection);
    if (!payload) {
      setError("teacher.assignment.missing");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createAssignment(classId, payload);
      setTitle("");
      setDueDate("");
      setUnits(new Set());
      setLessons(new Set());
      onCreated();
    } catch {
      setError("teacher.error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 border-t border-phu-sa/10 pt-4" aria-labelledby="assignment-form-title" data-testid="assignment-form">
      <h3 id="assignment-form-title" className="font-semibold">{t("teacher.assignment.new")}</h3>
      <label htmlFor="assignment-title" className="font-medium">{t("teacher.assignment.title")}</label>
      <input id="assignment-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t("teacher.assignment.titlePlaceholder")} />
      <label htmlFor="assignment-due" className="font-medium">{t("teacher.assignment.due")}</label>
      <input id="assignment-due" type="date" className={inputClass} value={dueDate} min={today} onChange={(e) => setDueDate(e.target.value)} />

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">{t("teacher.assignment.lessons")}</legend>
        {playable.map((unit) => {
          const whole = units.has(unit.id);
          const picked = unit.lessons.filter((id) => lessons.has(id)).length;
          return (
            <details key={unit.id} className="border-t border-phu-sa/10 py-1 first:border-t-0" open={picked > 0 && !whole ? true : undefined}>
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                <span>{l(unit.title)}</span>
                {(whole || picked > 0) && <span className="text-sm text-ngoc tabular-nums">{whole ? unit.lessons.length : picked}/{unit.lessons.length}</span>}
              </summary>
              <div className="flex flex-col pb-2 pl-3">
                <label className="flex min-h-11 items-center gap-3 font-semibold">
                  <input type="checkbox" className="size-5 accent-ngoc" checked={whole} onChange={() => flip(units, unit.id, setUnits)} />
                  {t("teacher.assignment.wholeUnit")}
                </label>
                {unit.lessons.map((lessonId) => {
                  const lesson = content.lessons.get(lessonId);
                  if (!lesson) return null;
                  return (
                    <label key={lessonId} className="flex min-h-11 items-center gap-3">
                      <input type="checkbox" className="size-5 accent-ngoc" checked={whole || lessons.has(lessonId)} disabled={whole} onChange={() => flip(lessons, lessonId, setLessons)} />
                      {l(lesson.title)}
                    </label>
                  );
                })}
              </div>
            </details>
          );
        })}
      </fieldset>
      <p className="text-sm text-phu-sa" aria-live="polite">{plural("teacher.assignment.selected", "teacher.assignment.selected.plural", count)}</p>
      {error && <p role="alert" className="font-medium text-son-mai">{t(error)}</p>}
      <Button type="submit" disabled={busy}>{t("teacher.assignment.create")}</Button>
    </form>
  );
}
