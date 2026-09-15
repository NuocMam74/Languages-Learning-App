import { request, requestStream } from "../api.ts";
import { readSse, type SseMessage } from "./sse.ts";

/** Conversation avec Cô Mai (contrat docs/contracts/phase3.md §1). */

export type ConversationMode = "free" | "doi_dap";
export type InputMode = "text" | "voice";

export interface Gloss {
  vi: string;
  gloss: { fr: string; en?: string } & Partial<Record<string, string>>;
}

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
}

export type FallbackReason = "quota" | "south_guard" | "error";

export type TutorEvent =
  | { type: "sentence"; text: string }
  | { type: "gloss"; vi: string; gloss: Gloss["gloss"] }
  | { type: "correction"; correction: Correction }
  | { type: "done"; turn: number; remainingToday: number | null }
  | { type: "fallback"; text: string; reason: FallbackReason };

export interface ConversationStart {
  conversationId: string;
  opening: { text: string; glosses: Gloss[] };
}

export interface ConversationDto {
  id: string;
  mode: ConversationMode;
  turns: { role: "user" | "tutor" | "assistant"; text: string; glosses: Gloss[] | null; correction: Correction | null }[];
  endedAt: string | null;
  fluency: number | null;
}

export interface ConversationEnd {
  fluency: number | null;
  summary: Partial<Record<string, string>>;
}

export interface WeeklyDebrief {
  weekStart: string;
  progress: string;
  struggles: string;
  goal: string;
  source: "model" | "fallback";
  cached: boolean;
}

const enc = encodeURIComponent;

export const startConversation = (input: { locale: string; mode: ConversationMode; topicLessonId?: string }) =>
  request<ConversationStart>("/tutor/conversations", { method: "POST", body: input });

export const getConversation = (id: string) => request<ConversationDto>(`/tutor/conversations/${enc(id)}`);

export const endConversation = (id: string) => request<ConversationEnd>(`/tutor/conversations/${enc(id)}/end`, { method: "POST" });

export const getWeeklyDebrief = (locale: string) => request<WeeklyDebrief>(`/tutor/debrief/weekly?locale=${enc(locale)}`);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Traduit un message SSE en événement typé. Nom d'événement lu dans `event:`,
 * ou à défaut dans le JSON (`{event|type, data?, ...}`) ; inconnu ou invalide → null.
 */
export function toTutorEvent(message: SseMessage): TutorEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  let name = message.event;
  let data: Record<string, unknown> = raw;
  if (name === "message") {
    name = str(raw.event) || str(raw.type);
    if (isRecord(raw.data)) data = raw.data;
  }
  switch (name) {
    case "sentence": {
      const text = str(data.text).trim();
      return text ? { type: "sentence", text } : null;
    }
    case "gloss": {
      const vi = str(data.vi).trim();
      if (!vi || !isRecord(data.gloss)) return null;
      return { type: "gloss", vi, gloss: data.gloss as Gloss["gloss"] };
    }
    case "correction": {
      const corrected = str(data.corrected);
      if (!corrected) return null;
      return { type: "correction", correction: { original: str(data.original), corrected, explanation: str(data.explanation) } };
    }
    case "done":
      return {
        type: "done",
        turn: typeof data.turn === "number" ? data.turn : 0,
        remainingToday: typeof data.remainingToday === "number" ? data.remainingToday : null,
      };
    case "fallback": {
      const reason = data.reason === "quota" || data.reason === "south_guard" ? data.reason : "error";
      return { type: "fallback", text: str(data.text), reason };
    }
    default:
      return null;
  }
}

/** Envoie un message et itère les événements du tour, jusqu'à `done`/`fallback` ou la fin du flux. */
export async function* sendMessage(
  conversationId: string,
  input: { text: string; inputMode: InputMode; responseMs?: number },
  signal?: AbortSignal,
): AsyncGenerator<TutorEvent> {
  const res = await requestStream(`/tutor/conversations/${enc(conversationId)}/messages`, { method: "POST", body: input, ...(signal ? { signal } : {}) });
  if (!res.body) return;
  for await (const message of readSse(res.body, signal)) {
    const event = toTutorEvent(message);
    if (event) yield event;
  }
}
