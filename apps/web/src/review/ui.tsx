import type { ReactNode } from "react";
import { Link } from "react-router";
import { t } from "../i18n/index.ts";

/**
 * Briques communes aux écrans de « Réviser ». Volontairement minces et sans couleur inventée :
 * la palette (spec §13) et les rayons restent ceux du reste de l'app, et la passe esthétique à
 * venir n'aura qu'un endroit à reprendre.
 */

/** En-tête d'une page de la bibliothèque : retour à portée de pouce, titre en serif. */
export function LibraryHeader({ title, to = "/reviser", label }: { title: string; to?: string; label?: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <Link to={to} aria-label={label ?? t("review.back")} className="grid size-11 shrink-0 place-items-center rounded-full text-phu-sa hover:bg-phu-sa/5">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
      </Link>
      <h1 className="font-serif text-2xl">{title}</h1>
    </div>
  );
}

type ChipTone = "neutral" | "due" | "hard" | "mastered" | "new";

const CHIP: Record<ChipTone, string> = {
  neutral: "bg-phu-sa/10 text-phu-sa",
  due: "bg-ngoc-sang text-ngoc",
  hard: "bg-son-mai/12 text-son-mai",
  mastered: "bg-ngoc text-nuoc",
  new: "bg-nghe/20 text-phu-sa",
};

export function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-xl px-2.5 py-1 text-sm font-medium ${CHIP[tone]}`}>{children}</span>;
}

/** Jamais de liste vide muette (contrat phase8 §1) : une phrase et, si possible, une action. */
export function EmptyState({ title, body, action, testId }: { title: string; body: string; action?: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-phu-sa/10 bg-white/60 px-5 py-6" data-testid={testId}>
      <p className="font-serif text-lg">{title}</p>
      <p className="text-phu-sa">{body}</p>
      {action}
    </div>
  );
}

/** Champ de filtre étiqueté (select natif : clavier, lecteur d'écran et pouce y gagnent). */
export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-phu-sa">
      {label}
      {children}
    </label>
  );
}

export const SELECT_CLASS = "min-h-11 w-full rounded-xl border-2 border-phu-sa/15 bg-white/80 px-3 text-base text-muc";

/** Titre de groupe (unité) : discret, il structure sans crier. */
export function GroupTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 mb-2 text-sm font-semibold tracking-normal text-phu-sa">{children}</h2>;
}
