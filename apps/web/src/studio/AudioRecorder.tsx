import { toneOf, type Tone } from "@parlo/core";
import { extractContour, serializePitchReference, toPitchReference, type PitchReference } from "@parlo/core/pitch";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import workletUrl from "./recorder-worklet.ts?worker&url";
import type { RecorderMessage } from "./recorder-worklet.ts";
import { SelectField, SmallButton, type IdOption } from "./fields.tsx";
import { st, studioLocale } from "./i18n.ts";
import { getAudioPreview, uploadAudio, type AudioUploadResult } from "./studio-api.ts";
import { encodeWav, findVoiceBounds, resample, STUDIO_SAMPLE_RATE, waveformPeaks } from "./wav.ts";

/**
 * Enregistrement de l'audio natif d'un concept (contrat phase4 §1) :
 * micro 48 kHz mono (AudioWorklet) → silences retirés → forme d'onde + courbe F0 (@parlo/core/pitch)
 * → WAV + référence de hauteur téléversés ; le serveur produit les versions naturelle et lente.
 */

type Phase = "idle" | "requesting" | "recording" | "ready" | "uploading" | "done" | "denied" | "unsupported" | "silent" | "error";

const MAX_MS = 15_000;

interface Take {
  raw: Float32Array;
  bounds: { start: number; end: number };
  trimmed: Float32Array;
  reference: PitchReference | null;
}

