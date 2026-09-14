import type { LessonId, LessonRun, ParloEvent, RawPackFiles, SessionRun, SrsCard, Streak } from "@parlo/core";
import { Dexie, type EntityTable } from "dexie";

/**
 * Stockage local (ADR 0004). Toute écriture d'état pédagogique passe par une
 * transaction qui écrit aussi l'événement correspondant dans `outbox`.
 */

export interface StoredPack {
  code: string;
  version: number;
  files: RawPackFiles;
  fetchedAt: string;
}

export interface LessonProgressRow {
  lessonId: LessonId;
  status: "completed";
  bestScore: number;
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
 * Séance en cours : réécrite après chaque réponse pour une reprise exacte.
 * `session` couvre toute la séance ; `run` seul = snapshot de la Phase 0 (leçon).
 */
export interface SessionSnapshot {
  key: "current";
  packCode: string;
  session?: SessionRun;
  run?: LessonRun;
  savedAt: string;
}

export interface KeyValue<T = unknown> {
  key: string;
  value: T;
}

export class ParloDB extends Dexie {
  packs!: EntityTable<StoredPack, "code">;
  srsCards!: EntityTable<SrsCard, "conceptId">;
  lessonProgress!: EntityTable<LessonProgressRow, "lessonId">;
  outbox!: EntityTable<OutboxRow, "id">;
  snapshot!: EntityTable<SessionSnapshot, "key">;
  kv!: EntityTable<KeyValue, "key">;
  syncLog!: EntityTable<SyncLogRow, "seq">;

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

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db().kv.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setKv<T>(key: string, value: T): Promise<void> {
  await db().kv.put({ key, value });
}
