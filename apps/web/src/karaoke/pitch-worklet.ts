/**
 * AudioWorkletProcessor du karaoké tonal (SPEC §8.3) : F0 en temps réel dans le thread audio.
 * Chargé par `audioWorklet.addModule(url)` où url vient de `import url from "./pitch-worklet.ts?worker&url"` :
 * Vite le compile en un fichier autonome (dépendances incluses) en dev comme au build.
 *
 * Aucun échantillon ne quitte ce thread : seules les trames (f0, confiance, énergie, temps) sont postées.
 */
import { StreamingPitchTracker } from "@parlo/core/pitch";
import type { PitchFrame } from "@parlo/core/pitch";

// Portée globale d'AudioWorklet (absente de lib.dom) : déclarations locales au module.
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessorBase): void;
interface AudioWorkletProcessorBase {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessorBase; new (options?: unknown): AudioWorkletProcessorBase };

export type WorkletMessage = { type: "frames"; frames: PitchFrame[] };
export type WorkletCommand = { type: "stop" } | { type: "reset" };

class PitchProcessor extends AudioWorkletProcessor {
  private readonly tracker = new StreamingPitchTracker({ sampleRate });
  private running = true;

  constructor(options?: unknown) {
    super(options);
    this.port.onmessage = (event: MessageEvent<WorkletCommand>) => {
      if (event.data.type === "stop") this.running = false;
      if (event.data.type === "reset") this.tracker.reset();
    };
  }

  override process(inputs: Float32Array[][]): boolean {
    if (!this.running) return false;
    const channel = inputs[0]?.[0];
    if (channel) {
      const frames = this.tracker.push(channel);
      if (frames.length) this.port.postMessage({ type: "frames", frames } satisfies WorkletMessage);
    }
    return true;
  }
}

registerProcessor("parlo-pitch", PitchProcessor);