const syllableTones = (vi: string): Tone[] =>
  vi
    .split(/\s+/)
    .map((s) => s.replace(/[.,!?;:…"«»“”()]/g, ""))
    .filter(Boolean)
    .map(toneOf);

function analyze(raw: Float32Array, vi: string): Take | null {
  const bounds = findVoiceBounds(raw, STUDIO_SAMPLE_RATE);
  if (!bounds) return null;
  const trimmed = raw.slice(bounds.start, bounds.end);
  let reference: PitchReference | null = null;
  try {
    reference = toPitchReference(extractContour(trimmed, STUDIO_SAMPLE_RATE), syllableTones(vi));
  } catch {
    reference = null;
  }
  return { raw, bounds, trimmed, reference };
}

function Plot({ take }: { take: Take }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 180;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const total = take.raw.length;
    const x = (sample: number) => (sample / total) * w;
    // Zone gardée (silences retirés) en fond.
    g.fillStyle = "rgba(14,94,85,0.08)";
    g.fillRect(x(take.bounds.start), 0, x(take.bounds.end) - x(take.bounds.start), h);
    // Forme d'onde.
    const mid = h * 0.5;
    g.fillStyle = "rgba(58,58,52,0.55)";
    waveformPeaks(take.raw, Math.max(1, Math.floor(w))).forEach(([min, max], col) => {
      g.fillRect(col, mid - max * mid * 0.9, 1, Math.max(1, (max - min) * mid * 0.9));
    });
    // Courbe de hauteur (demi-tons), placée sur la zone gardée.
    const ref = take.reference;
    if (ref && ref.st.length > 1) {
      const range = Math.max(4, ...ref.st.map((v) => (v === null ? 0 : Math.abs(v) + 1)));
      const x0 = x(take.bounds.start);
      const span = x(take.bounds.end) - x0;
      g.strokeStyle = "#E5A21B";
      g.lineWidth = 3;
      g.lineCap = "round";
      g.beginPath();
      let open = false;
      ref.st.forEach((v, i) => {
        if (v === null) {
          open = false;
          return;
        }
        const px = x0 + (i / (ref.st.length - 1)) * span;
        const py = mid - (v / range) * (mid - 8);
        if (open) g.lineTo(px, py);
        else g.moveTo(px, py);
        open = true;
      });
      g.stroke();
    }
  }, [take]);
  return (
    <figure className="flex flex-col gap-1">
      <canvas ref={canvas} role="img" aria-label={st("recorder.plot")} className="h-44 w-full rounded-2xl bg-white/80" data-testid="recorder-plot" />
      <figcaption className="flex flex-wrap gap-4 text-sm text-phu-sa">
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-5 rounded bg-phu-sa/50" />{st("recorder.legend.wave")}</span>
        <span className="flex items-center gap-2"><span className="inline-block h-1.5 w-5 rounded-full bg-nghe" />{st("recorder.legend.pitch")}</span>
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-5 rounded bg-ngoc/10" />{st("recorder.legend.kept")}</span>
      </figcaption>
    </figure>
  );
}

function PreviewAudio({ code, path }: { code: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    getAudioPreview(code, path)
      .then((blob) => {
        if (!alive) return;
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [code, path]);
  if (failed) return <span className="text-sm text-son-mai">{st("recorder.previewFailed")}</span>;
  return url ? <audio controls src={url} className="w-full max-w-sm" aria-label={path} /> : <span className="text-sm text-phu-sa">{st("common.loading")}</span>;
}

export function AudioRecorder({ code, conceptId, vi, voices, beforeUpload, onUploaded }: {
  code: string;
  conceptId: string;
  vi: string;
  voices: readonly IdOption[];
  beforeUpload: () => Promise<void>;
  onUploaded: (result: AudioUploadResult) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [take, setTake] = useState<Take | null>(null);
  const [voice, setVoice] = useState<string | undefined>(voices[0]?.id);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<AudioUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<{ ctx: AudioContext; stream: MediaStream; node: AudioWorkletNode; source: MediaStreamAudioSourceNode; chunks: Float32Array[]; startedAt: number; timer: ReturnType<typeof setInterval> } | null>(null);
  const player = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!voice && voices[0]) setVoice(voices[0].id);
  }, [voices, voice]);

  const release = () => {
    const s = session.current;
    session.current = null;
    if (!s) return null;
    clearInterval(s.timer);
    s.node.port.postMessage({ type: "stop" });
    s.node.port.onmessage = null;
    s.source.disconnect();
    s.node.disconnect();
    for (const track of s.stream.getTracks()) track.stop();
    const rate = s.ctx.sampleRate;
    void s.ctx.close().catch(() => undefined);
    return { chunks: s.chunks, rate };
  };

  useEffect(
    () => () => {
      release();
      void player.current?.close().catch(() => undefined);
    },
    [],
  );

  const stop = () => {
    const done = release();
    if (!done) return;
    const length = done.chunks.reduce((n, c) => n + c.length, 0);
    const joined = new Float32Array(length);
    let offset = 0;
    for (const c of done.chunks) {
      joined.set(c, offset);
      offset += c.length;
    }
    const raw = resample(joined, done.rate, STUDIO_SAMPLE_RATE);
    const analyzed = analyze(raw, vi);
    setTake(analyzed);
    setPhase(analyzed ? "ready" : "silent");
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      setPhase("unsupported");
      return;
    }
    setTake(null);
    setResult(null);
    setError(null);
    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: STUDIO_SAMPLE_RATE, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported");
      return;
    }
    try {
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: STUDIO_SAMPLE_RATE });
      } catch {
        ctx = new AudioContext();
      }
      await ctx.resume();
      await ctx.audioWorklet.addModule(workletUrl);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "parlo-studio-recorder", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node).connect(sink).connect(ctx.destination);
      const chunks: Float32Array[] = [];
      node.port.onmessage = (event: MessageEvent<RecorderMessage>) => {
        if (event.data.type === "chunk") chunks.push(event.data.samples);
      };
      const startedAt = performance.now();
      const timer = setInterval(() => {
        const ms = performance.now() - startedAt;
        setElapsed(ms);
        if (ms >= MAX_MS) stop();
      }, 100);
      session.current = { ctx, stream, node, source, chunks, startedAt, timer };
      setElapsed(0);
      setPhase("recording");
    } catch {
      for (const track of stream.getTracks()) track.stop();
      setPhase("unsupported");
    }
  };

  const listen = async () => {
    if (!take) return;
    const ctx = (player.current ??= new AudioContext());
    await ctx.resume();
    const buffer = ctx.createBuffer(1, take.trimmed.length, STUDIO_SAMPLE_RATE);
    buffer.copyToChannel(new Float32Array(take.trimmed), 0);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.start();
  };

  const upload = async () => {
    if (!take || !voice) return;
    setPhase("uploading");
    setError(null);
    try {
      await beforeUpload();
      const wav = new Blob([encodeWav(take.trimmed, STUDIO_SAMPLE_RATE)], { type: "audio/wav" });
      const res = await uploadAudio(code, {
        file: wav,
        fileName: `${conceptId}_${voice}.wav`,
        conceptId,
        voice,
        pitch: take.reference ? serializePitchReference(take.reference) : null,
      });
      setResult(res);
      setPhase("done");
      onUploaded(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("ready");
    }
  };

  const seconds = (samples: number) => (samples / STUDIO_SAMPLE_RATE).toLocaleString(studioLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  return (
    <div className="flex flex-col gap-4 rounded-2xl border-2 border-ngoc/20 bg-white/60 p-4" data-testid="audio-recorder">
      <h3 className="font-semibold">{st("recorder.title")}</h3>
      <p className="text-sm text-phu-sa">{st("recorder.hint")}</p>
      <p lang="vi" className="font-serif text-vi">{vi || "…"}</p>
      <SelectField label={st("recorder.voice")} path="recorder.voice" value={voice} options={voices.map((v) => ({ value: v.id, label: v.label }))} onChange={setVoice} />

      <div className="flex flex-wrap gap-2" aria-live="polite">
        {phase === "recording" ? (
          <SmallButton tone="primary" onClick={stop}>{st("recorder.stop", { s: (elapsed / 1000).toFixed(1) })}</SmallButton>
        ) : (
          <SmallButton tone="primary" onClick={() => void start()} disabled={phase === "requesting" || phase === "uploading"}>
            {take ? st("recorder.again") : st("recorder.start")}
          </SmallButton>
        )}
        {take && phase !== "recording" && <SmallButton onClick={() => void listen()}>{st("recorder.listen")}</SmallButton>}
        {take && phase !== "recording" && (
          <SmallButton tone="primary" onClick={() => void upload()} disabled={!voice || phase === "uploading"}>
            {phase === "uploading" ? st("recorder.uploading") : st("recorder.upload")}
          </SmallButton>
        )}
      </div>

      {phase === "recording" && <p role="status">{st("recorder.recording")}</p>}
      {phase === "denied" && <p role="alert" className="text-son-mai">{st("recorder.denied")}</p>}
      {phase === "unsupported" && <p role="alert" className="text-son-mai">{st("recorder.unsupported")}</p>}
      {phase === "silent" && <p role="alert" className="text-son-mai">{st("recorder.silent")}</p>}
      {error && <p role="alert" className="text-son-mai">{st("recorder.uploadFailed", { message: error })}</p>}

      {take && (
        <>
          <Plot take={take} />
          <p className="text-sm" data-testid="recorder-summary">
            {st("recorder.duration", { total: seconds(take.raw.length), kept: seconds(take.trimmed.length) })}{" "}
            {take.reference ? st("recorder.pitch.ok", { n: take.reference.syllables?.length ?? 0 }) : st("recorder.pitch.none")}
          </p>
        </>
      )}

      {result && (
        <div className="flex flex-col gap-2" data-testid="recorder-result">
          <p className="font-semibold" role="status">{st("recorder.done")}</p>
          <ul className="flex flex-col gap-2">
            {result.files.map((f) => (
              <li key={f.path} className="flex flex-col gap-1">
                <span className="font-mono text-sm">{f.path} · {(f.durationMs / 1000).toLocaleString(studioLocale())} s</span>
                <PreviewAudio code={code} path={f.path} />
              </li>
            ))}
          </ul>
          {result.pitch && <p className="font-mono text-sm">{result.pitch.path}</p>}
        </div>
      )}
    </div>
  );
}
