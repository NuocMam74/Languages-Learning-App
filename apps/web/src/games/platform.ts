import type { Concept, ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { mediaUrl } from "../content.ts";

/** Petits services navigateur partagés par les mini-jeux (mouvement, sons, préchargement). */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

let audioContext: AudioContext | null = null;

/**
 * Son court et positif, synthétisé (aucun fichier) : deux notes montantes.
 * Jamais de son punitif en cas d'erreur.
 */
export function playChime(): void {
  try {
    const ctx = (audioContext ??= new AudioContext());
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    [659.25, 987.77].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t0 + i * 0.09;
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  } catch {
    // WebAudio indisponible : le jeu reste jouable sans son.
  }
}

const warmed = new Map<string, HTMLAudioElement>();

/** Précharge l'audio natif d'un concept (le lecteur le trouvera en cache HTTP / service worker). */
export function preloadConceptAudio(content: ContentIndex, concept: Concept): void {
  const track = concept.audio.find((a) => a.speed === "natural") ?? concept.audio[0];
  if (!track || typeof Audio === "undefined") return;
  preloadMedia(content, track.src);
}

/** Précharge un fichier audio du pack par son chemin (consignes de Xe ôm…). */
export function preloadMedia(content: ContentIndex, path: string | undefined): void {
  if (!path || typeof Audio === "undefined") return;
  const url = mediaUrl(content, path);
  if (warmed.has(url)) return;
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = url;
  warmed.set(url, audio);
  // Garde la mémoire bornée sur une longue session.
  if (warmed.size > 40) {
    const oldest = warmed.keys().next().value;
    if (oldest !== undefined) warmed.delete(oldest);
  }
}
