import type { CoreFile, LessonId, LessonRun, ParloEvent, RawPackFiles, SessionRun, SrsCard, Streak, UnitFile } from "@parlo/core";
import { Dexie, type EntityTable, type Transaction } from "dexie";
import { activePackCode, DEFAULT_PACK, isPackScopedKey, packOfLesson, scopedKey } from "./packs/active.ts";

/**
 * Stockage local (ADR 0004). Toute écriture d'état pédagogique passe par une
 * transaction qui écrit aussi l'événement correspondant dans `outbox`.
 *
 * Plusieurs packs (ADR 0006) : cartes SRS, progression de leçon, séance en cours et
 * clés `kv` propres à une langue portent le code du pack ; l'outbox, le journal de
 * synchronisation, le compte et les préférences restent communs.
 */

export interface StoredPack {
  code: string;
  version: number;
  /** Contenu découpé (core.json) ; les unités sont dans `units`. */
  core?: CoreFile;
  /** Ancien bundle complet (avant le découpage) : relu puis découpé localement. */
  files?: RawPackFiles;
  /** Base des fichiers de cette version (manifeste de l'API), si différente de /content/<code>/v<n>/. */
  baseUrl?: string;
  fetchedAt: string;
}

/** Fichier d'unité d'une version de pack (clé `code@version:unitId`). */
export interface StoredUnit {
  key: string;
  code: string;
  version: number;
  unit: string;
  data: UnitFile;
  fetchedAt: string;
}

/** Unité rendue disponible hors ligne (spec §8.1) : médias en cache, dernier usage pour la purge LRU. */
export interface OfflineUnitRow {
  /** `code:unitId` (indépendant de la version : retéléchargée après une mise à jour). */
  key: string;
  code: string;
  unit: string;
  version: number;
  status: "downloading" | "ready" | "error";
  bytes: number;
  media: string[];
  downloadedAt: string;
  lastUsedAt: string;
}

export const unitKey = (code: string, version: number, unit: string) => `${code}@${version}:${unit}`;
export const offlineKey = (code: string, unit: string) => `${code}:${unit}`;

/** Carte SRS stockée : l'id de concept reste la clé (unique entre packs, vérifié en CI), `packCode` indexé. */
export type StoredSrsCard = SrsCard & { packCode?: string };

export interface LessonProgressRow {
  lessonId: LessonId;
  /** Déduit de l'id de leçon s'il manque (hook de création). */
  packCode?: string;
  status: "completed";
  bestScore: number;
  /**
   * Leçon **maîtrisée** au moins une fois : tous ses exercices notés réussis, réessais compris
   * (contrat phase10 §3). C'est elle qui ouvre la leçon suivante, pas `status: "completed"`.
   * Absent = lignes écrites avant ce contrat : elles ne valent pas réussite (on ne valide pas
   * rétroactivement une leçon dont on ne sait pas si elle a été réussie).
   */
  mastered?: boolean;
  attempts: number;
  completedAt: string;
}

export interface OutboxRow {
  id: string;
  occurredAt: string;
  event: ParloEvent;
}

/** Journal local des événements refusés définitivement par le serveur. */
export interface SyncLogRow {
  seq?: number;
  eventId: string;
  eventType: string;
  reason: string;
  at: string;
}

export interface Profile {
  motivation: "family" | "travel" | "work" | "roots" | "curiosity" | null;
  entourage: "nobody" | "partner" | "parents" | "colleagues" | null;
  selfLevel: "none" | "words" | "understand" | "speak" | null;
  dailyGoalMin: 5 | 10 | 15 | 20;
  reminder: "morning" | "noon" | "evening" | "none" | null;
  onboardedAt: string | null;
}

export interface Totals {
  xp: number;
  streak: Streak;
}

/**
 * Séance en cours d'un pack : réécrite après chaque réponse pour une reprise exacte.
 * `key` = code du pack (une séance en cours par langue ; « current » avant la version 3).
 * `session` couvre toute la séance ; `run` seul = snapshot de la Phase 0 (leçon).
 */
export interface SessionSnapshot {
  key: string;
  packCode: string;
  session?: SessionRun;
  run?: LessonRun;
  savedAt: string;
  /** Version du contenu du pack au démarrage de la séance (contrat phase5 §6). */
  contentVersion?: number;
}

export interface KeyValue<T = unknown> {
  key: string;
  value: T;
}

/** Élément auquel une note personnelle est attachée (contrat phase8 §3). */
export type NoteTargetKind = "concept" | "lesson" | "dialogue" | "culture" | "free";

/**
 * Note personnelle (contrat phase8 §3) : locale, propre à une langue, **jamais envoyée au serveur**
 * (minimisation, spec §14). Incluse dans l'export local (RGPD) et dans l'export de la page Notes.
 * Une note libre n'a pas de cible (`targetId: null`).
 */
