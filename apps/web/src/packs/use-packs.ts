import type { Localized, Pack } from "@parlo/core";
import { useEffect, useState } from "react";
import { loadPackInfo } from "../content.ts";
import { availablePacks } from "./active.ts";

export interface PackChoice {
  code: string;
  /** Nom tiré du pack.json ; null tant qu'il n'est pas chargé (ou hors ligne sans copie locale). */
  name: Localized | null;
}

/**
 * Packs jouables de ce build, avec leur nom lu dans les données du pack (aucun nom de
 * langue dans le code). Le pack déjà chargé, s'il est fourni, donne son nom immédiatement.
 */
export function usePackChoices(loaded?: Pack): PackChoice[] {
  const nameOf = (code: string) => (loaded && code === loaded.code ? loaded.name : null);
  const [choices, setChoices] = useState<PackChoice[]>(() => availablePacks().map((code) => ({ code, name: nameOf(code) })));

  useEffect(() => {
    let live = true;
    void Promise.all(availablePacks().map(async (code) => ({ code, name: nameOf(code) ?? (await loadPackInfo(code))?.name ?? null }))).then(
      (next) => live && setChoices(next),
    );
    return () => {
      live = false;
    };
  }, [loaded]);

  return choices;
}
