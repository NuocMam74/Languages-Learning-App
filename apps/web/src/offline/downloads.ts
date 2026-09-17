import { unitDownloadBytes, type ContentIndex, type UnitId } from "@parlo/core";
import { create } from "zustand";
import { getUnit, onContentUpdateApplied, packBaseUrl } from "../content.ts";
import { db, offlineKey, type OfflineUnitRow } from "../db.ts";
import { cacheForPath } from "./cache-names.ts";
import { DEFAULT_OFFLINE_QUOTA_BYTES, selectLruPurge } from "./lru.ts";

/**
 * « Disponible hors ligne » (spec §8.1) : une unité téléchargée explicitement = son fichier JSON
 * (IndexedDB) + ses médias présents (Cache Storage, servis par le service worker). Quota audio
 * (200 Mo par défaut) avec purge LRU, jamais l'unité en cours. Stockage persistant demandé au
 * premier téléchargement.
 */

/** Surcharge du quota (tests e2e, réglage avancé) : `localStorage["parlo.offlineQuotaBytes"]`. */
export function offlineQuotaBytes(): number {
  try {
    const raw = Number(globalThis.localStorage?.getItem("parlo.offlineQuotaBytes"));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OFFLINE_QUOTA_BYTES;
  } catch {
    return DEFAULT_OFFLINE_QUOTA_BYTES;
  }
}

export interface Progress {
  done: number;
  total: number;
}

interface OfflineState {
  rows: Record<string, OfflineUnitRow>;
  progress: Record<string, Progress>;
  refresh: (code: string) => Promise<void>;
}

export const useOffline = create<OfflineState>((set) => ({
  rows: {},
  progress: {},
  async refresh(code) {
    const rows = await db().offlineUnits.where("code").equals(code).toArray();
    set((s) => ({ rows: { ...Object.fromEntries(Object.entries(s.rows).filter(([, r]) => r.code !== code)), ...Object.fromEntries(rows.map((r) => [r.key, r])) } }));
  },
}));

function setProgress(key: string, progress: Progress | null): void {
  useOffline.setState((s) => {
    const next = { ...s.progress };
    if (progress) next[key] = progress;
    else delete next[key];
    return { progress: next };
  });
}

/** Taille annoncée avant téléchargement (JSON de l'unité + médias présents). */
export function unitSize(content: ContentIndex, unitId: UnitId): number | null {
  const entry = content.split?.units.get(unitId);
  return entry ? unitDownloadBytes(entry) : null;
}

let persistAsked = false;

/** Stockage persistant (le navigateur ne purge plus le contenu hors ligne sous pression). */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.persist) return false;
  try {
    if (await storage.persisted?.()) return true;
    if (persistAsked) return false;
    persistAsked = true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.estimate) return null;
  try {
    const [estimate, persisted] = await Promise.all([storage.estimate(), storage.persisted?.() ?? Promise.resolve(false)]);
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
  } catch {
    return null;
  }
}

const hasCaches = () => typeof caches !== "undefined";

async function cacheMedia(url: string, path: string): Promise<number> {
  if (!hasCaches()) return 0;
  const cache = await caches.open(cacheForPath(path));
  const hit = await cache.match(url);
  if (hit) return Number(hit.headers.get("content-length") ?? 0) || (await hit.clone().blob()).size;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  const size = Number(res.headers.get("content-length") ?? 0) || (await res.clone().blob()).size;
  await cache.put(url, res);
  return size;
}

async function uncacheMedia(code: string, version: number, paths: readonly string[], keepPaths: ReadonlySet<string> = new Set()): Promise<void> {
  if (!hasCaches()) return;
  for (const path of paths) {
    if (keepPaths.has(`${version}:${path}`)) continue;
    const cache = await caches.open(cacheForPath(path));
    await cache.delete(packBaseUrl(code, version) + path);
  }
}

const running = new Map<string, Promise<OfflineUnitRow>>();

/**
 * Télécharge une unité pour le hors ligne (JSON + médias), puis applique le quota.
 * `protect` : unités à ne jamais purger (unité en cours).
 */
