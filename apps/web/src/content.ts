import { buildContentIndex, type ContentIndex, type Pack, type RawPackFiles } from "@parlo/core";
import { db, type StoredPack } from "./db.ts";
import { activePackCode, setActivePackLang } from "./packs/active.ts";

declare const __PACKS__: Record<string, number>;

export function packBaseUrl(code: string, version: number): string {
  return `/content/${code}/v${version}/`;
}

export function mediaUrl(content: ContentIndex, path: string): string {
  return packBaseUrl(content.pack.code, content.pack.version) + path;
}

/** Clé IndexedDB d'un bundle téléchargé mais pas encore appliqué (une séance de l'ancienne version est en cours). */
export const pendingKey = (code: string) => `${code}#pending`;

/** Fichiers bruts déjà chargés (examens, placement, jeux lus sans nouvel aller-retour). */
const loaded = new Map<string, RawPackFiles>();

export function cachedPackFiles(code: string = activePackCode()): RawPackFiles | null {
  return loaded.get(code) ?? null;
}

/** Bundle ancien (sans index des médias) : aucun média connu (contrat phase5 §1). */
function normalize(files: RawPackFiles): RawPackFiles {
  return files.mediaIndex ? files : { ...files, mediaIndex: [] };
}

/** Une séance commencée sur l'ancienne version de ce pack est-elle en cours ? */
async function blocksUpdate(code: string, stored: StoredPack | undefined): Promise<boolean> {
  const snapshot = await db().snapshot.get(code);
  if (!snapshot || !stored) return false;
  const version = snapshot.session?.contentVersion ?? snapshot.contentVersion;
  // Snapshot sans version : commencé sur la version stockée.
  return version === undefined || version === stored.version;
}

/** Applique un bundle en attente si aucune séance de l'ancienne version ne l'empêche. */
async function promotePending(code: string, stored: StoredPack | undefined): Promise<StoredPack | undefined> {
  const pending = await db().packs.get(pendingKey(code));
  if (!pending) return stored;
  if (await blocksUpdate(code, stored)) return stored;
  await db().transaction("rw", db().packs, async () => {
    await db().packs.put({ ...pending, code });
    await db().packs.delete(pendingKey(code));
  });
  return { ...pending, code };
}

/**
 * Fichiers d'un pack, hors ligne d'abord :
 * 1. IndexedDB si une version ≥ celle du build y est (mise à jour de contenu comprise) ;
 * 2. sinon réseau (ou cache du service worker), puis enregistrement local ;
 * 3. sans réseau, repli sur n'importe quelle version locale.
 */
async function loadPackFiles(code: string, fetchImpl: typeof fetch): Promise<RawPackFiles> {
  const expected = __PACKS__[code];
  const stored = await promotePending(code, await db().packs.get(code));
  // Bundle d'avant le contrat phase5 (sans index des médias ni examens) : on le relit si possible.
  const fresh = stored?.files.mediaIndex !== undefined;
  if (stored && fresh && (expected === undefined || stored.version >= expected)) return normalize(stored.files);

  try {
    if (expected === undefined) throw new Error(`Pack inconnu : ${code}`);
    const files = await fetchBundle(`${packBaseUrl(code, expected)}bundle.json`, fetchImpl);
    await db().packs.put({ code, version: files.pack.version, files, fetchedAt: new Date().toISOString() });
    return files;
  } catch (error) {
    if (stored) return normalize(stored.files);
    throw error;
  }
}

async function fetchBundle(url: string, fetchImpl: typeof fetch): Promise<RawPackFiles> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return normalize((await res.json()) as RawPackFiles);
}

/** Contenu du pack demandé (par défaut le pack actif, ADR 0006). */
export async function loadPack(code: string = activePackCode(), fetchImpl: typeof fetch = fetch): Promise<ContentIndex> {
  const files = await loadPackFiles(code, fetchImpl);
  loaded.set(code, files);
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

/** Fichiers bruts du pack (chargés au besoin). */
export async function packFiles(code: string = activePackCode(), fetchImpl: typeof fetch = fetch): Promise<RawPackFiles | null> {
  const cached = loaded.get(code);
  if (cached) return cached;
  try {
    const files = await loadPackFiles(code, fetchImpl);
    loaded.set(code, files);
    return files;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mise à jour du contenu sans rebuild (contrat phase5 §6)

interface ManifestDto {
  code: string;
  version: number;
  baseUrl?: string;
}

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "/api";

async function readManifest(code: string, fetchImpl: typeof fetch): Promise<ManifestDto | null> {
  for (const url of [`${API_BASE}/courses/${encodeURIComponent(code)}/manifest`, `/content/${code}/latest.json`]) {
    try {
      const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) continue;
      const body = (await res.json()) as Partial<ManifestDto>;
      if (typeof body.version === "number") return { code, version: body.version, ...(typeof body.baseUrl === "string" ? { baseUrl: body.baseUrl } : {}) };
    } catch {
      // Hors ligne ou API absente : on essaie la source suivante.
    }
  }
  return null;
}

export type ContentUpdate = "none" | "applied" | "pending";

/**
 * Lit le manifeste du pack ; si la version publiée diffère de la version locale, télécharge le
 * nouveau bundle. Appliqué tout de suite, sauf si une séance de l'ancienne version est en cours
 * (elle reste reprenable) : le bundle attend alors la fin de cette séance.
 */
export async function checkContentUpdate(code: string = activePackCode(), fetchImpl: typeof fetch = fetch): Promise<ContentUpdate> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "none";
  const manifest = await readManifest(code, fetchImpl);
  if (!manifest) return "none";
  const stored = await db().packs.get(code);
  const localVersion = stored?.version ?? __PACKS__[code];
  if (localVersion === manifest.version) return "none";
  const pending = await db().packs.get(pendingKey(code));
  if (pending?.version === manifest.version) return "pending";

  const base = manifest.baseUrl ? manifest.baseUrl.replace(/\/?$/, "/") : packBaseUrl(code, manifest.version);
  let files: RawPackFiles;
  try {
    files = await fetchBundle(`${base}bundle.json`, fetchImpl);
  } catch {
    if (!manifest.baseUrl) return "none";
    try {
      files = await fetchBundle(`${packBaseUrl(code, manifest.version)}bundle.json`, fetchImpl);
    } catch {
      return "none";
    }
  }
  const row: StoredPack = { code, version: files.pack.version, files, fetchedAt: new Date().toISOString() };
  if (await blocksUpdate(code, stored)) {
    await db().packs.put({ ...row, code: pendingKey(code) });
    return "pending";
  }
  await db().packs.put(row);
  loaded.set(code, files);
  return "applied";
}
