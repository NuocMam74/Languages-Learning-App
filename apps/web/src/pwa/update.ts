import { create } from "zustand";

/**
 * Mise à jour du service worker (registerType "prompt") : une nouvelle version attend,
 * la page l'annonce et ne l'active que sur demande, hors séance (UpdatePrompt).
 */

interface UpdateState {
  needRefresh: boolean;
  apply: (() => Promise<void>) | null;
  offer: (apply: () => Promise<void>) => void;
}

export const usePwaUpdate = create<UpdateState>((set) => ({
  needRefresh: false,
  apply: null,
  offer: (apply) => set({ needRefresh: true, apply }),
}));

/**
 * Écrans où un rechargement ferait perdre le fil (séance, examen, jeu, conversation, onboarding) :
 * la mise à jour attend le bilan ou le retour au hub.
 */
const BUSY_PATHS = /^\/(seance|revision|lecon\/|examens\/[^/]+(\/blanc)?$|jeux\/[^/]+$|co-mai\/|express$|placement$|onboarding$|defi\/)/;
const SESSION_PATHS = /^\/(seance|revision|lecon\/)/;

/** `inSession` : un exercice est affiché (au bilan ou sur une séance vide, recharger ne coupe rien). */
export function canReloadNow(pathname: string, inSession: boolean): boolean {
  if (SESSION_PATHS.test(pathname)) return !inSession;
  return !BUSY_PATHS.test(pathname);
}
