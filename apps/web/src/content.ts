import {
  addUnitToIndex,
  buildSplitContentIndex,
  isCoreFile,
  isUnitFile,
  missingUnits,
  splitPack,
  unitsForLessons,
  unitsOfConcepts,
  type ConceptId,
  type ContentIndex,
  type CoreFile,
  type LessonId,
  type Pack,
  type RawPackFiles,
  type UnitFile,
  type UnitId,
} from "@parlo/core";
import { db, offlineKey, unitKey, type StoredPack } from "./db.ts";
import { activePackCode, setActivePackLang } from "./packs/active.ts";

declare const __PACKS__: Record<string, number>;

/**
 * Contenu d'un pack, hors ligne d'abord (ADR 0004), livré en deux temps (audit mobile P1 #6) :
 * `core.json` au démarrage (hub, planification, examens, placement, jeux), puis
 * `units/<unitId>.json` à la demande (`ensureUnits`), gardés dans IndexedDB par version.
 */

export function packBaseUrl(code: string, version: number): string {
  return `/content/${code}/v${version}/`;
}

export function mediaUrl(content: ContentIndex, path: string): string {
  return packBaseUrl(content.pack.code, content.pack.version) + path;
}

/** Clé IndexedDB d'un contenu téléchargé mais pas encore appliqué (une séance de l'ancienne version est en cours). */
export const pendingKey = (code: string) => `${code}#pending`;

/** Données d'un pack hors leçons (examens, placement, jeux) : lues sans nouvel aller-retour. */
export interface PackFiles {
  pack: Pack;
  curriculum: CoreFile["curriculum"];
  mediaIndex: readonly string[];
  exams: CoreFile["exams"];
  placement: CoreFile["placement"];
  games: CoreFile["games"];
}

const loaded = new Map<string, PackFiles>();
/** fetch utilisé pour charger le pack (tests : fetch simulé), réutilisé pour ses unités. */
const fetchers = new Map<string, typeof fetch>();
/** Base des fichiers par `code@version` (manifeste de l'API). */
const baseUrls = new Map<string, string>();

const filesOf = (core: CoreFile): PackFiles => ({
  pack: core.pack, curriculum: core.curriculum, mediaIndex: core.mediaIndex, exams: core.exams, placement: core.placement, games: core.games,
});

export function cachedPackFiles(code: string = activePackCode()): PackFiles | null {
  return loaded.get(code) ?? null;
}

/** Bundle ancien (sans index des médias) : aucun média connu (contrat phase5 §1). */
function normalize(files: RawPackFiles): RawPackFiles {
  return files.mediaIndex ? files : { ...files, mediaIndex: [] };
}

const now = () => new Date().toISOString();

/** Découpe un bundle complet et range ses unités (ancien serveur, ancien stockage local). */
async function storeSplit(code: string, files: RawPackFiles): Promise<CoreFile> {
  const { core, units } = splitPack(normalize(files));
  const fetchedAt = now();
  await db().units.bulkPut(units.map((data) => ({ key: unitKey(code, core.pack.version, data.unit), code, version: core.pack.version, unit: data.unit, data, fetchedAt })));
  return core;
}

