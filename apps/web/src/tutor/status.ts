import { create } from "zustand";
import { getTutorStatus, type TutorStatusDto } from "../api.ts";
import { getKv, setKv } from "../db.ts";
import { activePackCode } from "../packs/active.ts";

/**
 * Disponibilité de Cô Mai (contrat phase5 §5) : `GET /tutor/status?pack=`. Sans modèle configuré
 * ou sans persona pour le pack, l'app n'affiche ni la conversation ni Đối đáp (« bientôt »),
 * garde l'accueil (gabarits) et « pourquoi ? » retombe sur l'explication du contenu.
 * Dernière réponse gardée localement (lecture hors ligne) ; inconnu = comportement habituel.
 */

const KEY = "tutor.status";

interface Stored extends TutorStatusDto {
  pack: string;
  at: string;
}

interface TutorStatusState {
  pack: string | null;
  /** null = inconnu (jamais lu, API injoignable). */
  available: boolean | null;
  personaName: string | null;
  refresh: (options?: { packHasTutor?: boolean }) => Promise<void>;
}

export const useTutorStatus = create<TutorStatusState>((set) => ({
  pack: null,
  available: null,
  personaName: null,

  async refresh({ packHasTutor = true } = {}) {
    const pack = activePackCode();
    if (!packHasTutor) {
      set({ pack, available: false, personaName: null });
      return;
    }
    const cached = await getKv<Stored | null>(KEY, null).catch(() => null);
    if (cached?.pack === pack) set({ pack, available: cached.available, personaName: cached.personaName });
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    try {
      const status = await getTutorStatus(pack);
      set({ pack, available: status.available, personaName: status.personaName });
      await setKv<Stored>(KEY, { ...status, pack, at: new Date().toISOString() });
    } catch {
      // API injoignable ou route absente : on garde la dernière valeur connue.
    }
  },
}));

/** Cô Mai indisponible pour de bon (pas de modèle, pack sans persona) — pas une simple coupure réseau. */
export function tutorUnavailable(): boolean {
  return useTutorStatus.getState().available === false;
}