export interface NoteRow {
  id: string;
  packCode: string;
  targetKind: NoteTargetKind;
  targetId: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** Clé `kv` globale du pack actif (langue apprise). */
export const ACTIVE_PACK_KEY = "activePack";
/** Clé du snapshot avant la version 3 du schéma (un seul pack). */
export const LEGACY_SNAPSHOT_KEY = "current";

/**
 * Migration 2 → 3 : tout ce qui existait appartient au pack d'origine. Rien n'est supprimé :
 * les lignes sont étiquetées (`packCode`) ou renommées (`kv` propres au pack, snapshot).
 */
export async function migrateToMultiPack(tx: Transaction): Promise<void> {
  await tx.table<StoredSrsCard, string>("srsCards").toCollection().modify((card) => {
    card.packCode ??= DEFAULT_PACK;
  });
  await tx.table<LessonProgressRow, string>("lessonProgress").toCollection().modify((row) => {
    row.packCode ??= packOfLesson(row.lessonId);
  });

  const snapshots = tx.table<SessionSnapshot, string>("snapshot");
  const legacy = await snapshots.get(LEGACY_SNAPSHOT_KEY);
  if (legacy) {
    const packCode = legacy.packCode || DEFAULT_PACK;
    await snapshots.delete(LEGACY_SNAPSHOT_KEY);
    await snapshots.put({ ...legacy, key: packCode, packCode });
  }

  const kv = tx.table<KeyValue, string>("kv");
  const rows = await kv.toArray();
  const scoped = rows.filter((r) => isPackScopedKey(r.key));
  await kv.bulkDelete(scoped.map((r) => r.key));
  await kv.bulkPut(scoped.map((r) => ({ key: scopedKey(r.key, DEFAULT_PACK), value: r.value })));
  // Un apprenant existant garde sa langue.
  if (rows.length > 0 && !rows.some((r) => r.key === ACTIVE_PACK_KEY)) await kv.put({ key: ACTIVE_PACK_KEY, value: DEFAULT_PACK });
}

export class ParloDB extends Dexie {
  packs!: EntityTable<StoredPack, "code">;
  srsCards!: EntityTable<StoredSrsCard, "conceptId">;
  lessonProgress!: EntityTable<LessonProgressRow, "lessonId">;
  outbox!: EntityTable<OutboxRow, "id">;
  snapshot!: EntityTable<SessionSnapshot, "key">;
  kv!: EntityTable<KeyValue, "key">;
  syncLog!: EntityTable<SyncLogRow, "seq">;
  units!: EntityTable<StoredUnit, "key">;
  offlineUnits!: EntityTable<OfflineUnitRow, "key">;
  notes!: EntityTable<NoteRow, "id">;

  constructor(name = "parlo") {
    super(name);
    this.version(1).stores({
      packs: "code",
      srsCards: "conceptId, due, state",
      lessonProgress: "lessonId",
      outbox: "id, occurredAt",
      snapshot: "key",
      kv: "key",
    });
    this.version(2).stores({
      syncLog: "++seq, at",
    });
    // Phase 3 : plusieurs packs. Les clés primaires ne changent pas (ids uniques entre packs) :
    // pas de recopie de table, seulement un index et une étiquette.
    this.version(3)
      .stores({
        srsCards: "conceptId, due, state, packCode",
        lessonProgress: "lessonId, packCode",
      })
      .upgrade(migrateToMultiPack);
    // Contenu découpé par unité et unités hors ligne (audit mobile P1 #6, spec §8.1) : tables nouvelles, rien à migrer
    // (un ancien bundle dans `packs` est découpé à la première lecture).
    this.version(4).stores({
      units: "key, [code+version], code",
      offlineUnits: "key, code, lastUsedAt",
    });
    // Notes personnelles (contrat phase8 §3) : table nouvelle, aucune table existante n'est touchée
    // (Dexie ne recopie que les tables citées) — rien à migrer, rien à perdre.
    this.version(5).stores({
      notes: "id, packCode, [packCode+targetKind+targetId], [packCode+updatedAt], updatedAt",
    });

    // Toute écriture sans packCode (tests, modules qui ignorent les packs) est rattachée au bon pack.
    this.srsCards.hook("creating", (_key, card) => {
      card.packCode ??= activePackCode();
    });
    // Un `put` d'une carte sans étiquette (sortie du moteur SRS) ne doit pas effacer celle qui existe.
    this.srsCards.hook("updating", (mods, _key, card) => (card.packCode && "packCode" in mods && !(mods as { packCode?: unknown }).packCode ? { packCode: card.packCode } : undefined));
    this.lessonProgress.hook("creating", (_key, row) => {
      row.packCode ??= packOfLesson(row.lessonId);
    });
  }
}

let instance: ParloDB | null = null;
export function db(): ParloDB {
  instance ??= new ParloDB();
  return instance;
}

/** Tests : remplace l'instance (fake-indexeddb, redémarrage simulé). */
export function setDb(next: ParloDB | null): void {
  instance = next;
}

/** Les clés propres à une langue (profil, totaux, badges…) sont lues dans le pack actif. */
export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db().kv.get(scopedKey(key));
  return row ? (row.value as T) : fallback;
}

export async function setKv<T>(key: string, value: T): Promise<void> {
  await db().kv.put({ key: scopedKey(key), value });
}

/** Retire l'étiquette de stockage d'une carte (les événements portent la forme du contrat). */
export function withoutPack(card: StoredSrsCard): SrsCard {
  const { packCode: _packCode, ...rest } = card;
  return rest;
}
