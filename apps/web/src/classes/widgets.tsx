import type { ReactNode } from "react";
import { getLocale, t } from "../i18n/index.ts";
import { dueWhen } from "./assignments.ts";

/** « aujourd'hui », « demain », « vendredi », « le 3 octobre ». */
export function whenLabel(dueDate: string, today: string): string {
  const when = dueWhen(dueDate, today, getLocale());
  switch (when.kind) {
    case "today":
      return t("classes.due.today");
    case "tomorrow":
      return t("classes.due.tomorrow");
    case "weekday":
      return t("classes.due.weekday", { weekday: when.weekday });
    case "date":
      return t("classes.due.date", { date: when.date });
  }
}

/** Petits éléments partagés par l'espace enseignant et les classes côté élève. */

export const inputClass = "min-h-12 w-full rounded-xl border-2 border-phu-sa/20 bg-white px-4 text-lg focus:border-ngoc focus:outline-none";
export const linkButton = "min-h-11 self-start py-2 font-semibold text-ngoc";
export const primaryLink = "grid min-h-14 place-items-center rounded-2xl bg-ngoc px-6 text-lg font-semibold text-nuoc";

export function Explain({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <p className="text-lg">{text}</p>
      {children}
    </div>
  );
}

/** Confirmation en ligne (pas de fenêtre modale) : destructif en laque, annulation discrète. */
export function Confirm({ id, text, confirmLabel, onConfirm, onCancel, busy = false }: { id: string; text: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <div className="flex flex-col gap-3 border-l-4 border-son-mai pl-3 print:hidden" role="alertdialog" aria-labelledby={id}>
      <p id={id}>{text}</p>
      <div className="flex flex-wrap gap-4">
        <button type="button" disabled={busy} className="min-h-11 rounded-xl bg-son-mai px-4 font-semibold text-white disabled:opacity-60" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="min-h-11 text-ngoc" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

export function ProgressBar({ label, value, max, done = false }: { label: string; value: number; max: number; done?: boolean }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-phu-sa/10 print:border print:border-phu-sa/40" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <div className={`h-full rounded-full ${done ? "bg-nghe" : "bg-ngoc"}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
