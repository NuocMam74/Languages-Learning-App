import { create } from "zustand";
import { getKv, setKv } from "../db.ts";

/**
 * Fiches conseils déjà lues (contrat phase16 §4).
 *
 * Une fiche ne demande rien en échange (contrat phase15 §2) et ce n'est pas ce qui change ici :
 * rien n'est noté, rien n'est envoyé au serveur, et une fiche non lue n'interdit rien. On retient
 * seulement **qu'on l'a ouverte**, pour deux usages :
 *   - la préparation d'une leçon ne repropose pas la même fiche à chaque leçon de l'unité ;
 *   - l'échelle de révision sait quel barreau réclame encore du travail.
 *
 * Stockage local, propre à la langue active (`kv` est déjà étiqueté par pack) : c'est une trace de
 * lecture sur cet appareil, pas une progression.
 */

const KEY = "guidesRead";

interface GuidesReadState {
  read: ReadonlySet<string>;
  loaded: boolean;
  load: () => Promise<void>;
  markRead: (guideId: string) => Promise<void>;
}

export const useGuidesRead = create<GuidesReadState>((set, get) => ({
  read: new Set<string>(),
  loaded: false,
  async load() {
    const ids = await getKv<string[]>(KEY, []);
    set({ read: new Set(ids), loaded: true });
  },
  async markRead(guideId) {
    const { read } = get();
    if (read.has(guideId)) return;
    const next = new Set([...read, guideId]);
    set({ read: next });
    await setKv(KEY, [...next]);
  },
}));

/** Lecture ponctuelle, hors React (la séance calcule sa fiche de préparation avant tout rendu). */
export async function readGuideIds(): Promise<Set<string>> {
  return new Set(await getKv<string[]>(KEY, []));
}

/** Marque une fiche lue sans passer par le store (séance, préparation). */
export async function markGuideRead(guideId: string): Promise<void> {
  const ids = await getKv<string[]>(KEY, []);
  if (ids.includes(guideId)) return;
  await setKv(KEY, [...ids, guideId]);
  useGuidesRead.setState({ read: new Set([...ids, guideId]) });
}
