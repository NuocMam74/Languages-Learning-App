/**
 * Pipeline audio (SPEC §7.4) : wav 48 kHz → rognage des silences → loudnorm 2 passes (−16 LUFS, TP −1,5)
 * → audio/<id>_<voix>.opus (libopus 48 kbps mono) + .m4a (AAC, repli Safari)
 * → variante lente <id>_<voix>_slow.{opus,m4a} par time-stretch SANS changement de hauteur
 *   (filtre rubberband si ffmpeg l'a, sinon atempo — jamais asetrate ni playbackRate)
 * → pitch/<id>.json : courbe de référence du karaoké tonal (module @parlo/core pitch).
 *
 *   npx tsx scripts/audio/process.ts [--pack vi-south] [--in content/vi-south/audio/wav] [--out content/vi-south]
 *                                    [--dry-run] [--force] [--pitch-all] [--no-pitch]
 *
 * Entrées : fichiers `<id>_<voix>.wav` (voix = jeton sans « _ », ex. mai, tuan).
 * Idempotent : une sortie plus récente que son wav n'est pas refaite (sauf --force).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { extractContour, serializePitchReference, toPitchReference } from "../../packages/core/src/pitch/index.ts";
import { syllables, toneOf } from "../../packages/core/src/text.ts";
import type { Concept, Lesson, Pack, Tone } from "../../packages/core/src/types.ts";
import { CONTENT_ROOT, readPackFiles } from "../lib/load-pack.ts";
import { decodePcm, ffmpeg, hasFilter, loudnormFilter, measureLoudness, probe } from "./ffmpeg.ts";

export const SLOW_TEMPO = 0.75;
export const OPUS_BITRATE = "48k";
export const AAC_BITRATE = "64k";
/** Rognage des bords : on garde ~150 ms de silence avant/après la parole. */
const TRIM =
  "aformat=channel_layouts=mono," +
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15:detection=peak," +
  "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15:detection=peak,areverse";

export function stretchFilter(): { filter: string; method: "rubberband" | "atempo" } {
  return hasFilter("rubberband")
    ? { filter: `rubberband=tempo=${SLOW_TEMPO}:pitch=1:pitchq=quality`, method: "rubberband" }
    : { filter: `atempo=${SLOW_TEMPO}`, method: "atempo" };
}

export interface ProcessOptions {
  pack?: string | null;
  inDir: string;
  outDir: string;
  dryRun?: boolean;
  force?: boolean;
  pitchAll?: boolean;
  pitch?: boolean;
  log?: (line: string) => void;
}

export interface PitchTarget {
  id: string;
  /** Chemin relatif à outDir, ex. pitch/s_chao_anh.json */
  path: string;
  tones?: Tone[];
  preferredVoice?: string;
}

export interface ReportRow {
  file: string;
  id: string;
  voice: string;
  inputRate: number;
  audio: "processed" | "up-to-date" | "dry-run" | "error";
  lufsIn?: number;
  natural?: number;
  slow?: number;
  pitch: "written" | "up-to-date" | "dry-run" | "-" | "error";
  medianHz?: number | null;
  voiced?: number;
  syllables?: number;
  error?: string;
}

/** Concepts qui ont besoin d'une courbe : champ `pitch`, speak_repeat, tone_produce, tone_identify, tone_minimal_pair. */
export function pitchTargets(packCode: string): Map<string, PitchTarget> {
  const files = readPackFiles(packCode);
  const concepts = new Map(files.concepts.map((f) => [(f.data as Concept).id, f.data as Concept]));
  const targets = new Map<string, PitchTarget>();
  const add = (id: string, path?: string) => {
    const c = concepts.get(id);
    const existing = targets.get(id);
    const target: PitchTarget = { id, path: path ?? existing?.path ?? c?.pitch ?? `pitch/${id}.json` };
    if (c) {
      target.tones = syllables(c.vi).map(toneOf);
      const natural = c.audio.find((a) => a.speed === "natural" && a.source === "native");
      const voice = natural ? /_([a-z0-9]+)\.[a-z0-9]+$/i.exec(natural.src)?.[1] : undefined;
      if (voice) target.preferredVoice = voice;
    }
    targets.set(id, target);
  };
  for (const c of concepts.values()) if (c.pitch) add(c.id, c.pitch);
  for (const f of files.lessons) {
    for (const step of (f.data as Lesson).steps) {
      if (step.type === "speak_repeat") add(step.concept, step.pitchRef);
      else if (step.type === "tone_produce" || step.type === "tone_identify") add(step.concept);
      else if (step.type === "tone_minimal_pair") for (const id of step.audioConcepts ?? []) add(id);
    }
  }
  return targets;
}

