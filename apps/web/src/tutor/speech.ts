import { useEffect, useRef, useState } from "react";

/**
 * Voix dans la conversation avec Cô Mai (contrat phase 3 §1, « Voix ») :
 * - saisie vocale via la Web Speech API quand le navigateur l'offre (jamais obligatoire) ;
 * - lecture des réponses de Cô Mai en synthèse vi-VN, à la demande, signalée.
 */

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechInputSupported = () => typeof window !== "undefined" && recognitionCtor() !== null;

export type DictationState = "idle" | "listening" | "denied" | "error";

/**
 * Dictée vi-VN : `onText` reçoit la transcription (provisoire puis finale),
 * que l'utilisateur peut corriger avant d'envoyer.
 */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const recognition = useRef<RecognitionLike | null>(null);
  const callback = useRef(onText);
  callback.current = onText;

  useEffect(() => () => recognition.current?.abort(), []);

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    const rec = new Ctor();
    rec.lang = "vi-VN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i]![0].transcript;
      callback.current(text.trim());
    };
    rec.onerror = (event) => {
      setState(event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied" : event.error === "no-speech" || event.error === "aborted" ? "idle" : "error");
    };
    rec.onend = () => {
      recognition.current = null;
      setState((s) => (s === "listening" ? "idle" : s));
    };
    recognition.current = rec;
    setState("listening");
    try {
      rec.start();
    } catch {
      recognition.current = null;
      setState("error");
    }
  };

  const stop = () => recognition.current?.stop();

  return { state, start, stop };
}

/** Permission micro déjà accordée ? (sinon : explication avant la demande, comme le karaoké). */
export async function micGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export const speechOutputSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Lit un texte vietnamien en synthèse (voix du Sud préférée si annoncée). false si impossible. */
export function speakVietnamese(text: string): boolean {
  if (!speechOutputSupported()) return false;
  const synth = window.speechSynthesis;
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith("vi"));
  const voice = voices.find((v) => /south|miền nam|sài gòn|saigon|hcm/i.test(v.name)) ?? voices[0];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "vi-VN";
  if (voice) utterance.voice = voice;
  synth.cancel();
  synth.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}
