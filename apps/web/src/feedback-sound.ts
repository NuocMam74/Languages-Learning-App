import { usePrefs } from "./prefs.ts";

/**
 * Sons courts de retour (spec §4.5, contrat phase9 §5), synthétisés en WebAudio : aucun fichier,
 * aucun réseau, rien à précacher. Muets en mode silencieux, quand les sons de retour sont coupés
 * dans les réglages, et quand le navigateur n'a pas d'AudioContext.
 *
 * Le son d'erreur est **neutre et grave**, jamais punitif (spec §5.6) : il dit « on reprend »,
 * pas « perdu ». Aucun son ne dure plus de 400 ms et aucun ne bloque l'enchaînement.
 */

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context ??= new Ctor();
    return context;
  } catch {
    return null;
  }
}

/** Les sons de retour sont-ils autorisés ici et maintenant ? */
export function feedbackSoundsOn(): boolean {
  const { silent, feedbackSounds } = usePrefs.getState();
  return !silent && feedbackSounds;
}

interface Note {
  /** Hertz. */
  freq: number;
  /** Décalage du début, en secondes. */
  at: number;
  /** Durée, en secondes. */
  for: number;
  /** Volume de crête (0–1). */
  gain?: number;
  type?: OscillatorType;
}

/** Joue une suite de notes courtes. Toute erreur est avalée : un son reste facultatif. */
function play(notes: readonly Note[]): void {
  if (!feedbackSoundsOn()) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime + 0.01;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type ?? "sine";
      osc.frequency.value = note.freq;
      const t0 = start + note.at;
      const peak = note.gain ?? 0.12;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.for);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + note.for + 0.02);
    }
  } catch {
    // Son facultatif : jamais bloquant.
  }
}

/** Bonne réponse : deux notes montantes (≈ 180 ms), volume doux. */
export function playCorrectSound(): void {
  play([
    { freq: 659.25, at: 0, for: 0.16 },
    { freq: 987.77, at: 0.08, for: 0.16 },
  ]);
}

/**
 * Mauvaise réponse : deux notes basses et proches, sans dissonance — le son d'un « hop, on
 * recommence ». Plus discret que le son de réussite, exprès : l'erreur ne s'annonce pas.
 */
export function playWrongSound(): void {
  play([
    { freq: 246.94, at: 0, for: 0.2, gain: 0.08, type: "triangle" },
    { freq: 196, at: 0.1, for: 0.22, gain: 0.07, type: "triangle" },
  ]);
}

/** Récompense (xu, objet, mission réclamée) : un arpège de trois notes, franc mais court. */
export function playRewardSound(): void {
  play([
    { freq: 587.33, at: 0, for: 0.18, gain: 0.1 },
    { freq: 783.99, at: 0.07, for: 0.18, gain: 0.1 },
    { freq: 1174.66, at: 0.14, for: 0.26, gain: 0.09 },
  ]);
}

/** Montée de niveau ou trophée : le même geste, une note de plus et un peu plus de corps. */
export function playFanfareSound(): void {
  play([
    { freq: 523.25, at: 0, for: 0.18, gain: 0.1 },
    { freq: 659.25, at: 0.08, for: 0.18, gain: 0.1 },
    { freq: 783.99, at: 0.16, for: 0.2, gain: 0.1 },
    { freq: 1046.5, at: 0.26, for: 0.34, gain: 0.11 },
  ]);
}
