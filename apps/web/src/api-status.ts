import { create } from "zustand";
import { getHealth, isApiUnavailable } from "./api.ts";

/**
 * Y a-t-il une API derrière cette installation ? (README § Déploiement, scénario A)
 *
 * Le dépôt se déploie de deux façons : la PWA seule, en statique — et c'est le cas aujourd'hui —
 * ou la PWA **avec** son API. Sans API, il n'y a ni compte ni synchronisation, et tout l'écran de
 * création de compte mène à un mur. Proposer « Crée un compte pour retrouver ta progression sur
 * tous tes appareils » dans ce cas, c'est promettre ce qu'on ne peut pas tenir.
 *
 * Alors on demande une fois, au démarrage, et les écrans qui offrent un compte s'adaptent : ils
 * renvoient vers « Changer d'appareil », qui, lui, fonctionne entièrement hors ligne.
 *
 * **Optimiste par défaut.** Tant qu'on n'a pas la preuve du contraire, l'API est réputée présente :
 * une installation qui en a une ne doit rien voir changer, et être hors ligne n'est pas une preuve
 * — seul un `api_unavailable` franc (le 404 de `apps/web/worker.js`) fait basculer.
 */

export type ApiPresence = "unknown" | "present" | "absent";

interface ApiStatusState {
  presence: ApiPresence;
  /** Les écrans qui offrent un compte : vrai tant qu'on n'a pas la preuve qu'il n'y a pas d'API. */
  accountsPossible: () => boolean;
  probe: () => Promise<void>;
}

export const useApiStatus = create<ApiStatusState>((set, get) => ({
  presence: "unknown",

  accountsPossible: () => get().presence !== "absent",

  async probe() {
    if (get().presence !== "unknown") return;
    // Hors ligne : on ne conclut rien. La sonde repartira au prochain démarrage.
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    try {
      await getHealth();
      set({ presence: "present" });
    } catch (error) {
      set({ presence: isApiUnavailable(error) ? "absent" : "unknown" });
    }
  },
}));

/**
 * Raccourci pour les écrans : peut-on encore parler de compte à l'apprenant ?
 *
 * Tout écran qui dit « crée un compte » doit passer par là. Sans serveur, la phrase n'a aucun sens
 * et le lien mène à un formulaire mort.
 */
export const useAccountsPossible = (): boolean => useApiStatus((s) => s.accountsPossible)();
