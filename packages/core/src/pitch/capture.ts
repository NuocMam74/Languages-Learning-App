import type { Tone } from "../types.ts";
import type { PitchReference } from "./contour.ts";
import type { PronunciationScore, ToneIssue } from "./score.ts";
import { DEFAULT_HOP_MS, type PitchFrame } from "./yin.ts";

/**
 * Prise micro du karaoké tonal (SPEC §8.3) : découpage de la parole dans le flux de trames
 * de `StreamingPitchTracker`, sans DOM (testable en Node, utilisable dans le navigateur).
 *
 *  1. Armement : si la toute première trame est déjà voisée (personne ne commence à parler dans les 40 ms
 *     qui suivent le toucher : c'est la fin de l'audio natif qui sort du haut-parleur, l'annulation d'écho
 *     étant désactivée pour ne pas déformer la hauteur), on ignore la voix jusqu'à `armQuietMs` de calme.
 *     Sinon la prise est armée immédiatement.
 *  2. Parole : dès `minSpeechMs` de trames voisées, la prise s'arrête après `trailingSilenceMs`
 *     de silence continu, ou au plus tard après `maxMs`.
 *  3. Affichage en direct : demi-tons relatifs à la médiane glissante des F0 voisées déjà vues
 *     (la normalisation finale, elle, est refaite sur toute la prise par `contourFromFrames`).
 */

export interface CaptureOptions {
  hopMs?: number;
  /** Durée maximale d'une prise (défaut 6 s). */
  maxMs?: number;
  /** Silence après la parole qui clôt la prise (défaut 1,2 s). */
  trailingSilenceMs?: number;
  /** Calme requis avant d'accepter la parole quand la prise démarre sur une voix déjà en cours (défaut 250 ms). */
  armQuietMs?: number;
  /** Parole voisée minimale avant qu'un silence puisse clore la prise (défaut 150 ms). */
  minSpeechMs?: number;
  minConfidence?: number;
  /** Énergie RMS minimale absolue d'une trame voisée (défaut 0,003 ≈ −50 dBFS). */
  minRms?: number;
  /** Énergie minimale relative à la trame la plus forte vue jusqu'ici (défaut −30 dB). */
  silenceDb?: number;
}

export const CAPTURE_DEFAULTS: Required<CaptureOptions> = {
  hopMs: DEFAULT_HOP_MS,
  maxMs: 6000,
  trailingSilenceMs: 1200,
  armQuietMs: 250,
  minSpeechMs: 150,
  minConfidence: 0.7,
  minRms: 0.003,
  silenceDb: -30,
};

export type CapturePhase = "arming" | "waiting" | "speaking" | "done";
export type CaptureStopReason = "silence" | "max" | "manual";

export interface LivePoint {
  /** ms depuis l'armement. */
  t: number;
  /** Demi-tons relatifs à la médiane glissante, null = non voisé. */
  st: number | null;
}

export class PitchCapture {
  readonly options: Required<CaptureOptions>;
  /** Trames retenues (à partir de l'armement), à passer à `contourFromFrames`. */
  readonly frames: PitchFrame[] = [];
  /** Points d'affichage, un par trame retenue. */
  readonly live: LivePoint[] = [];
  phase: CapturePhase = "arming";
  stopReason: CaptureStopReason | null = null;

  private seen = 0;
  private quietRun = 0;
  private silenceRun = 0;
  private speechFrames = 0;
  private peakRms = 0;
  private readonly sortedHz: number[] = [];

  constructor(options: CaptureOptions = {}) {
    this.options = { ...CAPTURE_DEFAULTS, ...options };
  }

  private frames_(ms: number): number {
    return Math.max(1, Math.round(ms / this.options.hopMs));
  }

  /** Durée écoulée depuis le début de la prise (ms), armement compris. */
  get elapsedMs(): number {
    return this.seen * this.options.hopMs;
  }

  /** Parole voisée cumulée (ms). */
  get speechMs(): number {
    return this.speechFrames * this.options.hopMs;
  }

  /** Porte de voisement en ligne (seuil relatif à la trame la plus forte vue jusqu'ici). */
  isVoiced(frame: PitchFrame): boolean {
    const o = this.options;
    this.peakRms = Math.max(this.peakRms, frame.rms);
    const gate = Math.max(o.minRms, this.peakRms * 10 ** (o.silenceDb / 20));
    return frame.f0 !== null && frame.confidence >= o.minConfidence && frame.rms >= gate;
  }

