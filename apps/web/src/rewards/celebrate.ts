import { create } from "zustand";
import { readDisplayName } from "../profile/identity.ts";
import type { Celebration } from "./store.ts";

/**
 * File des félicitations (contrat phase9 §5) : les gains se montrent **un par un**, dans l'ordre
 * décidé par le magasin (`sortCelebrations`), et jamais empilés les uns sur les autres.
 *
 * La file vit en mémoire : une félicitation manquée (onglet fermé) n'est pas rejouée au prochain
 * lancement — le gain, lui, est déjà enregistré. Montrer trois jours de récompenses au démarrage
 * serait une punition déguisée.
 */

interface CelebrationStore {
  queue: Celebration[];
  /** Nom du profil, lu une fois : les cartes s'adressent à la personne (contrat §5). */
  name: string | null;
  celebrate: (list: readonly Celebration[]) => void;
  dismiss: () => void;
  clear: () => void;
  /** Tests : remet la file et le nom à zéro. */
  reset: () => void;
}

export const useCelebrations = create<CelebrationStore>((set, get) => ({
  queue: [],
  name: null,
  celebrate(list) {
    if (list.length === 0) return;
    set({ queue: [...get().queue, ...list] });
    // Le nom n'est lu qu'au premier besoin, et gardé ensuite.
    if (get().name === null) void readDisplayName().then((name) => name && set({ name }));
  },
  dismiss() {
    set({ queue: get().queue.slice(1) });
  },
  clear() {
    set({ queue: [] });
  },
  reset() {
    set({ queue: [], name: null });
  },
}));

/** Raccourci : à appeler avec ce que rend `awardActivity` / `claimMission`. */
export const celebrate = (list: readonly Celebration[]): void => useCelebrations.getState().celebrate(list);
