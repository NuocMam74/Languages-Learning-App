import type { SrsCard } from "./srs.ts";
import type { ConceptId, LessonId, StepType } from "./types.ts";

/**
 * Événements pédagogiques (ADR 0004). Contrat partagé avec l'API :
 * apps/api/app/schemas/events.py doit accepter exactement ces formes.
 */

export const EVENT_SCHEMA_VERSION = 1;

interface BaseEvent<T extends string, P> {
  /** UUID v7 généré côté client : clé d'idempotence. */
  id: string;
  type: T;
  /** ISO 8601, horloge client. */
  occurredAt: string;
  schemaVersion: typeof EVENT_SCHEMA_VERSION;
  payload: P;
}

export type SessionSource = "daily" | "lesson" | "review" | "game" | "placement";

export type ParloEvent =
  | BaseEvent<"session_started", { sessionId: string; source: SessionSource; plannedSeconds: number }>
  | BaseEvent<
      "answer_submitted",
      {
        sessionId: string;
        lessonId: LessonId | null;
        stepIndex: number;
        exerciseType: StepType;
        conceptIds: ConceptId[];
        correct: boolean;
        nearMiss: boolean;
        responseMs: number;
        attempt: number;
      }
    >
  | BaseEvent<"srs_card_updated", { card: SrsCard }>
  | BaseEvent<"lesson_completed", { sessionId: string; lessonId: LessonId; score: number; durationMs: number }>
  | BaseEvent<
      "session_completed",
      {
        sessionId: string;
        xpGained: number;
        itemsCount: number;
        durationMs: number;
        /** Jour local de l'utilisateur (AAAA-MM-JJ), pour la série. */
        localDate: string;
      }
    >;

export type ParloEventType = ParloEvent["type"];
type PayloadOf<T extends ParloEventType> = Extract<ParloEvent, { type: T }>["payload"];

export function makeEvent<T extends ParloEventType>(type: T, payload: PayloadOf<T>, now: Date = new Date()): Extract<ParloEvent, { type: T }> {
  const event: BaseEvent<T, PayloadOf<T>> = { id: uuidv7(now), type, occurredAt: now.toISOString(), schemaVersion: EVENT_SCHEMA_VERSION, payload };
  // TypeScript ne sait pas corréler T et PayloadOf<T> dans l'union : conversion sûre par construction.
  return event as unknown as Extract<ParloEvent, { type: T }>;
}

/** UUID v7 (RFC 9562) : 48 bits de timestamp ms + aléa. Trie chronologiquement. */
export function uuidv7(now: Date = new Date()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let ms = now.getTime();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms & 0xff;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