/** Core d'une ligne stockée ; un ancien bundle est découpé et réécrit (les unités restent disponibles hors ligne). */
async function coreOf(row: StoredPack, key: string = row.code): Promise<CoreFile | null> {
  if (row.core) return row.core;
  if (!row.files) return null;
  const core = await storeSplit(row.code.replace(/#pending$/, ""), row.files);
  const { files: _files, ...rest } = row;
  await db().packs.put({ ...rest, code: key, core });
  return core;
}

/** Une séance commencée sur l'ancienne version de ce pack est-elle en cours ? */
async function blocksUpdate(code: string, stored: StoredPack | undefined): Promise<boolean> {
  const snapshot = await db().snapshot.get(code);
  if (!snapshot || !stored) return false;
  const version = snapshot.session?.contentVersion ?? snapshot.contentVersion;
  // Snapshot sans version : commencé sur la version stockée.
  return version === undefined || version === stored.version;
}

/** Unités d'autres versions : supprimées (la version active et celle en attente restent). */
async function pruneUnits(code: string, keep: readonly number[]): Promise<void> {
  await db().units.where("code").equals(code).filter((row) => !keep.includes(row.version)).delete();
}

/** Applique un contenu en attente si aucune séance de l'ancienne version ne l'empêche. */
async function promotePending(code: string, stored: StoredPack | undefined): Promise<StoredPack | undefined> {
  const pending = await db().packs.get(pendingKey(code));
  if (!pending) return stored;
  if (await blocksUpdate(code, stored)) return stored;
  await db().transaction("rw", db().packs, async () => {
    await db().packs.put({ ...pending, code });
    await db().packs.delete(pendingKey(code));
  });
  onContentApplied(code, pending.version);
  return { ...pending, code };
}

async function readJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** core.json de la version ; à défaut (serveur d'avant le découpage), bundle.json découpé localement. */
async function fetchCore(code: string, base: string, fetchImpl: typeof fetch): Promise<CoreFile> {
  let body: unknown = null;
  try {
    body = await readJson(`${base}core.json`, fetchImpl);
  } catch {
    body = null;
  }
  if (isCoreFile(body)) return body;
  const files = (body && typeof body === "object" && Array.isArray((body as RawPackFiles).lessons) ? body : await readJson(`${base}bundle.json`, fetchImpl)) as RawPackFiles;
  return storeSplit(code, files);
}

/**
 * Core d'un pack, hors ligne d'abord :
 * 1. IndexedDB si une version ≥ celle du build y est (mise à jour de contenu comprise) ;
 * 2. sinon réseau (ou cache du service worker), puis enregistrement local ;
 * 3. sans réseau, repli sur n'importe quelle version locale.
 */
async function loadCore(code: string, fetchImpl: typeof fetch): Promise<CoreFile> {
  const expected = __PACKS__[code];
  const stored = await promotePending(code, await db().packs.get(code));
  if (stored?.baseUrl) baseUrls.set(`${code}@${stored.version}`, stored.baseUrl);
  // Bundle d'avant le contrat phase5 (sans index des médias ni examens) : on le relit si possible.
  const fresh = stored?.core !== undefined || stored?.files?.mediaIndex !== undefined;
  if (stored && fresh && (expected === undefined || stored.version >= expected)) {
    const core = await coreOf(stored);
    if (core) return core;
  }

  try {
    if (expected === undefined) throw new Error(`Pack inconnu : ${code}`);
    const core = await fetchCore(code, packBaseUrl(code, expected), fetchImpl);
    await db().packs.put({ code, version: core.pack.version, core, fetchedAt: now() });
    return core;
  } catch (error) {
    const core = stored ? await coreOf(stored) : null;
    if (core) return core;
    throw error;
  }
}

/** Contenu du pack demandé (par défaut le pack actif, ADR 0006) : leçons en résumé tant que leur unité n'est pas chargée. */
export async function loadPack(code: string = activePackCode(), fetchImpl: typeof fetch = fetch): Promise<ContentIndex> {
  const core = await loadCore(code, fetchImpl);
  loaded.set(code, filesOf(core));
  fetchers.set(code, fetchImpl);
  if (code === activePackCode()) setActivePackLang(core.pack.lang);
  // Unités des versions périmées : retirées au chargement suivant (jamais sous une séance en cours de cette exécution).
  void db().packs.get(pendingKey(code)).then((pending) => pruneUnits(code, [core.pack.version, ...(pending ? [pending.version] : [])])).catch(() => undefined);
  return buildSplitContentIndex(core);
}

/** Pack complet, toutes unités chargées (studio : validation croisée de tous les documents). */
export async function loadFullPack(code: string = activePackCode(), fetchImpl: typeof fetch = fetch): Promise<ContentIndex> {
  const index = await loadPack(code, fetchImpl);
  await ensureUnits(index, index.split ? [...index.split.units.keys()] : []);
  return index;
}

/** Un contenu est-il déjà sur l'appareil (démarrage sans réseau possible) ? */
export async function hasLocalContent(code: string = activePackCode()): Promise<boolean> {
  return (await db().packs.get(code)) !== undefined;
}

/** Métadonnées d'un pack (nom, fonctionnalités) pour le choix de la langue ; null si indisponible hors ligne. */
export async function loadPackInfo(code: string, fetchImpl: typeof fetch = fetch): Promise<Pack | null> {
  try {
    return (loaded.get(code) ?? filesOf(await loadCore(code, fetchImpl))).pack;
  } catch {
    return null;
  }
}

/** Données du pack hors leçons (chargées au besoin). */
export async function packFiles(code: string = activePackCode(), fetchImpl: typeof fetch = fetch): Promise<PackFiles | null> {
  const cached = loaded.get(code);
  if (cached) return cached;
  try {
    const files = filesOf(await loadCore(code, fetchImpl));
    loaded.set(code, files);
    return files;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Unités à la demande

export class UnitUnavailableError extends Error {
  override name = "UnitUnavailableError";
  constructor(readonly units: UnitId[]) {
    super(`Unités indisponibles hors ligne : ${units.join(", ")}`);
  }
}

export function unitBaseUrl(code: string, version: number): string {
  return baseUrls.get(`${code}@${version}`) ?? packBaseUrl(code, version);
}

export function unitUrl(code: string, version: number, unit: UnitId): string {
  return `${unitBaseUrl(code, version)}units/${encodeURIComponent(unit)}.json`;
}

const inflight = new Map<string, Promise<UnitFile>>();

/** Fichier d'unité : IndexedDB, sinon réseau (puis enregistré). */
export function getUnit(code: string, version: number, unit: UnitId, fetchImpl: typeof fetch = fetchers.get(code) ?? fetch): Promise<UnitFile> {
  const key = unitKey(code, version, unit);
  const running = inflight.get(key);
  if (running) return running;
  const task = (async () => {
    const stored = await db().units.get(key);
    if (stored) return stored.data;
    const body = await readJson(unitUrl(code, version, unit), fetchImpl);
    if (!isUnitFile(body) || body.version !== version || body.unit !== unit) throw new Error(`Unité invalide : ${unit}`);
    await db().units.put({ key, code, version, unit, data: body, fetchedAt: now() });
    return body;
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/**
 * Lien direct vers une leçon : son unité se déduit de l'id (`vi-south.u01.l03` → `vi-south.u01`) et part
 * en même temps que le core, sans attendre son analyse (une attente réseau de moins au démarrage).
 */
export function warmLessonUnit(lessonId: LessonId): void {
  const [code, unit] = lessonId.split(".");
  if (!code || !unit) return;
  const version = __PACKS__[code];
  if (version === undefined) return;
  void getUnit(code, version, `${code}.${unit}`).catch(() => undefined);
}

/**
 * Charge les unités manquantes dans l'index (en place). Sans `optional`, une unité introuvable
 * (hors ligne et jamais téléchargée) lève `UnitUnavailableError`. Renvoie les unités introuvables.
 */
export async function ensureUnits(content: ContentIndex, unitIds: Iterable<UnitId>, options: { optional?: boolean } = {}): Promise<UnitId[]> {
  const split = content.split;
  if (!split) return [];
  const missing = missingUnits(content, unitIds);
  const code = content.pack.code;
  const results = await Promise.allSettled(missing.map((unit) => getUnit(code, split.version, unit)));
  const failed: UnitId[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") addUnitToIndex(content, result.value);
    else failed.push(missing[i] as UnitId);
  });
  if (missing.length > 0) void touchOfflineUnits(code, missing);
  if (failed.length > 0 && !options.optional) throw new UnitUnavailableError(failed);
  return failed;
}

/** Contenu d'une séance : unités des leçons (obligatoires), puis des concepts cités et révisés (au mieux). */
export async function ensureSessionContent(content: ContentIndex, needs: { lessonIds?: readonly LessonId[]; conceptIds?: readonly ConceptId[] }): Promise<void> {
  if (!content.split) return;
  const lessonIds = needs.lessonIds ?? [];
  await ensureUnits(content, unitsForLessons(content, lessonIds));
  // Les étapes chargées révèlent les distracteurs et l'audio d'autres unités.
  await ensureUnits(content, [...unitsForLessons(content, lessonIds), ...unitsOfConcepts(content, needs.conceptIds ?? [])], { optional: true });
}

/** Dernier usage des unités hors ligne (purge LRU). */
async function touchOfflineUnits(code: string, units: readonly UnitId[]): Promise<void> {
  try {
    const at = now();
    await db().offlineUnits.bulkUpdate(units.map((unit) => ({ key: offlineKey(code, unit), changes: { lastUsedAt: at } })));
  } catch {
    // Base fermée (tests) : sans importance.
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
      const res = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store" });
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

type AppliedListener = (code: string, version: number) => void;
const appliedListeners = new Set<AppliedListener>();

/** Nouvelle version appliquée (unités hors ligne à retélécharger). */
export function onContentUpdateApplied(listener: AppliedListener): () => void {
  appliedListeners.add(listener);
  return () => appliedListeners.delete(listener);
}

function onContentApplied(code: string, version: number): void {
  for (const listener of appliedListeners) listener(code, version);
}

/**
 * Lit le manifeste du pack ; si la version publiée diffère de la version locale, télécharge le
 * nouveau core (les unités suivront à la demande). Appliqué tout de suite, sauf si une séance de
 * l'ancienne version est en cours (elle reste reprenable, ses unités restent en local) : le contenu
 * attend alors la fin de cette séance.
 */
export async function checkContentUpdate(code: string = activePackCode(), fetchImpl: typeof fetch = fetch, busy: () => boolean = () => false): Promise<ContentUpdate> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "none";
  const manifest = await readManifest(code, fetchImpl);
  if (!manifest) return "none";
  const stored = await db().packs.get(code);
  const localVersion = stored?.version ?? __PACKS__[code];
  if (localVersion === manifest.version) return "none";
  const pending = await db().packs.get(pendingKey(code));
  if (pending?.version === manifest.version) return "pending";

  const base = manifest.baseUrl ? manifest.baseUrl.replace(/\/?$/, "/") : packBaseUrl(code, manifest.version);
  let core: CoreFile;
  let usedBase = base;
  try {
    core = await fetchCore(code, base, fetchImpl);
  } catch {
    if (!manifest.baseUrl) return "none";
    try {
      usedBase = packBaseUrl(code, manifest.version);
      core = await fetchCore(code, usedBase, fetchImpl);
    } catch {
      return "none";
    }
  }
  const baseUrl = usedBase !== packBaseUrl(code, core.pack.version) ? { baseUrl: usedBase } : {};
  if (baseUrl.baseUrl) baseUrls.set(`${code}@${core.pack.version}`, baseUrl.baseUrl);
  const row: StoredPack = { code, version: core.pack.version, core, ...baseUrl, fetchedAt: now() };
  // `busy` : une séance est affichée (vérification en arrière-plan) → appliqué au prochain démarrage.
  if (busy() || (await blocksUpdate(code, stored))) {
    await db().packs.put({ ...row, code: pendingKey(code) });
    return "pending";
  }
  await db().packs.put(row);
  await db().packs.delete(pendingKey(code));
  loaded.set(code, filesOf(core));
  onContentApplied(code, core.pack.version);
  return "applied";
}
