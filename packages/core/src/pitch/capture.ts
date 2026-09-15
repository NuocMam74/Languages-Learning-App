import type { Tone } from "../types.ts";
import type { PitchReference } from "./contour.ts";
import { scorePronunciation, type PronunciationScore, type ToneIssue } from "./score.ts";
import { DEFAULT_HOP_MS, type PitchFrame } from "./yin.ts";

/**
 * Prise micro du karaoké tonal (SPEC §8.3) : découpage de la parole dans le flux de trames
 * de `StreamingPitchTracker`, sans DOM (testable en Node, utilisable dans le navigateur).
 *
 *  1. Début de prise = une attaque voisée précédée d'au moins `onsetQuietMs` (200 ms) de calme, ou, tout au
 *     début, d'au moins `startQuietMs` (100 ms) de calme « réel » depuis le toucher (les trames d'énergie
 *     strictement nulle d'un flux qui n'a pas encore démarré ne comptent pas comme du calme). Une voix déjà en cours au toucher (fin de
 *     l'audio natif dans le haut-parleur, annulation d'écho désactivée ; ou phrase commencée trop tôt) est
 *     ignorée jusqu'au prochain calme : on ne note jamais une fin de phrase comme une phrase.
 *  2. Pendant la prise : arrêt après `trailingSilenceMs` (1,2 s) de silence suivant au moins `minSpeechMs`
 *     de voix, ou après `maxMs` (6 s) de prise. Sans attaque en `maxWaitMs` (6 s) : fin, rien entendu.
 *  3. Les trames retenues commencent à l'attaque (avec ~100 ms de calme avant) : la note porte sur la
 *     partie voisée (DTW sur les trames voisées), jamais sur le temps écoulé depuis le toucher.
 *  4. Affichage en direct : demi-tons relatifs à la médiane glissante des F0 voisées de la prise
 *     (la normalisation finale est refaite sur toute la prise par `contourFromFrames`).
 */

export interface CaptureOptions {
  hopMs?: number;
  /** Durée maximale d'une prise, depuis l'attaque (défaut 6 s). */
  maxMs?: number;
  /** Attente maximale d'une attaque après le toucher (défaut 6 s). */
  maxWaitMs?: number;
  /** Silence après la parole qui clôt la prise (défaut 1,2 s). */
  trailingSilenceMs?: number;
  /** Calme requis avant une attaque (défaut 200 ms). */
  onsetQuietMs?: number;
  /** Calme réel minimal depuis le toucher pour accepter une attaque en tout début de prise (défaut 100 ms). */
  startQuietMs?: number;
  /** Calme conservé avant l'attaque (défaut 100 ms). */
  preRollMs?: number;
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
  maxWaitMs: 6000,
  trailingSilenceMs: 1200,
  onsetQuietMs: 200,
  startQuietMs: 100,
  preRollMs: 100,
  minSpeechMs: 150,
  minConfidence: 0.7,
  minRms: 0.003,
  silenceDb: -30,
};

/** waiting : pas encore d'attaque valide ; speaking : prise en cours ; done : terminée. */
export type CapturePhase = "waiting" | "speaking" | "done";
export type CaptureStopReason = "silence" | "max" | "manual";

export interface LivePoint {
  /** ms depuis le début des trames retenues. */
  t: number;
  /** Demi-tons relatifs à la médiane glissante, null = non voisé. */
  st: number | null;
}

export class PitchCapture {
  readonly options: Required<CaptureOptions>;
  /** Trames retenues (calme avant l'attaque compris), à passer à `contourFromFrames`. */
  readonly frames: PitchFrame[] = [];
  /** Points d'affichage, un par trame retenue. */
  readonly live: LivePoint[] = [];
  phase: CapturePhase = "waiting";
  stopReason: CaptureStopReason | null = null;
  /** Nombre d'attaques ignorées (voix déjà en cours sans calme suffisant avant). */
  rejectedOnsets = 0;

  private seen = 0;
  private takeFrames = 0;
  private quietRun = 0;
  private realQuietFromStart = 0;
  private voiceSeen = false;
  private flowing = false;
  private inRejectedVoice = false;
  private silenceRun = 0;
  private speechFrames = 0;
  private peakRms = 0;
  private preRoll: PitchFrame[] = [];
  private readonly sortedHz: number[] = [];

  constructor(options: CaptureOptions = {}) {
    this.options = { ...CAPTURE_DEFAULTS, ...options };
  }

  private frames_(ms: number): number {
    return Math.max(1, Math.round(ms / this.options.hopMs));
  }

