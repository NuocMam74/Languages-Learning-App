import type { InputMethod } from "@parlo/core";
import { create } from "zustand";

/**
 * Méthode de saisie du clavier vietnamien (spec §8.4), propre à l'appareil et mémorisée :
 * un apprenant habitué au VNI ne doit pas la rechoisir à chaque exercice.
 *
 * Volontairement séparée de `prefs.ts` (langue, mode silencieux) : c'est une préférence de saisie,
 * lue seulement par les exercices écrits.
 */

const KEY = "parlo.inputMethod";

function read(): InputMethod {
  try {
    return localStorage.getItem(KEY) === "vni" ? "vni" : "telex";
  } catch {
    return "telex";
  }
}

interface MethodState {
  method: InputMethod;
  setMethod: (method: InputMethod) => void;
}

export const useInputMethod = create<MethodState>((set) => ({
  method: read(),
  setMethod(method) {
    set({ method });
    try {
      localStorage.setItem(KEY, method);
    } catch {
      // Stockage indisponible (navigation privée) : la méthode vaut pour la session.
    }
  },
}));

/** Remet la méthode par défaut (déconnexion, effacement de l'appareil). */
export function clearInputMethod(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // rien à effacer
  }
  useInputMethod.setState({ method: "telex" });
}
