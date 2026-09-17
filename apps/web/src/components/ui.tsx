import type { ButtonHTMLAttributes, ReactNode } from "react";
import { activePackLang } from "../packs/active.ts";

/**
 * Écran une colonne, action principale en bas, à portée de pouce (spec §13).
 *
 * `--parlo-nav` : hauteur de la navigation basse quand elle est visible (components/BottomNav.tsx),
 * 0 sur les écrans de concentration. La page réserve cette place et l'action principale se pose
 * juste au-dessus de la barre — valeur CSS constante, connue dès le premier rendu (pas de CLS).
 *
 * Le fond de page n'est pas peint ici : `body::before` (design/tokens.css) pose la texture d'eau
 * derrière tout l'écran. Seule la bande d'action est opaque, pour que le contenu passe dessous.
 */
export function Screen({ children, action, top }: { children: ReactNode; action?: ReactNode; top?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[var(--parlo-nav,0px)] pl-[max(1.25rem,env(safe-area-inset-left))] md:max-w-[720px]">
      {top}
      <main className="flex flex-1 flex-col py-4">{children}</main>
      {action && (
        <div className="sticky bottom-[var(--parlo-nav,0px)] border-t border-line bg-nuoc pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{action}</div>
      )}
    </div>
  );
}

type Variant = "primary" | "quiet" | "outline" | "reward";

/**
 * Bouton. Le micro-retour de pression (scale 0.98) est le même partout (contrat phase8 §1) et ne
 * retarde jamais le clic : c'est une transformation, pas une attente.
 */
export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-ngoc text-nuoc shadow-card hover:bg-ngoc/90 disabled:bg-phu-sa/25 disabled:text-phu-sa/60 disabled:shadow-none",
    quiet: "bg-transparent text-ngoc underline-offset-4 hover:underline",
    outline: "border-2 border-ngoc bg-surface text-ngoc hover:bg-ngoc-sang/50",
    reward: "bg-nghe text-muc shadow-card hover:bg-nghe/90",
  };
  return (
    <button
      type="button"
      className={`min-h-14 w-full rounded-card px-6 text-lg font-semibold transition-[background-color,transform,box-shadow] duration-150 motion-safe:active:scale-[.98] ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

/** Texte de la langue apprise mis en valeur : c'est l'objet visuel, pas une étiquette. `lang` = celle du pack actif. */
export function Vi({ children, size = "vi", className = "" }: { children: ReactNode; size?: "vi" | "vi-xl" | "2xl"; className?: string }) {
  const sizes = { vi: "text-vi", "vi-xl": "text-vi-xl", "2xl": "text-2xl" };
  return (
    <span lang={activePackLang() ?? undefined} data-target-text="" className={`font-serif ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
}