  /** Ajoute une trame ; retourne la phase après cette trame. */
  push(frame: PitchFrame): CapturePhase {
    if (this.phase === "done") return this.phase;
    this.seen++;
    const o = this.options;
    const voiced = this.isVoiced(frame);

    if (this.phase === "arming" && this.seen === 1 && !voiced) this.phase = "waiting";
    if (this.phase === "arming") {
      this.quietRun = voiced ? 0 : this.quietRun + 1;
      if (this.quietRun >= this.frames_(o.armQuietMs)) this.phase = "waiting";
    } else {
      this.frames.push(frame);
      let st: number | null = null;
      if (voiced && frame.f0 !== null) {
        insertSorted(this.sortedHz, frame.f0);
        st = 12 * Math.log2(frame.f0 / medianOfSorted(this.sortedHz));
        this.speechFrames++;
        this.silenceRun = 0;
        if (this.phase === "waiting") this.phase = "speaking";
      } else {
        this.silenceRun++;
      }
      this.live.push({ t: (this.frames.length - 1) * o.hopMs, st });
      if (this.speechFrames >= this.frames_(o.minSpeechMs) && this.silenceRun >= this.frames_(o.trailingSilenceMs)) {
        return this.finish("silence");
      }
    }
    if (this.elapsedMs >= o.maxMs) return this.finish("max");
    return this.phase;
  }

  /** Arrêt (bouton « Arrêter », perte du micro…). */
  finish(reason: CaptureStopReason = "manual"): CapturePhase {
    if (this.phase !== "done") {
      this.phase = "done";
      this.stopReason = reason;
    }
    return this.phase;
  }

  /** Assez de parole pour tenter une note ? */
  get heardSpeech(): boolean {
    return this.speechFrames >= this.frames_(this.options.minSpeechMs);
  }
}

function insertSorted(arr: number[], value: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, value);
}

function medianOfSorted(arr: readonly number[]): number {
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid]! : (arr[mid - 1]! + arr[mid]!) / 2;
}

/* ------------------------------------------------------------------ */
/* Note finale                                                         */
/* ------------------------------------------------------------------ */

/**
 * Pour `tone_produce` (une syllabe) : si la référence n'a pas de syllabes, on en crée une,
 * couvrant toute la courbe, avec le ton écrit du mot — les diagnostics de ton s'appliquent alors.
 */
export function withSingleSyllable(reference: PitchReference, tone: Tone): PitchReference {
  if (reference.syllables?.length) return reference;
  return { ...reference, syllables: [{ start: 0, end: reference.st.length * reference.hopMs, tone }] };
}

export interface SpeechHint {
  index: number;
  tone: Tone;
  issue: ToneIssue;
}

export interface SpeechGrade {
  /** Score retenu 0–100, ou null si rien d'exploitable n'a été entendu. */
  score: number | null;
  /** Score de superposition brut (avant contrôle de classe de ton). */
  raw: number;
  hints: SpeechHint[];
  /** tone_produce : la forme de la syllabe correspond-elle à la classe de ton attendue ? */
  toneOk: boolean;
}

/**
 * Note d'une prise. `repeat` (speak_repeat, karaoké) = score de superposition.
 * `tone` (tone_produce) = même score, mais un défaut de forme détecté sur la syllabe
 * (trop plat, pas assez bas/haut, sans creux, trop long) plafonne la note sous le seuil de réussite :
 * une courbe « presque superposée » avec le mauvais ton ne doit pas valider l'exercice.
 */
export function gradeSpeech(result: PronunciationScore, mode: "repeat" | "tone", passScore: number): SpeechGrade {
  const hints: SpeechHint[] = (result.perSyllable ?? []).flatMap((s) => (s.issue ? [{ index: s.index, tone: s.tone, issue: s.issue }] : []));
  if (!result.voiced) return { score: null, raw: 0, hints: [], toneOk: false };
  const toneOk = hints.length === 0;
  const score = mode === "tone" && !toneOk ? Math.min(result.score, passScore - 1) : result.score;
  return { score, raw: result.score, hints, toneOk };
}
