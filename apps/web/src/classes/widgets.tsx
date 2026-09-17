import type { ReactNode } from "react";
import { ProgressBar as DesignProgressBar } from "../design/index.ts";
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

/**
 * Petits éléments partagés par l'espace enseignant et les classes côté élève. Ils ne réinventent
 * rien : ils nomment, une seule fois, les habillages du système de design (champ, lien, action).
 */

export const inputClass = "min-h-12 w-full rounded-field border border-line-strong bg-surface px-4 text-lg focus:border-ngoc focus:outline-none";
export const linkButton = "flex min-h-11 items-center gap-1.5 self-start rounded-chip px-2 py-2 font-semibold text-ngoc hover:bg-ngoc/8";
export const primaryLink =
  "grid min-h-14 place-items-center rounded-card bg-ngoc px-6 text-lg font-semibold text-nuoc shadow-card transition-[background-color,transform] hover:bg-ngoc/90 motion-safe:active:scale-[.98]";

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
    <div className="rounded-card border border-son-mai/25 bg-surface-son-mai px-5 py-4 print:hidden" role="alertdialog" aria-labelledby={id}>
      <div className="flex flex-col gap-3">
        <p id={id}>{text}</p>
        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-chip bg-son-mai px-4 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98] disabled:opacity-60"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="button" className="min-h-11 rounded-chip px-3 font-semibold text-ngoc hover:bg-ngoc/8" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Barre d'avancement d'un devoir. Elle délègue au système de design (remplissage 400 ms, nom
 * accessible obligatoire) et n'ajoute qu'un filet visible à l'impression du tableau de classe.
 */
export function ProgressBar({ label, value, max, done = false }: { label: string; value: number; max: number; done?: boolean }) {
  return <DesignProgressBar label={label} value={value} max={max} tone={done ? "nghe" : "ngoc"} className="print:border print:border-phu-sa/40" />;
}
