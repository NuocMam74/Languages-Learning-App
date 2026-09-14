import type { Concept, ContentIndex } from "@parlo/core";
import { mediaUrl } from "./content.ts";

/**
 * Lecture audio (spec §7.4).
 * - Priorité à l'audio natif. La version lente est un fichier dédié, étiré
 *   hors ligne sans changer la hauteur : on ne touche JAMAIS à playbackRate.
 * - La synthèse vocale n'est qu'un repli, jamais pour les tons, et signalée.
 *   En développement (audio pas encore enregistré) elle est tolérée partout,
 *   avec un marqueur visible.
 */

export type PlaybackSource = "native" | "tts" | "missing";

export interface PlayOptions {
  speed?: "natural" | "slow";
  /** false pour les exercices de tons et le karaoké tonal. */
  allowTts: boolean;
}

let current: HTMLAudioElement | null = null;

function playFile(url: string): Promise<boolean> {
  current?.pause();
  const audio = new Audio(url);
  current = audio;
  return audio.play().then(
    () => true,
    () => false,
  );
}

function speak(text: string): boolean {
  if (!("speechSynthesis" in window)) return false;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("vi"));
  // La voix vi-VN par défaut est souvent du Nord : on préfère une voix annoncée du Sud si elle existe.
  const voice = voices.find((v) => /south|miền nam|sài gòn|saigon|hcm/i.test(v.name)) ?? voices[0];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "vi-VN";
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

export function ttsAllowed(isToneExercise: boolean): boolean {
  return import.meta.env.DEV || !isToneExercise;
}

export async function playConcept(content: ContentIndex, concept: Concept, { speed = "natural", allowTts }: PlayOptions): Promise<PlaybackSource> {
  const tracks = concept.audio.filter((a) => a.source === "native" || allowTts);
  const track = tracks.find((a) => a.speed === speed) ?? tracks.find((a) => a.speed === "natural");
  if (track && (await playFile(mediaUrl(content, track.src)))) return track.source;
  return playText(concept.vi, allowTts);
}

export async function playPath(content: ContentIndex, path: string | undefined, text: string, allowTts: boolean): Promise<PlaybackSource> {
  if (path && (await playFile(mediaUrl(content, path)))) return "native";
  return playText(text, allowTts);
}

function playText(text: string, allowTts: boolean): PlaybackSource {
  if (allowTts && speak(text)) return "tts";
  return "missing";
}
