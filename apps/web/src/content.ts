import { buildContentIndex, type ContentIndex, type Pack, type RawPackFiles } from "@parlo/core";
import { db } from "./db.ts";
import { activePackCode, setActivePackLang } from "./packs/active.ts";

declare const __PACKS__: Record<string, number>;

export function packBaseUrl(code: string, version: number): string {
  return `/content/${code}/v${version}/`;
}

export function mediaUrl(content: ContentIndex, path: string): string {
  return packBaseUrl(content.pack.code, content.pack.version) + path;
}

/**
 * Fichiers d'un pack, hors ligne d'abord :
 * 1. IndexedDB si la version attendue y est déjà ;
 * 2. sinon réseau (ou cache du service worker), puis enregistrement local ;
 * 3. sans réseau, repli sur n'importe quelle version locale.
 */
async function loadPackFiles(code: string, fetchImpl: typeof fetch): Promise<RawPackFiles> {
  const expected = __PACKS__[code];
  const stored = await db().packs.get(code);
  if (stored && stored.version === expected) return stored.files;

  try {
    if (expected === undefined) throw new Error(`Pack inconnu : ${code}`);
    const res = await fetchImpl(`${packBaseUrl(code, expected)}bundle.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files = (await res.json()) as RawPackFiles;
    await db().packs.put({ code, version: files.pack.version, files, fetchedAt: new Date().toISOString() });
    return files;
  } catch (error) {
    if (stored) return stored.files;
    throw error;
  }
}

/** Contenu du pack demandé (par défaut le pack actif, ADR 0006). */
export async function loadPack(code: string = activePackCode(), fetchImpl: typeof fetch = fetch): Promise<ContentIndex> {
  const files = await loadPackFiles(code, fetchImpl);
  if (code === activePackCode()) setActivePackLang(files.pack.lang);
  return buildContentIndex(files);
}

/** Métadonnées d'un pack (nom, fonctionnalités) pour le choix de la langue ; null si indisponible hors ligne. */
export async function loadPackInfo(code: string, fetchImpl: typeof fetch = fetch): Promise<Pack | null> {
  try {
    return (await loadPackFiles(code, fetchImpl)).pack;
  } catch {
    return null;
  }
}
