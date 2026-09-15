/**
 * Analyseur Server-Sent Events minimal (WHATWG « event stream ») pour un corps
 * lu via fetch + ReadableStream. Tolère les coupures de paquets n'importe où
 * (y compris au milieu d'un caractère UTF-8 ou d'un CRLF).
 */

export interface SseMessage {
  /** Champ `event:` (« message » par défaut). */
  event: string;
  data: string;
}

export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];
  private pendingCr = false;

  constructor(private readonly onMessage: (message: SseMessage) => void) {}

  push(chunk: string): void {
    let text = chunk;
    // Un CR en fin de paquet précédent suivi d'un LF : une seule fin de ligne.
    if (this.pendingCr && text.startsWith("\n")) text = text.slice(1);
    this.pendingCr = text.endsWith("\r");
    this.buffer += text;
    const lines = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.line(line);
  }

  /** Fin du flux : un dernier événement sans ligne vide finale est tout de même livré (tolérance serveur). */
  end(): void {
    if (this.buffer) this.line(this.buffer);
    this.buffer = "";
    this.line("");
  }

  private line(line: string): void {
    if (line === "") {
      if (this.data.length > 0) this.onMessage({ event: this.event || "message", data: this.data.join("\n") });
      this.event = "";
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
  }
}

/** Lit un corps SSE jusqu'au bout (ou jusqu'à l'abandon), message par message. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const queue: SseMessage[] = [];
  const parser = new SseParser((m) => queue.push(m));
  const abort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (done) {
        parser.push(decoder.decode());
        parser.end();
        yield* queue.splice(0);
        return;
      }
      parser.push(decoder.decode(value, { stream: true }));
      yield* queue.splice(0);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
