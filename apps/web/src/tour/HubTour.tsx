import { DEFAULT_DAILY_GOAL_MIN } from "../learner.ts";
import { useLocation, useNavigate } from "react-router";
import { t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";
import { GuidedTour, type TourStep } from "./GuidedTour.tsx";

/**
 * La visite de l'écran du parcours (contrat phase26 §8) : qui la lance, et ce qu'elle montre.
 *
 * Elle s'ouvre d'elle-même **une fois**, au premier passage sur le parcours après l'onboarding
 * (`discoveredAt` encore vide), et à la demande ensuite : bouton « ? » de l'accueil, ou « Revoir
 * la visite » dans les Réglages — tous deux arrivent ici avec `state.tour`.
 */

/** Demande explicite de visite, portée par la navigation. */
export const TOUR_STATE = { tour: true } as const;

export function useTourRequested(): boolean {
  const location = useLocation();
  const discovered = usePrefs((s) => s.discoveredAt);
  const asked = (location.state as { tour?: unknown } | null)?.tour === true;
  return asked || discovered === null;
}

/** Barre basse : un onglet par sa destination. */
const tab = (to: string) => `[data-tour="tabs"] a[href="${to}"]`;

function steps(goalMin: number): TourStep[] {
  return [
    { key: "welcome", target: null, title: t("tour.welcome.title"), body: t("tour.welcome.body") },
    { key: "session", target: ['[data-tour="daily"]', '[data-tour="goal"]'], title: t("discovery.session.title"), body: t("discovery.session.body", { n: goalMin }) },
    { key: "path", target: '[data-tour="path"]', title: t("discovery.path.title"), body: t("discovery.path.body") },
    { key: "review", target: tab("/reviser"), title: t("discovery.review.title"), body: t("discovery.review.body") },
    { key: "memo", target: tab("/reviser"), title: t("discovery.memo.title"), body: t("discovery.memo.body") },
    { key: "stats", target: tab("/statistiques"), title: t("discovery.stats.title"), body: t("discovery.stats.body") },
    { key: "help", target: '[data-tour="help"]', title: t("tour.help.title"), body: t("tour.help.body") },
    { key: "offline", target: null, title: t("discovery.offline.title"), body: t("discovery.offline.body") },
  ];
}

export function HubTour({ goalMin }: { goalMin: number | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const setDiscovered = usePrefs((s) => s.setDiscovered);
  const close = () => {
    setDiscovered(new Date().toISOString());
    // L'état `tour` est consommé : revenir sur l'écran ne relance pas la visite.
    if ((location.state as { tour?: unknown } | null)?.tour === true) navigate(location.pathname, { replace: true, state: null });
  };
  return <GuidedTour steps={steps(goalMin ?? DEFAULT_DAILY_GOAL_MIN)} onClose={close} />;
}
