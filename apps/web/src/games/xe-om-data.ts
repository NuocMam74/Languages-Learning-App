import type { ContentIndex, XeOmData } from "@parlo/core";
import { useEffect, useState } from "react";
import { cachedPackFiles, packFiles } from "../content.ts";

/**
 * Données de Xe ôm (cartes, itinéraires) : fichier du pack content/<pack>/games/xe_om.json,
 * validé en CI (npm run content:validate) et livré dans le bundle du pack (contrat phase5 §6),
 * donc jouable hors ligne et mis à jour sans rebuild.
 */

export async function loadXeOmData(packCode: string): Promise<XeOmData | null> {
  const files = cachedPackFiles(packCode) ?? (await packFiles(packCode));
  return files?.games?.xe_om ?? null;
}

/** undefined = chargement, null = pas de données pour ce pack. */
export function useXeOmData(content: ContentIndex): XeOmData | null | undefined {
  const [data, setData] = useState<XeOmData | null | undefined>(() => cachedPackFiles(content.pack.code)?.games?.xe_om);
  useEffect(() => {
    let live = true;
    void loadXeOmData(content.pack.code).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [content.pack.code]);
  return data;
}
