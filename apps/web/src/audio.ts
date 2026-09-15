import type { Concept, ContentIndex, Pack } from "@parlo/core";
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

function speak(text: string, pack: Pack): boolean {
  if (!("speechSynthesis" in window)) return false;
  const lang = pack.lang.toLowerCase();
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === lang);
  // La voix par défaut d'une langue n'est pas forcément la variante du pack (vi-VN souvent du Nord) :
  // on préfère une voix dont le nom évoque la variante ou l'accent des voix du pack (ADR 0006).
  const hints = [pack.variant, ...pack.voices.map((v) => v.accent)].filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase());
  const voice = voices.find((v) => hints.some((h) => v.name.toLowerCase().includes(h))) ?? voices[0];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang ?? pack.lang;
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
  return playText(content.pack, concept.vi, allowTts);
}

export async function playPath(content: ContentIndex, path: string | undefined, text: string, allowTts: boolean): Promise<PlaybackSource> {
  if (path && (await playFile(mediaUrl(content, path)))) return "native";
  return playText(content.pack, text, allowTts);
}

function playText(pack: Pack, text: string, allowTts: boolean): PlaybackSource {
  if (allowTts && speak(text, pack)) return "tts";
  return "missing";
}
