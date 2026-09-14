import { spawnSync } from "node:child_process";

/** Petits utilitaires autour de ffmpeg / ffprobe (doivent être dans le PATH). */

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export function run(bin: "ffmpeg" | "ffprobe", args: readonly string[]): RunResult {
  const res = spawnSync(bin, args, { maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (res.error) throw new Error(`${bin} introuvable ou non exécutable : ${res.error.message}`);
  const stderr = res.stderr?.toString("utf8") ?? "";
  if (res.status !== 0) throw new Error(`${bin} ${args.join(" ")}\n→ code ${res.status}\n${stderr.split("\n").slice(-15).join("\n")}`);
  return { stdout: res.stdout ?? Buffer.alloc(0), stderr };
}

export function ffmpeg(args: readonly string[]): RunResult {
  return run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "info", ...args]);
}

let filterCache: string | null = null;

export function hasFilter(name: string): boolean {
  filterCache ??= run("ffmpeg", ["-hide_banner", "-filters"]).stdout.toString("utf8");
  return new RegExp(`^\\s*[A-Z.|]+\\s+${name}\\s`, "m").test(filterCache);
}

export function hasEncoder(name: string): boolean {
  const out = run("ffmpeg", ["-hide_banner", "-encoders"]).stdout.toString("utf8");
  return new RegExp(`^\\s*[A-Z.]+\\s+${name}\\s`, "m").test(out);
}

export interface ProbeInfo {
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
}

export function probe(file: string): ProbeInfo {
  const out = run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", file]);
  const json = JSON.parse(out.stdout.toString("utf8")) as {
    streams?: { codec_name?: string; sample_rate?: string; channels?: number }[];
    format?: { duration?: string };
  };
  const s = json.streams?.[0];
  return {
    duration: Number(json.format?.duration ?? Number.NaN),
    sampleRate: Number(s?.sample_rate ?? Number.NaN),
    channels: s?.channels ?? 0,
    codec: s?.codec_name ?? "?",
  };
}

export interface LoudnormMeasure {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

export const LOUDNESS = { I: -16, TP: -1.5, LRA: 11 } as const;

/** Passe 1 de loudnorm : mesure sur le flux déjà filtré par `prefilter`. */
export function measureLoudness(input: string, prefilter: string): LoudnormMeasure {
  const af = `${prefilter ? `${prefilter},` : ""}loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json`;
  const { stderr } = ffmpeg(["-i", input, "-af", af, "-f", "null", "-"]);
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`loudnorm : mesure illisible pour ${input}`);
  return JSON.parse(stderr.slice(start, end + 1)) as LoudnormMeasure;
}

/** Filtre loudnorm de passe 2 (linéaire) à partir de la mesure. */
export function loudnormFilter(m: LoudnormMeasure): string {
  return [
    `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`,
    `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}`,
    `measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`,
  ].join(":");
}

/** Décode n'importe quel fichier audio en PCM float 32 bits mono à `sampleRate`. */
export function decodePcm(file: string, sampleRate = 16_000): Float32Array {
  const { stdout } = run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"]);
  const copy = new Uint8Array(stdout.byteLength - (stdout.byteLength % 4));
  copy.set(stdout.subarray(0, copy.byteLength));
  return new Float32Array(copy.buffer);
}
