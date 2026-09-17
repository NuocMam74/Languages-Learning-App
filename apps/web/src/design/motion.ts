import type { CSSProperties } from "react";

/**
 * Mouvement (contrat phase8 §1). Trois règles, appliquées partout :
 *  1. le mouvement ne retarde **jamais** une entrée (aucune animation ne bloque un clic) ;
 *  2. tout est sous `motion-safe:` ou passe par `prefersReducedMotion()` ;
 *  3. un seul moment « héroïque » par écran — les micro-retours ne comptent pas.
 */

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/**
 * Transition d'écran : `document.startViewTransition` quand le navigateur l'a (Chromium, Safari 18+),
 * sinon la navigation se fait telle quelle. Le rendu est **toujours** exécuté : jamais d'écran figé
 * si l'API échoue.
 */
export function withViewTransition(run: () => void): void {
  const start = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition;
  if (typeof start !== "function" || prefersReducedMotion()) {
    run();
    return;
  }
  try {
    const transition = start.call(document, run);
    void transition.finished.catch(() => undefined);
  } catch {
    run();
  }
}

/**
 * Retard d'entrée en cascade : 40 ms par cran, six éléments au plus (au-delà, la liste se lit
 * comme un chargement lent). À passer en `style={staggerStyle(i)}` avec `motion-safe:parlo-enter`.
 */
export function staggerStyle(index: number): CSSProperties {
  return { "--parlo-stagger": `${Math.min(index, 5) * 40}ms` } as CSSProperties;
}
