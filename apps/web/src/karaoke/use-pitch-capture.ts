import { PitchCapture, type CaptureStopReason, type PitchFrame } from "@parlo/core/pitch";
import { useCallback, useEffect, useRef, useState } from "react";
import workletUrl from "./pitch-worklet.ts?worker&url";
import type { WorkletMessage } from "./pitch-worklet.ts";

/**
 * Capture micro → AudioWorklet (F0) → PitchCapture (découpage) sur le fil principal.
 * 100 % local (SPEC §8.3, §14) : aucun échantillon n'est gardé ni envoyé, seules des trames de F0
 * vivent en mémoire le temps de la prise. Le micro est coupé dès la fin de chaque prise.
 *
 * idle → requesting → recording → processing → done | denied | unsupported
 */

export type CaptureState = "idle" | "requesting" | "recording" | "processing" | "done" | "denied" | "unsupported";

export interface Take {
  frames: PitchFrame[];
  heardSpeech: boolean;
  stopReason: CaptureStopReason | null;
  durationMs: number;
  /** Attaques ignorées (voix déjà en cours au toucher). */
  rejectedOnsets: number;
}

export type MicPermission = "granted" | "denied" | "prompt" | "unknown";

export function captureSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined";
}

/** État de la permission sans la demander (pour savoir s'il faut l'écran d'explication). */
export async function micPermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** Filet de sécurité si les trames n'arrivent plus : attente d'attaque (6 s) + prise (6 s) + marge. */
const HARD_TIMEOUT_MS = 13_000;

interface Running {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  sink: GainNode;
  timer: ReturnType<typeof setTimeout>;
}

export function usePitchCapture<R>(analyze: (take: Take) => R) {
  const [state, setState] = useState<CaptureState>(() => (captureSupported() ? "idle" : "unsupported"));
  const [result, setResult] = useState<R | null>(null);
  /** Nombre de prises lancées (micro ouvert), pour l'interface et les tests. */
  const [takes, setTakes] = useState(0);
  /** Prise en cours : lue à chaque image par le tracé en direct (pas de rendu React par trame). */
  const capture = useRef<PitchCapture | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const moduleReady = useRef<Promise<void> | null>(null);
  const running = useRef<Running | null>(null);
  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;
  const mounted = useRef(true);

  const release = useCallback(() => {
    const r = running.current;
    running.current = null;
    if (!r) return;
    clearTimeout(r.timer);
    r.node.port.onmessage = null;
    r.node.port.postMessage({ type: "stop" });
    r.source.disconnect();
    r.node.disconnect();
    r.sink.disconnect();
    for (const track of r.stream.getTracks()) track.stop();
  }, []);

  const complete = useCallback(
    (reason: CaptureStopReason) => {
      const c = capture.current;
      if (!c || !running.current) return;
      c.finish(reason);
      release();
      setState("processing");
      // On laisse le navigateur peindre « analyse » avant le calcul (DTW : quelques ms).
      setTimeout(() => {
        if (!mounted.current) return;
        const take: Take = { frames: c.frames, heardSpeech: c.heardSpeech, stopReason: c.stopReason, durationMs: c.takeMs, rejectedOnsets: c.rejectedOnsets };
        setResult(analyzeRef.current(take));
        setState("done");
      }, 16);
    },
    [release],
  );

  const start = useCallback(async () => {
    if (!captureSupported()) {
      setState("unsupported");
      return;
    }
    if (running.current) return;
    setResult(null);
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Traitements désactivés : ils déforment la hauteur et l'énergie mesurées.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported");
      return;
    }
    if (!mounted.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    try {
      const audio = (ctx.current ??= new AudioContext());
      await audio.resume();
      moduleReady.current ??= audio.audioWorklet.addModule(workletUrl);
      await moduleReady.current;
      const source = audio.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(audio, "parlo-pitch", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      // Relié à la sortie par un gain nul : certains navigateurs ne font tourner que les nœuds reliés.
      const sink = audio.createGain();
      sink.gain.value = 0;
      source.connect(node).connect(sink).connect(audio.destination);
      const c = new PitchCapture();
      capture.current = c;
      node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        if (event.data.type !== "frames") return;
        for (const frame of event.data.frames) {
          if (c.push(frame) === "done") {
            complete(c.stopReason ?? "silence");
            return;
          }
        }
      };
      const timer = setTimeout(() => complete("max"), HARD_TIMEOUT_MS);
      running.current = { stream, source, node, sink, timer };
      // Micro coupé par le système (autre appli, casque débranché) : on clôt la prise.
      for (const track of stream.getTracks()) track.addEventListener("ended", () => complete("manual"));
      setTakes((n) => n + 1);
      setState("recording");
    } catch {
      for (const track of stream.getTracks()) track.stop();
      moduleReady.current = null;
      setState("unsupported");
    }
  }, [complete]);

  const stop = useCallback(() => complete("manual"), [complete]);

  const reset = useCallback(() => {
    release();
    capture.current = null;
    setResult(null);
    setState(captureSupported() ? "idle" : "unsupported");
  }, [release]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      release();
      void ctx.current?.close().catch(() => undefined);
      ctx.current = null;
      moduleReady.current = null;
    };
  }, [release]);

  return { state, result, capture, takes, start, stop, reset };
}
