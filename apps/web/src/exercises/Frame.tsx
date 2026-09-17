import type { ReactNode } from "react";

/**
 * Charpente commune aux exercices du catalogue complet (contrat phase6) : même silhouette que
 * `components/exercises.tsx` — consigne en haut, scène, contenu, action principale collée en bas,
 * à portée de pouce (spec §13). Dupliquée ici volontairement : ces vues sont chargées à la demande
 * et ne doivent pas rapatrier le module de répartition dans leur paquet.
 */
export function Frame({ prompt, stage, children, action }: { prompt: string; stage?: ReactNode; children?: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-medium text-phu-sa">{prompt}</h2>
      {stage && <div className="py-5">{stage}</div>}
      <div className="flex-1">{children}</div>
      <div className="sticky bottom-0 bg-nuoc pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{action}</div>
    </div>
  );
}

/** Carte de choix (radio) : même surface tactile et mêmes couleurs que les exercices existants. */
export function Choice({ id, selected, disabled, onSelect, children, state }: {
  id: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** Correction locale affichée après la réponse (appariement, dialogue). */
  state?: "right" | "wrong" | null;
}) {
  const colors =
    state === "right" ? "border-ngoc bg-ngoc-sang"
    : state === "wrong" ? "border-son-mai bg-son-mai/10"
    : selected ? "border-ngoc bg-ngoc-sang"
    : "border-phu-sa/15 bg-white/70";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-option-id={id}
      data-state={state ?? undefined}
      disabled={disabled === true}
      onClick={onSelect}
      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors ${colors}`}
    >
      {children}
    </button>
  );
}
