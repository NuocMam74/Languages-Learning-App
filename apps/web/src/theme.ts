import { usePrefs, type ThemeChoice } from "./prefs.ts";

/**
 * Thème clair / sombre (contrat phase9 §8).
 *
 * Le choix vit dans les préférences de l'appareil (localStorage, lecture synchrone) et s'applique
 * **avant le premier rendu** : `installTheme()` est appelé par `main.tsx`, donc aucun écran ne
 * s'allume en blanc avant de devenir sombre.
 *
 * Deux choses sont publiées sur `<html>` :
 *  - `data-theme="dark|light"` quand le choix est explicite — les jetons de `design/tokens.css`
 *    s'y accrochent ; rien n'est publié en mode « système », où `prefers-color-scheme` décide seul ;
 *  - `color-scheme`, pour que les ascenseurs, les champs et les menus natifs suivent.
 */

/** Couleur de la barre d'état (`<meta name="theme-color">`) : jade en clair, fond sombre en sombre. */
const THEME_COLOR = { light: "#0E5E55", dark: "#0C1614" } as const;

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Thème réellement affiché, une fois « système » résolu. */
export function resolvedTheme(choice: ThemeChoice = usePrefs.getState().theme): "light" | "dark" {
  if (choice !== "system") return choice;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(choice: ThemeChoice = usePrefs.getState().theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolvedTheme(choice);
  if (choice === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = choice;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[resolved]);
  // iOS : barre d'état claire sur fond sombre (le contenu garde ses marges sûres).
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute("content", resolved === "dark" ? "black-translucent" : "default");
}

let installed = false;

/** À appeler une fois, avant le premier rendu. Suit ensuite le choix et le réglage de l'appareil. */
export function installTheme(): void {
  if (installed) return;
  installed = true;
  applyTheme();
  usePrefs.subscribe((state, previous) => {
    if (state.theme !== previous.theme) applyTheme(state.theme);
  });
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    // Le téléphone passe en sombre le soir : l'app suit, sans rechargement, si le choix est « système ».
    window.matchMedia(DARK_QUERY).addEventListener("change", () => {
      if (usePrefs.getState().theme === "system") applyTheme("system");
    });
  }
}