/** Enregistrements attendus par le contenu (audio natif, vitesse naturelle) : noms de wav. */
export function expectedRecordings(packCode: string): string[] {
  const files = readPackFiles(packCode);
  const names = new Set<string>();
  for (const f of files.concepts) {
    for (const a of (f.data as Concept).audio) if (a.source === "native" && a.speed === "natural") names.add(basename(a.src).replace(/\.[a-z0-9]+$/i, ".wav"));
  }
  return [...names].sort();
}

const newerThan = (out: string, input: string) => existsSync(out) && statSync(out).mtimeMs >= statSync(input).mtimeMs;

function encode(input: string, output: string, filter: string | null, codec: "opus" | "aac"): void {
  mkdirSync(dirname(output), { recursive: true });
  const codecArgs =
    codec === "opus"
      ? ["-c:a", "libopus", "-b:a", OPUS_BITRATE, "-vbr", "on", "-application", "audio", "-ar", "48000"]
      : ["-c:a", "aac", "-b:a", AAC_BITRATE, "-ar", "48000", "-movflags", "+faststart"];
  ffmpeg(["-y", "-i", input, ...(filter ? ["-af", filter] : []), "-ac", "1", "-map_metadata", "-1", ...codecArgs, output]);
}

export function processAudio(options: ProcessOptions): ReportRow[] {
  const log = options.log ?? ((l: string) => console.log(l));
  const inDir = resolve(options.inDir);
  const outDir = resolve(options.outDir);
  if (!existsSync(inDir)) throw new Error(`dossier d'entrée introuvable : ${inDir}`);
  const wavs = readdirSync(inDir).filter((n) => /\.wav$/i.test(n)).sort();
  const targets = options.pack ? pitchTargets(options.pack) : new Map<string, PitchTarget>();
  const withPitch = options.pitch !== false;
  const knownVoices = options.pack ? new Set(((readPackFiles(options.pack).pack?.data as Pack | undefined)?.voices ?? []).map((v) => v.id.split("_")[0]!.toLowerCase())) : null;
  const stretch = stretchFilter();
  log(`ffmpeg time-stretch : ${stretch.method} (${stretch.filter})`);

  const parsed = wavs.flatMap((file) => {
    const m = /^(.+)_([a-z0-9]+)\.wav$/i.exec(file);
    if (!m) {
      log(`⚠ nom ignoré (attendu <id>_<voix>.wav) : ${file}`);
      return [];
    }
    if (knownVoices && !knownVoices.has(m[2]!.toLowerCase())) log(`⚠ ${file} : voix « ${m[2]} » absente de pack.json (voix connues : ${[...knownVoices].join(", ")})`);
    return [{ file, id: m[1]!, voice: m[2]!, path: join(inDir, file) }];
  });

  // Une seule voix sert de référence de hauteur par concept (la courbe est normalisée par locuteur).
  const pitchSource = new Map<string, string>();
  for (const p of parsed) {
    const target = targets.get(p.id);
    if (!target && !options.pitchAll) continue;
    const current = pitchSource.get(p.id);
    if (!current || (target?.preferredVoice === p.voice && !current.endsWith(`_${p.voice}.wav`))) pitchSource.set(p.id, p.file);
  }

  const tmp = mkdtempSync(join(tmpdir(), "parlo-audio-"));
  const rows: ReportRow[] = [];
  try {
    for (const p of parsed) {
      const base = `${p.id}_${p.voice}`;
      const outputs = {
        opus: join(outDir, "audio", `${base}.opus`),
        m4a: join(outDir, "audio", `${base}.m4a`),
        slowOpus: join(outDir, "audio", `${base}_slow.opus`),
        slowM4a: join(outDir, "audio", `${base}_slow.m4a`),
      };
      const row: ReportRow = { file: p.file, id: p.id, voice: p.voice, inputRate: 0, audio: "up-to-date", pitch: "-" };
      rows.push(row);
      try {
        row.inputRate = probe(p.path).sampleRate;
        if (row.inputRate !== 48_000) log(`⚠ ${p.file} : ${row.inputRate} Hz (48 kHz attendu)`);

        const stale = options.force || !Object.values(outputs).every((o) => newerThan(o, p.path));
        if (stale && options.dryRun) row.audio = "dry-run";
        else if (stale) {
          const measure = measureLoudness(p.path, TRIM);
          row.lufsIn = Number(measure.input_i);
          const norm = join(tmp, `${base}.norm.wav`);
          ffmpeg(["-y", "-i", p.path, "-af", `${TRIM},${loudnormFilter(measure)},aresample=48000`, "-ac", "1", "-c:a", "pcm_f32le", norm]);
          encode(norm, outputs.opus, null, "opus");
          encode(norm, outputs.m4a, null, "aac");
          const slow = join(tmp, `${base}.slow.wav`);
          ffmpeg(["-y", "-i", norm, "-af", stretch.filter, "-ac", "1", "-c:a", "pcm_f32le", slow]);
          encode(slow, outputs.slowOpus, null, "opus");
          encode(slow, outputs.slowM4a, null, "aac");
          row.audio = "processed";
        }
        if (existsSync(outputs.opus)) row.natural = probe(outputs.opus).duration;
        if (existsSync(outputs.slowOpus)) row.slow = probe(outputs.slowOpus).duration;

        if (withPitch && pitchSource.get(p.id) === p.file) {
          const target = targets.get(p.id);
          const pitchPath = join(outDir, target?.path ?? `pitch/${p.id}.json`);
          if (!options.force && newerThan(pitchPath, p.path)) row.pitch = "up-to-date";
          else if (options.dryRun) row.pitch = "dry-run";
          else {
            const contour = extractContour(decodePcm(p.path, 16_000), 16_000);
            const ref = toPitchReference(contour, target?.tones);
            mkdirSync(dirname(pitchPath), { recursive: true });
            writeFileSync(pitchPath, serializePitchReference(ref) + "\n");
            row.pitch = "written";
            row.medianHz = contour.medianHz;
            row.voiced = contour.voicedRatio;
            row.syllables = ref.syllables?.length ?? 0;
            if (target?.tones && !ref.syllables) log(`⚠ ${p.id} : ${target.tones.length} syllabe(s) attendue(s), segmentation par îlots voisés impossible (courbe sans syllabes)`);
          }
        }
      } catch (err) {
        row.error = err instanceof Error ? (err.message.split("\n")[0] ?? "") : String(err);
        if (row.audio !== "processed") row.audio = "error";
        if (row.pitch === "-") row.pitch = "error";
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (options.pack) {
    const have = new Set(wavs.map((w) => w.toLowerCase()));
    const missing = expectedRecordings(options.pack).filter((n) => !have.has(n.toLowerCase()));
    if (missing.length) log(`ℹ ${missing.length} enregistrement(s) attendu(s) par le contenu absent(s) de ${inDir} (npm run audio:list pour la liste)`);
    const noSource = [...targets.keys()].filter((id) => !pitchSource.has(id));
    if (withPitch && noSource.length) log(`ℹ courbes sans wav source : ${noSource.join(", ")}`);
  }
  return rows;
}

export function formatReport(rows: readonly ReportRow[]): string {
  const f = (n: number | undefined | null, d = 2) => (n == null || !Number.isFinite(n) ? "-" : n.toFixed(d));
  const header = ["fichier", "Hz in", "audio", "LUFS in", "naturel s", "lent s", "ratio", "pitch", "F0 méd.", "voisé", "syll."];
  const lines = rows.map((r) => [
    r.file,
    String(r.inputRate || "-"),
    r.audio,
    f(r.lufsIn, 1),
    f(r.natural),
    f(r.slow),
    r.natural && r.slow ? f(r.slow / r.natural) : "-",
    r.pitch,
    f(r.medianHz ?? undefined, 1),
    r.voiced === undefined ? "-" : `${Math.round(r.voiced * 100)}%`,
    r.syllables === undefined ? "-" : String(r.syllables),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const errors = rows.filter((r) => r.error).map((r) => `✖ ${r.file} : ${r.error}`);
  return [fmt(header), widths.map((w) => "-".repeat(w)).join("  "), ...lines.map(fmt), ...errors].join("\n");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      pack: { type: "string", default: "vi-south" },
      in: { type: "string" },
      out: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "pitch-all": { type: "boolean", default: false },
      "no-pitch": { type: "boolean", default: false },
    },
  });
  const pack = values.pack === "none" ? null : (values.pack ?? "vi-south");
  const packRoot = pack ? join(CONTENT_ROOT, pack) : null;
  const inDir = values.in ?? (packRoot ? join(packRoot, "audio", "wav") : null);
  const outDir = values.out ?? packRoot;
  if (!inDir || !outDir) throw new Error("--in et --out sont requis avec --pack none");
  if (!existsSync(inDir)) {
    console.error(`Dossier de wav introuvable : ${inDir}\nDéposez les enregistrements <id>_<voix>.wav dans ce dossier ou passez --in <dossier>.`);
    process.exitCode = 1;
    return;
  }
  const rows = processAudio({ pack, inDir, outDir, dryRun: values["dry-run"], force: values.force, pitchAll: values["pitch-all"], pitch: !values["no-pitch"] });
  console.log(formatReport(rows));
  if (rows.some((r) => r.error)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
