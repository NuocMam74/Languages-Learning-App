import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import { discardDraft, getDocument, saveDraft, type DocKind, type DraftInfo, type StudioDocument } from "./studio-api.ts";
import { useStudio } from "./store.ts";
import { templateFor } from "./templates.ts";

/**
 * Document ouvert dans l'éditeur : copie de travail, enregistrement automatique du brouillon
 * (anti-rebond), conflit 409 (quelqu'un d'autre a enregistré entre-temps) et abandon du brouillon.
 */

export type SaveState = "loading" | "clean" | "dirty" | "saving" | "saved" | "error" | "conflict" | "load_error";

export const AUTOSAVE_MS = 1200;

/** NFC partout, récursivement (le validateur refuse toute chaîne non NFC). */
export function normalizeDeep<T>(value: T): T {
  if (typeof value === "string") return value.normalize("NFC") as T;
  if (Array.isArray(value)) return value.map(normalizeDeep) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeDeep(v)])) as T;
  }
  return value;
}

export function useDocument(code: string, kind: DocKind, id: string) {
  const [doc, setDoc] = useState<StudioDocument | null>(null);
  const [data, setDataState] = useState<unknown>(null);
  const [state, setState] = useState<SaveState>("loading");
  const [theirs, setTheirs] = useState<DraftInfo | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const base = useRef<string | null>(null);
  const latest = useRef<unknown>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const setWorking = useStudio((s) => s.setWorking);
  const refreshTree = useStudio((s) => s.refreshTree);

  const apply = useCallback(
    (next: unknown) => {
      latest.current = next;
      setDataState(next);
      setWorking({ kind, id, data: next });
    },
    [kind, id, setWorking],
  );

  /** `silent` : relecture sans repasser par l'écran de chargement (après un envoi audio). */
  const load = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    try {
      const d = await getDocument(code, kind, id);
      setDoc(d);
      base.current = d.draft?.updatedAt ?? null;
      setSavedAt(d.draft?.updatedAt ?? null);
      apply(d.draft?.data ?? d.published ?? templateFor(kind, id, code));
      dirty.current = false;
      setState("clean");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Nouveau document : ni publié ni brouillon.
        setDoc({ kind, id, published: null, draft: null });
        base.current = null;
        apply(templateFor(kind, id, code));
        dirty.current = false;
        setState("clean");
      } else {
        setState("load_error");
      }
    }
  }, [code, kind, id, apply]);

  const save = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current) await inFlight.current;
    if (!dirty.current) return;
    const payload = latest.current;
    dirty.current = false;
    setState("saving");
    const run = (async () => {
      try {
        const { updatedAt } = await saveDraft(code, kind, id, payload, base.current);
        base.current = updatedAt;
        setSavedAt(updatedAt);
        setDoc((d) => (d ? { ...d, draft: { data: payload, updatedAt, updatedBy: d.draft?.updatedBy ?? "" } } : d));
        setState(dirty.current ? "dirty" : "saved");
        void refreshTree();
      } catch (error) {
        dirty.current = true;
        if (error instanceof ApiError && error.status === 409) {
          try {
            const fresh = await getDocument(code, kind, id);
            setTheirs(fresh.draft);
          } catch {
            setTheirs(null);
          }
          setState("conflict");
        } else {
          setState("error");
        }
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
  }, [code, kind, id, refreshTree]);

  const setData = useCallback(
    (next: unknown) => {
      apply(normalizeDeep(next));
      dirty.current = true;
      setState((s) => (s === "conflict" ? s : "dirty"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (stateRef.current !== "conflict") void save();
      }, AUTOSAVE_MS);
    },
    [apply, save],
  );

  /** Conflit : garder ma version (écrase la leur) ou prendre la leur. */
  const resolveConflict = useCallback(
    async (choice: "mine" | "theirs") => {
      if (choice === "theirs") {
        base.current = theirs?.updatedAt ?? null;
        apply(theirs?.data ?? doc?.published ?? templateFor(kind, id, code));
        dirty.current = false;
        setSavedAt(theirs?.updatedAt ?? null);
        setTheirs(null);
        setState("clean");
        return;
      }
      base.current = theirs?.updatedAt ?? null;
      setTheirs(null);
      dirty.current = true;
      setState("dirty");
      await save();
    },
    [theirs, doc, apply, save, kind, id, code],
  );

  const discard = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    try {
      await discardDraft(code, kind, id);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        setState("error");
        return;
      }
    }
    await load();
    void refreshTree();
  }, [code, kind, id, load, refreshTree]);

  useEffect(() => {
    void load();
  }, [load]);

  // En quittant le document : on enregistre ce qui ne l'est pas encore.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current && stateRef.current !== "conflict") {
        void saveDraft(code, kind, id, latest.current, base.current).catch(() => undefined);
      }
    },
    [code, kind, id],
  );

  return { doc, data, state, savedAt, theirs, setData, save, discard, resolveConflict, reload: load };
}
