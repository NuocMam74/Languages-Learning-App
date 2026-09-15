import { countWords, type Localized } from "@parlo/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import { recordConversationTurn } from "../learner.ts";
import { sendMessage, type ConversationDto, type ConversationMode, type ConversationStart, type Correction, type FallbackReason, type Gloss, type InputMode } from "./client.ts";
import { glossKey } from "./glossary.ts";

/**
 * État d'une conversation avec Cô Mai. Les phrases de Cô Mai s'affichent
 * une à une, à l'arrivée de chaque événement `sentence` (jamais de texte
 * partiel). Le flux est abandonné au démontage.
 */

export interface ChatMessage {
  id: string;
  role: "tutor" | "user";
  sentences: string[];
  /** Correction douce du message de l'utilisateur (arrive en fin de tour). */
  correction: Correction | null;
  /** Tour remplacé par un message préécrit (quota, garde du Sud, erreur). */
  fallback: FallbackReason | null;
  /** Message utilisateur non remis (réseau coupé avant la réponse). */
  failed: boolean;
}

export type TurnOutcome =
  | { kind: "done"; corrected: boolean; remainingToday: number | null }
  | { kind: "fallback"; reason: FallbackReason }
  | { kind: "failed" }
  | { kind: "aborted" };

let nextId = 0;
const newId = () => `m${++nextId}`;

export function messagesFromStart(start: ConversationStart): ChatMessage[] {
  return [{ id: newId(), role: "tutor", sentences: splitSentences(start.opening.text), correction: null, fallback: null, failed: false }];
}

export function messagesFromDto(dto: ConversationDto): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const turn of dto.turns) {
    const role = turn.role === "user" ? "user" : "tutor";
    out.push({ id: newId(), role, sentences: role === "user" ? [turn.text] : splitSentences(turn.text), correction: turn.correction, fallback: null, failed: false });
  }
  return out;
}

export function glossesFrom(list: readonly Gloss[] | null | undefined): Map<string, Localized> {
  const map = new Map<string, Localized>();
  for (const g of list ?? []) if (g.vi && g.gloss?.fr) map.set(glossKey(g.vi), g.gloss);
  return map;
}

/** Découpe un texte déjà vérifié en phrases (ouverture, historique). */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*["»”)]*\s*/gu) ?? [];
  const sentences = parts.map((s) => s.trim()).filter(Boolean);
  return sentences.length ? sentences : [text.trim()].filter(Boolean);
}

export function useConversation({ conversationId, mode, initial, initialGlosses }: {
  conversationId: string;
  mode: ConversationMode;
  initial: ChatMessage[];
  initialGlosses?: Map<string, Localized>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [glosses, setGlosses] = useState<Map<string, Localized>>(() => initialGlosses ?? new Map());
  const [streaming, setStreaming] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [resting, setResting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  /** Fin de la dernière réponse de Cô Mai : départ du temps de réponse. */
  const readyAt = useRef(Date.now());

  useEffect(() => () => controller.current?.abort(), []);

  const update = (id: string, patch: (m: ChatMessage) => ChatMessage) => setMessages((list) => list.map((m) => (m.id === id ? patch(m) : m)));

  const send = useCallback(
    async (text: string, inputMode: InputMode, responseMs?: number): Promise<TurnOutcome> => {
      const clean = text.trim();
      if (!clean || controller.current) return { kind: "aborted" };
      const abort = new AbortController();
      controller.current = abort;
      const measured = responseMs ?? Date.now() - readyAt.current;
      const userId = newId();
      const tutorId = newId();
      setMessages((list) => [
        ...list,
        { id: userId, role: "user", sentences: [clean], correction: null, fallback: null, failed: false },
        { id: tutorId, role: "tutor", sentences: [], correction: null, fallback: null, failed: false },
      ]);
      setStreaming(true);
      let outcome: TurnOutcome = { kind: "failed" };
      let corrected = false;
      try {
        const body = mode === "doi_dap" ? { text: clean, inputMode, responseMs: Math.round(measured) } : { text: clean, inputMode };
        for await (const event of sendMessage(conversationId, body, abort.signal)) {
          switch (event.type) {
            case "sentence":
              update(tutorId, (m) => ({ ...m, sentences: [...m.sentences, event.text] }));
              break;
            case "gloss":
              setGlosses((g) => new Map(g).set(glossKey(event.vi), event.gloss));
              break;
            case "correction":
              corrected = true;
              update(userId, (m) => ({ ...m, correction: event.correction }));
              break;
            case "done":
              if (event.remainingToday !== null) setRemaining(event.remainingToday);
              outcome = { kind: "done", corrected, remainingToday: event.remainingToday };
              break;
            case "fallback":
              update(tutorId, (m) => ({ ...m, sentences: event.text ? splitSentences(event.text) : [], fallback: event.reason }));
              if (event.reason === "quota") {
                setResting(true);
                setRemaining(0);
              }
              outcome = { kind: "fallback", reason: event.reason };
              break;
          }
        }
      } catch (error) {
        if (abort.signal.aborted) return { kind: "aborted" };
        if (error instanceof ApiError && error.status === 429) {
          update(tutorId, (m) => ({ ...m, fallback: "quota" }));
          setResting(true);
          setRemaining(0);
          outcome = { kind: "fallback", reason: "quota" };
        } else {
          outcome = { kind: "failed" };
        }
      } finally {
        if (controller.current === abort) controller.current = null;
        setStreaming(false);
      }
      if (outcome.kind === "failed") {
        // Rien de vérifié n'est arrivé : on retire la bulle vide et on marque le message.
        setMessages((list) => list.flatMap((m) => (m.id === tutorId && m.sentences.length === 0 ? [] : m.id === userId ? [{ ...m, failed: true }] : [m])));
      }
      if (outcome.kind === "done") {
        void recordConversationTurn({ conversationId, mode, words: countWords(clean), responseMs: measured }).catch(() => undefined);
      }
      readyAt.current = Date.now();
      return outcome;
    },
    [conversationId, mode],
  );

  /** Retire un message non remis (pour le renvoyer). */
  const dismiss = (id: string) => setMessages((list) => list.filter((m) => m.id !== id));

  return { messages, glosses, streaming, remaining, resting, send, dismiss, setMessages, setGlosses };
}
