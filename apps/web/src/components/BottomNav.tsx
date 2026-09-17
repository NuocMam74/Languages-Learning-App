import { lazy, Suspense, type ReactNode } from "react";
import { Outlet, NavLink, useLocation } from "react-router";
import { Icon, type IconName } from "../design/index.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { useCelebrations } from "../rewards/celebrate.ts";

/**
 * Les félicitations peuvent tomber sur n'importe quel écran (fin de séance, fin de partie,
 * mission réclamée) : leur calque vit donc ici, au-dessus de toutes les routes. Chargé à la
 * demande — tant que rien n'est gagné, il ne coûte rien (contrat phase9 §5).
 */
const CelebrationLayer = lazy(() => import("../rewards/Celebration.tsx").then((m) => ({ default: m.CelebrationLayer })));

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
  /** Icône du jeu unique (design/icons.tsx) : plus aucun tracé recopié ici. */
  icon: IconName;
}

const DESTINATIONS: Destination[] = [
  // Toit et porte : l'accueil.
  { to: "/", label: "nav.home", icon: "home" },
  // Une barque sur le fleuve : le parcours.
  { to: "/apprendre", label: "nav.learn", icon: "boat" },
  // Un carnet ouvert : la bibliothèque de révision (contrat phase8 §4 ; les jeux restent dans « Apprendre »).
  { to: "/reviser", label: "nav.review", icon: "book" },
  // Une silhouette : le profil.
  { to: "/profil", label: "nav.profile", icon: "user" },
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
  // Les félicitations s'affichent même sur un écran de concentration : la fin de séance en est un.
  const celebrating = useCelebrations((s) => s.queue.length > 0);
  return (
    <div className={focused ? undefined : NAV_HEIGHT}>
      {children ?? <Outlet />}
      {!focused && <BottomNav pathname={pathname} />}
      {celebrating && (
        <Suspense fallback={null}>
          <CelebrationLayer />
        </Suspense>
      )}
    </div>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label={t("nav.label")}
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line-strong bg-nuoc/92 pb-[env(safe-area-inset-bottom)] backdrop-blur"
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
                {/* Destination courante : une pastille jade derrière l'icône — plus lisible qu'un simple gras. */}
                {/* Hauteur identique à l'ancienne icône (24 px) : `--parlo-nav` reste juste, rien ne se décale. */}
                <span className={`grid h-6 w-11 place-items-center rounded-full transition-colors ${active ? "bg-ngoc-sang" : ""}`}>
                  <Icon name={destination.icon} size={20} strokeWidth={active ? 2.2 : 1.7} />
                </span>
                <span>{t(destination.label)}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
