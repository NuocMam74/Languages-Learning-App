/**
 * AudioWorkletProcessor du studio : copie les échantillons du micro (mono) vers le fil principal.
 * Contrairement au karaoké de l'apprenant, ici l'enregistrement est voulu : c'est la voix native de référence,
 * téléversée par un relecteur (contrat phase4 §1). Chargé via `?worker&url`.
 */

declare function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessorBase): void;
interface AudioWorkletProcessorBase {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessorBase; new (options?: unknown): AudioWorkletProcessorBase };

export type RecorderMessage = { type: "chunk"; samples: Float32Array };

class RecorderProcessor extends AudioWorkletProcessor {
  private running = true;

  constructor(options?: unknown) {
    super(options);
    this.port.onmessage = (event: MessageEvent<{ type: "stop" }>) => {
      if (event.data.type === "stop") this.running = false;
    };
  }

  override process(inputs: Float32Array[][]): boolean {
    if (!this.running) return false;
    const channel = inputs[0]?.[0];
    if (channel) {
      const samples = channel.slice();
      this.port.postMessage({ type: "chunk", samples } satisfies RecorderMessage, [samples.buffer]);
    }
    return true;
  }
}

registerProcessor("parlo-studio-recorder", RecorderProcessor);
