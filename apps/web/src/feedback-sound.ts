import { usePrefs } from "./prefs.ts";

/**
 * Son court de bonne réponse (spec §4.5), synthétisé en WebAudio : aucun fichier, aucun
 * réseau. Muet en mode silencieux et quand le navigateur n'a pas d'AudioContext.
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

/** Deux notes montantes (≈ 180 ms), volume doux. */
export function playCorrectSound(): void {
  if (usePrefs.getState().silent) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime + 0.01;
    [659.25, 987.77].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = start + i * 0.08;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.18);
    });
  } catch {
    // Son facultatif : jamais bloquant.
  }
}
