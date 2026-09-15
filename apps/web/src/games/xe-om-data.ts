import type { ContentIndex, XeOmData } from "@parlo/core";
import { useEffect, useState } from "react";

/**
 * Données de Xe ôm (cartes, itinéraires) : fichier du pack
 * content/<pack>/games/xe_om.json, validé en CI (npm run content:validate).
 * Importé dynamiquement : un petit chunk JS à part, précaché par le service
 * worker comme le reste de l'app, donc jouable hors ligne.
 */

const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  "vi-south": () => import("../../../../content/vi-south/games/xe_om.json"),
};

const cache = new Map<string, Promise<XeOmData | null>>();

export function loadXeOmData(packCode: string): Promise<XeOmData | null> {
  let pending = cache.get(packCode);
  if (!pending) {
    const loader = loaders[packCode];
    pending = loader
      ? loader().then(
          (m) => m.default as XeOmData,
          () => {
            cache.delete(packCode);
            return null;
          },
        )
      : Promise.resolve(null);
    cache.set(packCode, pending);
  }
  return pending;
}

/** undefined = chargement, null = pas de données pour ce pack. */
export function useXeOmData(content: ContentIndex): XeOmData | null | undefined {
  const [data, setData] = useState<XeOmData | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadXeOmData(content.pack.code).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [content.pack.code]);
  return data;
}
