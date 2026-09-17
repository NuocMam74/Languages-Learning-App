import type { ReactNode } from "react";
import { PageHeader, SectionTitle, type IconName } from "../design/index.ts";
import { t } from "../i18n/index.ts";

/**
 * Briques communes aux écrans de « Réviser ». Depuis la passe esthétique elles ne font plus que
 * **déléguer au système de design** (`src/design/`) : le jeton et l'état vide de la bibliothèque
 * ont disparu au profit de `Chip` et `EmptyState`, et l'en-tête reprend le `PageHeader` commun —
 * un rayon ne doit pas avoir l'air d'un écran d'une autre application.
 */

/** En-tête d'un rayon : le retour est au même endroit que sur tous les autres écrans. */
export function LibraryHeader({ title, to = "/reviser", label, subtitle }: {
  title: string;
  to?: string;
  label?: string;
  subtitle?: ReactNode;
}) {
  return <PageHeader title={title} back={to} backLabel={label ?? t("review.back")} subtitle={subtitle} />;
}

/** Champ de filtre étiqueté (select natif : clavier, lecteur d'écran et pouce y gagnent). */
export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 basis-36 flex-col gap-1 text-sm text-phu-sa">
      {label}
      {children}
    </label>
  );
}

/** Surface d'un contrôle de filtre : même rayon, même ligne et même fond que les cartes. */
export const SELECT_CLASS = "min-h-11 w-full rounded-field border border-line-strong bg-surface px-3 text-base text-muc";

/** Même surface, pour un champ de recherche (16 px au moins : iOS ne zoome pas à la mise au point). */
export const SEARCH_CLASS = "min-h-12 w-full rounded-field border border-line-strong bg-surface px-4 text-base text-muc";

/** Titre de groupe (unité) : il structure sans crier, le poids visuel reste au contenu. */
export function GroupTitle({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <SectionTitle className="mt-6 mb-2" {...(icon ? { icon } : {})}>
      {children}
    </SectionTitle>
  );
}

/**
 * Entrée en cascade d'une liste : **six éléments au plus** (contrat §1). Au-delà, le décalage se
 * lirait comme un chargement lent — les éléments suivants apparaissent simplement posés.
 */
export const enter = (index: number): { stagger?: number } => (index < 6 ? { stagger: index } : {});