  /** Durée écoulée depuis le toucher (ms). */
  get elapsedMs(): number {
    return this.seen * this.options.hopMs;
  }

  /** Durée de la prise depuis l'attaque (ms). */
  get takeMs(): number {
    return this.takeFrames * this.options.hopMs;
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

    if (this.phase === "waiting") {
      if (frame.rms > 0) this.flowing = true;
      if (!voiced) {
        // Zéros numériques d'un flux qui n'a pas encore démarré : ce n'est pas du calme observé.
        if (this.flowing) this.quietRun++;
        if (!this.voiceSeen && this.flowing) this.realQuietFromStart++;
        if (this.quietRun >= this.frames_(o.onsetQuietMs)) this.inRejectedVoice = false;
        this.preRoll.push(frame);
        if (this.preRoll.length > this.frames_(o.preRollMs)) this.preRoll.shift();
      } else {
        const atStart = !this.voiceSeen && this.realQuietFromStart >= this.frames_(o.startQuietMs);
        const afterQuiet = this.quietRun >= this.frames_(o.onsetQuietMs);
        this.voiceSeen = true;
        if (!this.inRejectedVoice && (atStart || afterQuiet)) {
          this.phase = "speaking";
          for (const quiet of this.preRoll) this.keep(quiet, false);
          this.preRoll = [];
        } else {
          if (!this.inRejectedVoice) this.rejectedOnsets++;
          this.inRejectedVoice = true;
          this.quietRun = 0;
        }
      }
      if (this.phase === "waiting") return this.seen >= this.frames_(o.maxWaitMs) ? this.finish("max") : this.phase;
    }

    this.keep(frame, voiced);
    if (voiced) {
      this.speechFrames++;
      this.silenceRun = 0;
    } else {
      this.silenceRun++;
    }
    if (this.speechFrames >= this.frames_(o.minSpeechMs) && this.silenceRun >= this.frames_(o.trailingSilenceMs)) return this.finish("silence");
    if (this.takeMs >= o.maxMs) return this.finish("max");
    return this.phase;
  }

  private keep(frame: PitchFrame, voiced: boolean): void {
    this.frames.push(frame);
    this.takeFrames++;
    let st: number | null = null;
    if (voiced && frame.f0 !== null) {
      insertSorted(this.sortedHz, frame.f0);
      st = 12 * Math.log2(frame.f0 / medianOfSorted(this.sortedHz));
    }
    this.live.push({ t: (this.frames.length - 1) * this.options.hopMs, st });
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
  /** Score retenu 0–100, ou null si la prise n'est pas notée (rien entendu, ou seulement une partie). */
  score: number | null;
  /** Score de superposition brut (avant contrôle de classe de ton). */
  raw: number;
  hints: SpeechHint[];
  /** tone_produce : la forme de la syllabe correspond-elle à la classe de ton attendue ? */
  toneOk: boolean;
  /** Prise trop courte par rapport à la référence (partie de phrase) : à recommencer, non notée. */
  partial?: boolean;
  /** Durée voisée utilisateur / durée voisée de référence. */
  coverage?: number;
}

/** Durée voisée (ms) d'une courbe. */
export function voicedMs(track: readonly (number | null)[], hopMs: number): number {
  let n = 0;
  for (const v of track) if (v !== null) n++;
  return n * hopMs;
}

/** Part minimale de la durée voisée de référence pour qu'une prise soit notée. */
export const MIN_TAKE_COVERAGE = 0.4;

/**
 * Note complète d'une prise : refuse une prise partielle (durée voisée < 40 % de celle de la référence :
 * début ou fin de phrase perdus) au lieu de lui donner une note absurde, puis `gradeSpeech`.
 */
export function gradeTake(
  user: { st: readonly (number | null)[]; hopMs: number },
  reference: PitchReference,
  mode: "repeat" | "tone",
  passScore: number,
  minCoverage = MIN_TAKE_COVERAGE,
): { grade: SpeechGrade; result: PronunciationScore | null } {
  const refMs = voicedMs(reference.st, reference.hopMs);
  const coverage = refMs > 0 ? voicedMs(user.st, user.hopMs) / refMs : 0;
  if (coverage === 0) return { grade: { score: null, raw: 0, hints: [], toneOk: false, coverage }, result: null };
  if (coverage < minCoverage) return { grade: { score: null, raw: 0, hints: [], toneOk: false, partial: true, coverage }, result: null };
  const result = scorePronunciation({ st: [...user.st], hopMs: user.hopMs }, reference);
  return { grade: { ...gradeSpeech(result, mode, passScore), coverage }, result };
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
