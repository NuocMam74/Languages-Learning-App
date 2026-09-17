import { buildContentIndex, type ContentIndex, type RawPackFiles } from "@parlo/core";
import { create } from "zustand";
import { loadFullPack } from "../content.ts";
import { getStudioTree, type DocKind, type StudioTree } from "./studio-api.ts";
import { overlayAll, rawFromIndex } from "./validation.ts";

/**
 * État du studio pour le pack ouvert : fichiers publiés (bundle du pack, chargeur de l'app),
 * arbre du serveur, et copies de travail des documents ouverts pendant la session
 * (superposées au publié pour la validation croisée et l'aperçu).
 */

export interface WorkingCopy {
  kind: DocKind;
  id: string;
  data: unknown;
}

interface StudioState {
  code: string | null;
  raw: RawPackFiles | null;
  rawStatus: "idle" | "loading" | "ready" | "missing";
  tree: StudioTree | null;
  treeStatus: "idle" | "loading" | "ready" | "error";
  working: Record<string, WorkingCopy>;
  open: (code: string) => void;
  refreshTree: () => Promise<void>;
  setWorking: (copy: WorkingCopy) => void;
  dropWorking: (kind: DocKind, id: string) => void;
}

export const workingKey = (kind: DocKind, id: string) => `${kind}:${id}`;

export const useStudio = create<StudioState>((set, get) => ({
  code: null,
  raw: null,
  rawStatus: "idle",
  tree: null,
  treeStatus: "idle",
  working: {},

  open(code) {
    if (get().code === code) return;
    set({ code, raw: null, rawStatus: "loading", tree: null, treeStatus: "idle", working: {} });
    loadFullPack(code)
      .then((index) => get().code === code && set({ raw: rawFromIndex(index), rawStatus: "ready" }))
      .catch(() => get().code === code && set({ rawStatus: "missing" }));
    void get().refreshTree();
  },

  async refreshTree() {
    const code = get().code;
    if (!code) return;
    set({ treeStatus: get().tree ? "ready" : "loading" });
    try {
      const tree = await getStudioTree(code);
      if (get().code === code) set({ tree, treeStatus: "ready" });
    } catch {
      if (get().code === code) set({ treeStatus: "error" });
    }
  },

  setWorking(copy) {
    set({ working: { ...get().working, [workingKey(copy.kind, copy.id)]: copy } });
  },

  dropWorking(kind, id) {
    const working = { ...get().working };
    delete working[workingKey(kind, id)];
    set({ working });
  },
}));

/** Pack publié + toutes les copies de travail, sauf éventuellement celle qu'on valide (elle est superposée par l'appelant). */
export function rawWithWorking(raw: RawPackFiles, working: Record<string, WorkingCopy>, except?: { kind: DocKind; id: string }): RawPackFiles {
  const others = Object.values(working).filter((w) => !except || w.kind !== except.kind || w.id !== except.id);
  return overlayAll(raw, others);
}

export function contentWithWorking(raw: RawPackFiles, working: Record<string, WorkingCopy>): ContentIndex {
  return buildContentIndex(rawWithWorking(raw, working));
}