export function downloadUnit(code: string, version: number, unit: UnitId, options: { protect?: readonly UnitId[] } = {}): Promise<OfflineUnitRow> {
  const key = offlineKey(code, unit);
  const already = running.get(key);
  if (already) return already;
  const task = (async () => {
    const at = new Date().toISOString();
    const previous = await db().offlineUnits.get(key);
    await db().offlineUnits.put({ key, code, unit, version, status: "downloading", bytes: previous?.bytes ?? 0, media: previous?.media ?? [], downloadedAt: previous?.downloadedAt ?? at, lastUsedAt: at });
    await useOffline.getState().refresh(code);
    void requestPersistentStorage();
    try {
      const file = await getUnit(code, version, unit);
      const total = 1 + file.media.length;
      let done = 1;
      let bytes = new TextEncoder().encode(JSON.stringify(file)).length;
      setProgress(key, { done, total });
      const queue = [...file.media];
      const worker = async () => {
        for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
          bytes += await cacheMedia(packBaseUrl(code, version) + path, path);
          done++;
          setProgress(key, { done, total });
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      // Ancienne version téléchargée : ses médias laissent la place à la nouvelle.
      if (previous && previous.version !== version) await uncacheMedia(code, previous.version, previous.media);
      const row: OfflineUnitRow = { key, code, unit, version, status: "ready", bytes, media: file.media, downloadedAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() };
      await db().offlineUnits.put(row);
      await enforceOfflineQuota(code, [...(options.protect ?? []), unit]);
      return row;
    } catch (error) {
      await db().offlineUnits.update(key, { status: "error" });
      throw error;
    } finally {
      setProgress(key, null);
      await useOffline.getState().refresh(code);
    }
  })().finally(() => running.delete(key));
  running.set(key, task);
  return task;
}

/** Retire une unité du hors ligne : médias (sauf ceux d'une autre unité téléchargée) et fichier JSON. */
export async function removeOfflineUnit(code: string, unit: UnitId): Promise<void> {
  const key = offlineKey(code, unit);
  const row = await db().offlineUnits.get(key);
  if (!row) return;
  const others = await db().offlineUnits.where("code").equals(code).filter((r) => r.key !== key && r.status === "ready").toArray();
  const keep = new Set(others.flatMap((r) => r.media.map((p) => `${r.version}:${p}`)));
  await uncacheMedia(code, row.version, row.media, keep);
  await db().offlineUnits.delete(key);
  await db().units.where("code").equals(code).filter((u) => u.unit === unit).delete();
  await useOffline.getState().refresh(code);
}

/** Quota dépassé : purge des unités les moins récemment utilisées (hors unités protégées). Renvoie les unités retirées. */
export async function enforceOfflineQuota(code: string, protect: readonly UnitId[] = [], quota = offlineQuotaBytes()): Promise<UnitId[]> {
  const rows = (await db().offlineUnits.toArray()).filter((r) => r.status === "ready");
  const protectedKeys = new Set(protect.map((u) => offlineKey(code, u)));
  const purge = selectLruPurge(rows, quota, protectedKeys);
  const removed: UnitId[] = [];
  for (const key of purge) {
    const row = rows.find((r) => r.key === key);
    if (!row) continue;
    await removeOfflineUnit(row.code, row.unit);
    removed.push(row.unit);
  }
  return removed;
}

/** Nouvelle version appliquée : les unités téléchargées sont retéléchargées (en ligne), sinon gardées pour plus tard. */
export async function refreshOfflineUnits(code: string, version: number): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const rows = await db().offlineUnits.where("code").equals(code).filter((r) => r.version !== version).toArray();
  for (const row of rows) {
    try {
      await downloadUnit(code, version, row.unit);
    } catch {
      // Unité disparue de la nouvelle version, ou réseau coupé : on réessaiera au prochain démarrage.
    }
  }
}

let listening = false;

/** À appeler une fois au démarrage : suit les mises à jour de contenu. */
export function startOfflineMaintenance(content: ContentIndex): void {
  if (!listening) {
    listening = true;
    onContentUpdateApplied((code, version) => void refreshOfflineUnits(code, version));
  }
  void refreshOfflineUnits(content.pack.code, content.pack.version);
}
