import type { Localized, Pack } from "@parlo/core";
import { useEffect, useState } from "react";
import { useAccount } from "../account.ts";
import { loadPackInfo } from "../content.ts";
import { activePackCode, availablePacks } from "./active.ts";

export interface PackChoice {
  code: string;
  /** Nom tiré du pack.json ; null tant qu'il n'est pas chargé (ou hors ligne sans copie locale). */
  name: Localized | null;
}

/** Rôles qui voient les packs en préparation (`comingSoon`, contrat phase5 §5). */
const PREVIEW_ROLES: ReadonlySet<string> = new Set(["editor", "admin"]);

export function canPreviewPacks(roles: readonly string[] | undefined): boolean {
  return import.meta.env.DEV || (roles ?? []).some((r) => PREVIEW_ROLES.has(r));
}

/**
 * Packs jouables de ce build, avec leur nom lu dans les données du pack (aucun nom de
 * langue dans le code). Un pack `comingSoon` n'est proposé qu'en développement et aux rôles
 * editor/admin (le pack actif reste toujours listé). Le pack déjà chargé donne son nom immédiatement.
 */
export function usePackChoices(loaded?: Pack): PackChoice[] {
  const roles = useAccount((s) => s.account?.roles);
  const preview = canPreviewPacks(roles);
  const nameOf = (code: string) => (loaded && code === loaded.code ? loaded.name : null);
  const [infos, setInfos] = useState<{ code: string; name: Localized | null; comingSoon: boolean }[]>(() =>
    // Tant que pack.json n'est pas lu, un pack est traité comme « en préparation » (pas de clignotement).
    availablePacks().map((code) => ({ code, name: nameOf(code), comingSoon: loaded?.code === code ? loaded.comingSoon === true : true })),
  );

  useEffect(() => {
    let live = true;
    void Promise.all(
      availablePacks().map(async (code) => {
        const info = loaded && code === loaded.code ? loaded : await loadPackInfo(code);
        return { code, name: info?.name ?? null, comingSoon: info ? info.comingSoon === true : true };
      }),
    ).then((next) => live && setInfos(next));
    return () => {
      live = false;
    };
  }, [loaded]);

  return infos.filter((p) => preview || !p.comingSoon || p.code === activePackCode()).map(({ code, name }) => ({ code, name }));
}
