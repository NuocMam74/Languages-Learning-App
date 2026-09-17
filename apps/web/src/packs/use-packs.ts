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

/**
 * Aperçu des packs en préparation : réservé aux rôles editor/admin, ou activé à la main
 * (`?packs=preview`, mémorisé). Le développement seul ne suffit pas : un pack en préparation
 * ne doit jamais apparaître à un apprenant, même sur un serveur de développement.
 */
const PREVIEW_FLAG = "parlo.previewPacks";

function previewFlag(): boolean {
  try {
    const asked = new URLSearchParams(window.location.search).get("packs");
    if (asked === "preview") localStorage.setItem(PREVIEW_FLAG, "1");
    if (asked === "off") localStorage.removeItem(PREVIEW_FLAG);
    return localStorage.getItem(PREVIEW_FLAG) === "1";
  } catch {
    return false;
  }
}

export function canPreviewPacks(roles: readonly string[] | undefined): boolean {
  return previewFlag() || (roles ?? []).some((r) => PREVIEW_ROLES.has(r));
}

/**
 * Packs jouables de ce build, avec leur nom lu dans les données du pack (aucun nom de
 * langue dans le code). Un pack `comingSoon` n'est proposé qu'en développement et aux rôles
 * editor/admin (le pack actif reste toujours listé). Le pack déjà chargé donne son nom immédiatement.
 */
interface PackInfo {
  code: string;
  name: Localized | null;
  comingSoon: boolean;
}

/**
 * Noms des packs déjà lus (pack.json) : la liste part complète au premier rendu, sans ligne qui
 * apparaît après coup (CLS des Réglages, audit mobile P1 #4).
 */
const infoCache = new Map<string, PackInfo>();

async function readInfo(code: string, loaded?: Pack): Promise<PackInfo> {
  const info = loaded && code === loaded.code ? loaded : await loadPackInfo(code);
  return { code, name: info?.name ?? null, comingSoon: info ? info.comingSoon === true : true };
}

/** Précharge les noms des packs (appelé par les Réglages avant d'afficher la page). */
export async function preloadPackChoices(loaded?: Pack): Promise<void> {
  const infos = await Promise.all(availablePacks().map((code) => readInfo(code, loaded)));
  for (const info of infos) infoCache.set(info.code, info);
}

export function usePackChoices(loaded?: Pack): PackChoice[] {
  const roles = useAccount((s) => s.account?.roles);
  const preview = canPreviewPacks(roles);
  const nameOf = (code: string) => (loaded && code === loaded.code ? loaded.name : null);
  const [infos, setInfos] = useState<PackInfo[]>(() =>
    // Déjà lus (preloadPackChoices) : liste définitive d'emblée. Sinon un pack est traité comme
    // « en préparation » tant que son pack.json n'est pas lu (pas de clignotement).
    availablePacks().map(
      (code) => infoCache.get(code) ?? { code, name: nameOf(code), comingSoon: loaded?.code === code ? loaded.comingSoon === true : true },
    ),
  );

  useEffect(() => {
    let live = true;
    void Promise.all(availablePacks().map((code) => readInfo(code, loaded))).then((next) => {
      for (const info of next) infoCache.set(info.code, info);
      if (live) setInfos(next);
    });
    return () => {
      live = false;
    };
  }, [loaded]);

  return infos.filter((p) => preview || !p.comingSoon || p.code === activePackCode()).map(({ code, name }) => ({ code, name }));
}
