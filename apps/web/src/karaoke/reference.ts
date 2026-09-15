import { toneOf, type Concept, type ContentIndex } from "@parlo/core";
import { extractContour, parsePitchReference, toPitchReference, type PitchReference } from "@parlo/core/pitch";
import { mediaUrl } from "../content.ts";

/**
 * Courbe de référence d'un mot ou d'une phrase (docs/AUDIO.md §3).
 *  1. `pitch/<id>.json` du pack (chemin de l'étape `pitchRef`, sinon `concept.pitch`, sinon la convention
 *     `pitch/<concept.id>.json` que produit `npm run audio:process`) ;
 *  2. en DÉVELOPPEMENT seulement : dérivée à la volée de l'audio natif du concept s'il existe ;
 *  3. sinon null → l'exercice reste de l'écoute, non noté.
 */

export interface LoadedReference {
  reference: PitchReference;
  source: "file" | "derived";
}

const cache = new Map<string, Promise<LoadedReference | null>>();

export function referencePath(concept: Concept, pitchRef: string | null | undefined): string {
  return pitchRef ?? concept.pitch ?? `pitch/${concept.id}.json`;
}

/** Syllabes affichées sous la courbe (ponctuation retirée). */
export function syllableLabels(text: string): string[] {
  return text
    .split(/\s+/)
    .map((s) => s.replace(/[.,!?;:…"«»“”()]/g, ""))
    .filter(Boolean);
}

export function loadReference(content: ContentIndex, concept: Concept, pitchRef: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<LoadedReference | null> {
  const url = mediaUrl(content, referencePath(concept, pitchRef));
  let pending = cache.get(url);
  if (!pending) {
    pending = fetchReference(url, fetchImpl).then((ref) => ref ?? (import.meta.env.DEV ? deriveFromAudio(content, concept, fetchImpl) : null));
    // Un échec (hors ligne…) ne doit pas rester en cache : on retentera au prochain affichage.
    void pending.then((r) => r === null && cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}

async function fetchReference(url: string, fetchImpl: typeof fetch): Promise<LoadedReference | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok || /html/i.test(res.headers.get("content-type") ?? "")) return null;
    return { reference: parsePitchReference(await res.text()), source: "file" };
  } catch {
    return null;
  }
}

async function deriveFromAudio(content: ContentIndex, concept: Concept, fetchImpl: typeof fetch): Promise<LoadedReference | null> {
  const track = concept.audio.find((a) => a.source === "native" && a.speed === "natural");
  if (!track || typeof OfflineAudioContext === "undefined") return null;
  try {
    const res = await fetchImpl(mediaUrl(content, track.src));
    if (!res.ok) return null;
    const decoded = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(await res.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! + data[i]! / decoded.numberOfChannels;
    }
    const tones = syllableLabels(concept.vi).map(toneOf);
    return { reference: toPitchReference(extractContour(mono, decoded.sampleRate), tones), source: "derived" };
  } catch {
    return null;
  }
}
