import type { SrsCard } from "./srs.ts";
import type { ConceptId, GameId, LessonId, StepType } from "./types.ts";

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
  | BaseEvent<
      "placement_completed",
      {
        /** Estimation 0 (débutant) à 3 (comprend et parle un peu). */
        levelEstimate: number;
        entryLessonId: LessonId;
        correct: number;
        total: number;
        /** Concepts reconnus pendant le test : cartes SRS de départ. */
        knownConceptIds: ConceptId[];
      }
    >
  | BaseEvent<"badge_earned", { badgeCode: string }>
  /** Score de prononciation seul — jamais l'audio (spec §11, §14). */
  | BaseEvent<"pronunciation_scored", { sessionId: string | null; conceptId: ConceptId; score: number; exerciseType: StepType }>
  /** « Je pars quelques jours » : série gelée jusqu'au jour local inclus. */
  | BaseEvent<"streak_frozen", { frozenUntil: string; localDate: string }>
  /** Partie de mini-jeu hors leçon (onglet Jeux, défi express). */
  | BaseEvent<"game_played", { game: GameId; correct: number; total: number; durationMs: number; localDate: string }>
  /** Tour de conversation avec Cô Mai (texte ou voix) — jamais le contenu du message. */
  | BaseEvent<"conversation_turn", { conversationId: string; mode: "free" | "doi_dap"; words: number; responseMs: number; localDate: string }>
  /** Changement de langue apprise (plusieurs packs). */
  | BaseEvent<"pack_switched", { fromPack: string | null; toPack: string }>
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

let lastMs = -1;
let sequence = 0;

/**
 * UUID v7 (RFC 9562) monotone : 48 bits de timestamp ms, puis un compteur de
 * 12 bits (rand_a) pour garder l'ordre de création dans une même milliseconde.
 * Les ids trient donc dans l'ordre d'émission — l'outbox en dépend.
 */
export function uuidv7(now: Date = new Date()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let ms = now.getTime();
  if (ms <= lastMs) {
    ms = lastMs;
    sequence++;
    if (sequence > 0xfff) {
      ms++;
      sequence = 0;
    }
  } else {
    sequence = 0;
  }
  lastMs = ms;

  let t = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  bytes[6] = 0x70 | (sequence >> 8);
  bytes[7] = sequence & 0xff;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
