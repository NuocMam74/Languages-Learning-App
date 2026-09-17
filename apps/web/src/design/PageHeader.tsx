import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "./icons.tsx";

/**
 * En-tête d'écran (contrat phase8 §1) : un retour à gauche quand il y en a un, le titre en serif,
 * les commandes à droite. Un seul dessin pour tous les écrans — le retour est toujours au même
 * endroit, de la bibliothèque aux examens.
 *
 * Aucun libellé en dur : `backLabel` et `title` viennent de `t()` chez l'appelant.
 */
export function PageHeader({ title, subtitle, back, backLabel, actions, className = "" }: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Destination du retour ; absent = pas de flèche (écran de premier niveau). */
  back?: string;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex items-start gap-3 pt-1 pb-4 ${className}`}>
      {back && (
        <Link
          to={back}
          aria-label={backLabel}
          className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-phu-sa transition-[background-color,transform] hover:bg-phu-sa/8 motion-safe:active:scale-[.98]"
        >
          <Icon name="chevronLeft" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="font-serif text-2xl leading-tight">{title}</h1>
        {subtitle && <p className="text-phu-sa">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
