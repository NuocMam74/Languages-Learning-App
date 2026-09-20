import type { ReactNode } from "react";
import type { PassThrough } from "./primitives.tsx";
import { BlankPage, Diploma, FloatingMarket, Illustration, Lanterns, Notebook, Sampan } from "./illustrations/index.tsx";

/**
 * État vide (contrat phase8 §1) : **une illustration, une phrase, une action**. Jamais d'écran
 * blanc, jamais une liste vide muette. L'illustration est décorative (`aria-hidden`) — le titre
 * et le corps portent seuls le sens, et l'action reste atteignable au pouce.
 */

const ART = {
  /** Rien de commencé, rien à revoir : la barque attend. */
  boat: Sampan,
  /** Aucune note encore écrite. */
  notebook: Notebook,
  /** Aucune fiche, aucun résultat de recherche. */
  page: BlankPage,
  /** Aucun jeu disponible pour l'unité en cours. */
  market: FloatingMarket,
  /** Aucune série en cours. */
  lanterns: Lanterns,
  /** Aucun examen, aucun certificat. */
  diploma: Diploma,
} as const;

export function EmptyState({ art = "boat", title, body, action, compact = false, className = "", ...rest }: {
  art?: keyof typeof ART;
  title: string;
  body?: string;
  action?: ReactNode;
  /** Dans une carte déjà étroite : dessin plus petit, marges resserrées. */
  compact?: boolean;
  className?: string;
} & PassThrough) {
  const Art = ART[art];
  return (
    <div
      // Crochet stable pour l'audit visuel (e2e/design.spec.ts) : tout état vide doit se voir.
      data-empty-state={art}
      className={`flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-5 ${compact ? "py-5" : "py-7"} text-center ${className}`}
      {...rest}
    >
      <Illustration className={compact ? "max-w-[9rem]" : "max-w-[13rem]"}>
        <Art />
      </Illustration>
      {/* Un titre, pas un paragraphe : un état vide est une région de la page, et on y arrive
          souvent en naviguant de titre en titre. Le niveau 2 va sous le titre d'écran (h1). */}
      <h2 className="font-serif text-lg text-muc">{title}</h2>
      {body && <p className="max-w-[30rem] text-phu-sa">{body}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
