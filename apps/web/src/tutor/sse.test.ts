import { afterEach, describe, expect, it } from "vitest";
import { configureApi, setAccessToken } from "../api.ts";
import { sendMessage, toTutorEvent, type TutorEvent } from "./client.ts";
import { readSse, SseParser, type SseMessage } from "./sse.ts";

/** Flux SSE de Cô Mai lu via fetch + ReadableStream (contrat phase 3 §1). */

function parseAll(chunks: string[]): SseMessage[] {
  const out: SseMessage[] = [];
  const parser = new SseParser((m) => out.push(m));
  for (const c of chunks) parser.push(c);
  parser.end();
  return out;
}

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? encoder.encode(c) : c);
      controller.close();
    },
  });
}

describe("SseParser", () => {
  it("découpe les événements, quel que soit le découpage des paquets", () => {
    const body = 'event: sentence\ndata: {"text":"Dạ."}\n\n: ping\r\nevent: done\r\ndata: {"turn":1,"remainingToday":4}\r\n\r\n';
    const expected = [
      { event: "sentence", data: '{"text":"Dạ."}' },
      { event: "done", data: '{"turn":1,"remainingToday":4}' },
    ];
    expect(parseAll([body])).toEqual(expected);
    // Un caractère à la fois, CRLF coupé compris.
    expect(parseAll([...body])).toEqual(expected);
  });

  it("joint les lignes data multiples et livre un dernier événement sans ligne vide", () => {
    expect(parseAll(["data: a\ndata: b\n\ndata:c"])).toEqual([
      { event: "message", data: "a\nb" },
      { event: "message", data: "c" },
    ]);
  });

  it("décode l'UTF-8 coupé au milieu d'un caractère", async () => {
    const bytes = new TextEncoder().encode('data: {"text":"Cần Thơ"}\n\n');
    const cut = bytes.indexOf(0xba) - 1; // à l'intérieur de « ầ »
    const messages: SseMessage[] = [];
    for await (const m of readSse(streamOf([bytes.slice(0, cut), bytes.slice(cut)]))) messages.push(m);
    expect(JSON.parse(messages[0]!.data)).toEqual({ text: "Cần Thơ" });
  });
});

describe("toTutorEvent", () => {
  it("accepte le nom dans event: ou dans le JSON", () => {
    expect(toTutorEvent({ event: "sentence", data: '{"text":"Dạ, em khỏe."}' })).toEqual({ type: "sentence", text: "Dạ, em khỏe." });
    expect(toTutorEvent({ event: "message", data: '{"event":"gloss","data":{"vi":"nghen","gloss":{"fr":"hein"}}}' })).toEqual({ type: "gloss", vi: "nghen", gloss: { fr: "hein" } });
    expect(toTutorEvent({ event: "message", data: '{"type":"fallback","text":"Cô Mai se repose.","reason":"quota"}' })).toEqual({ type: "fallback", text: "Cô Mai se repose.", reason: "quota" });
  });

  it("ignore les événements inconnus ou mal formés", () => {
    expect(toTutorEvent({ event: "ping", data: "{}" })).toBeNull();
    expect(toTutorEvent({ event: "sentence", data: "Dạ" })).toBeNull();
    expect(toTutorEvent({ event: "sentence", data: '{"text":""}' })).toBeNull();
  });
});

describe("sendMessage", () => {
  afterEach(() => setAccessToken(null));

  const sse = (body: string) => new Response(streamOf([body]), { status: 200, headers: { "Content-Type": "text/event-stream" } });

  it("rafraîchit le jeton une fois sur 401 avant le flux, puis lit les événements", async () => {
    const calls: { url: string; auth: string | null; body: unknown }[] = [];
    configureApi({
      base: "/api",
      fetch: async (url, init) => {
        const auth = new Headers(init?.headers).get("Authorization");
        calls.push({ url, auth, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (url === "/api/auth/refresh") return new Response(JSON.stringify({ accessToken: "fresh", tokenType: "bearer", expiresIn: 900 }), { status: 200 });
        if (auth !== "Bearer fresh") return new Response(JSON.stringify({ detail: "expired" }), { status: 401 });
        return sse('event: sentence\ndata: {"text":"Dạ."}\n\nevent: correction\ndata: {"original":"em khoe","corrected":"em khỏe","explanation":"ton"}\n\nevent: done\ndata: {"turn":2,"remainingToday":7}\n\n');
      },
    });
    setAccessToken("stale");
    const events: TutorEvent[] = [];
    for await (const e of sendMessage("c1", { text: "em khoe", inputMode: "text" })) events.push(e);
    expect(calls.map((c) => c.url)).toEqual(["/api/tutor/conversations/c1/messages", "/api/auth/refresh", "/api/tutor/conversations/c1/messages"]);
    expect(calls[2]!.body).toEqual({ text: "em khoe", inputMode: "text" });
    expect(events.map((e) => e.type)).toEqual(["sentence", "correction", "done"]);
    expect(events[2]).toEqual({ type: "done", turn: 2, remainingToday: 7 });
  });

  it("s'arrête proprement quand on abandonne (démontage de l'écran)", async () => {
    const controller = new AbortController();
    configureApi({
      base: "/api",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('event: sentence\ndata: {"text":"Một."}\n\n'));
              // jamais fermé : le serveur « réfléchit »
            },
          }),
          { status: 200 },
        ),
    });
    setAccessToken("t");
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const e of sendMessage("c1", { text: "x", inputMode: "text" }, controller.signal)) {
          seen.push(e.type);
          controller.abort();
        }
      })(),
    ).rejects.toThrow();
    expect(seen).toEqual(["sentence"]);
  });
});
