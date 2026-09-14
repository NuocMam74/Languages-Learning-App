import { buildContentIndex, type ContentIndex, type RawPackFiles } from "@parlo/core";
import { db } from "./db.ts";

declare const __PACKS__: Record<string, number>;

export const ACTIVE_PACK = "vi-south";

export function packBaseUrl(code: string, version: number): string {
  return `/content/${code}/v${version}/`;
}

export function mediaUrl(content: ContentIndex, path: string): string {
  return packBaseUrl(content.pack.code, content.pack.version) + path;
}

/**
 * Contenu d'un pack, hors ligne d'abord :
 * 1. IndexedDB si la version attendue y est déjà ;
 * 2. sinon réseau (ou cache du service worker), puis enregistrement local ;
 * 3. sans réseau, repli sur n'importe quelle version locale.
 */
export async function loadPack(code = ACTIVE_PACK, fetchImpl: typeof fetch = fetch): Promise<ContentIndex> {
  const expected = __PACKS__[code];
  const stored = await db().packs.get(code);
  if (stored && stored.version === expected) return buildContentIndex(stored.files);

  try {
    if (expected === undefined) throw new Error(`Pack inconnu : ${code}`);
    const res = await fetchImpl(`${packBaseUrl(code, expected)}bundle.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files = (await res.json()) as RawPackFiles;
    await db().packs.put({ code, version: files.pack.version, files, fetchedAt: new Date().toISOString() });
    return buildContentIndex(files);
  } catch (error) {
    if (stored) return buildContentIndex(stored.files);
    throw error;
  }
}
