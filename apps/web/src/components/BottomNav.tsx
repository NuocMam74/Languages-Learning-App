import type { ReactNode } from "react";
import { Outlet, NavLink, useLocation } from "react-router";
import { t, type MessageKey } from "../i18n/index.ts";

/**
 * Navigation basse (contrat phase7 §1) : visible sur les écrans « de séjour » (accueil, parcours,
 * jeux, profil), masquée pendant une séance, un examen ou une partie — rien ne doit distraire
 * pendant qu'on répond. Jamais un menu caché (spec §3.4) : quatre destinations, toujours là.
 *
 * Cibles ≥ 44 px, `aria-current="page"` (posé par `NavLink`), zone de pouce, safe-area basse.
 *
 * Hauteur : la barre est `fixed`, et `Shell` publie sa hauteur dans `--parlo-nav`. `Screen` s'en
 * sert pour sa marge basse et pour poser son action principale juste au-dessus — la hauteur est
 * une constante CSS, connue dès le premier rendu : rien ne se décale (CLS).
 */

const NAV_HEIGHT = "[--parlo-nav:calc(3.5rem+env(safe-area-inset-bottom))]";

interface Destination {
  to: string;
  label: MessageKey;
  /** Icône au trait (spec §13 : pas d'emoji), tracée sur une grille 24×24. */
  icon: string;
}

const DESTINATIONS: Destination[] = [
  // Toit et porte : l'accueil.
  { to: "/", label: "nav.home", icon: "M4 11.5 12 5l8 6.5M6.5 10.5V19h11v-8.5M10.5 19v-4.5h3V19" },
  // Une barque sur le fleuve : le parcours.
  { to: "/apprendre", label: "nav.learn", icon: "M4 15.5c2.5 1.6 4.5 1.6 7 0s4.5-1.6 7 0M5.5 12h13l-2 3.2h-9zM12 12V5l5 5.5" },
  // Un carnet ouvert : la bibliothèque de révision (contrat phase8 §4 ; les jeux restent dans « Apprendre »).
  { to: "/reviser", label: "nav.review", icon: "M12 7.5C10.5 6 8.5 5.5 5 5.5V18c3.5 0 5.5.5 7 2 1.5-1.5 3.5-2 7-2V5.5c-3.5 0-5.5.5-7 2M12 7.5V20" },
  // Une silhouette : le profil.
  { to: "/profil", label: "nav.profile", icon: "M12 5.5a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4M5.5 19c.8-3.2 3.4-4.8 6.5-4.8s5.7 1.6 6.5 4.8" },
];

/** Écrans de concentration : séance, leçon, révision, examen, partie, placement, premier lancement. */
const FOCUSED =
  /^\/(seance|revision|lecon\/|examens\/|jeux\/|placement|onboarding|bienvenue|langue|co-mai\/|bilan-semaine|express|studio|prof|compte|connexion|verifier\/|defi\/|partage\/|classe\/)/;

export function isFocusedRoute(pathname: string): boolean {
  return FOCUSED.test(pathname);
}

/**
 * Cadre commun des routes : la barre basse et la hauteur qu'elle réserve. Sur un écran de
 * concentration, ni barre ni réserve — la page retrouve exactement la mise en page d'avant.
 */
export function Shell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const focused = isFocusedRoute(pathname);
  return (
    <div className={focused ? undefined : NAV_HEIGHT}>
      {children ?? <Outlet />}
      {!focused && <BottomNav pathname={pathname} />}
    </div>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label={t("nav.label")}
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-phu-sa/10 bg-nuoc/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex w-full max-w-[480px] md:max-w-[720px]">
        {DESTINATIONS.map((destination) => {
          // « Apprendre » reste allumé pendant tout le parcours de la langue (carte, révisions…).
          const active = destination.to === "/" ? pathname === "/" : pathname === destination.to || pathname.startsWith(`${destination.to}/`);
          return (
            <li key={destination.to} className="flex-1">
              <NavLink
                to={destination.to}
                end={destination.to === "/"}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-sm ${active ? "font-semibold text-ngoc" : "text-phu-sa"}`}
              >
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={destination.icon} />
                </svg>
                <span>{t(destination.label)}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
