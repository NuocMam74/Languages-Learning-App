/**
 * Génère des wav synthétiques (ffmpeg aevalsrc, 48 kHz 24 bits) pour tester le pipeline de bout en bout,
 * sans jamais écrire dans content/.
 *
 *   npx tsx scripts/audio/synth-fixtures.ts [--out <dossier>]   # génère seulement
 *   npx tsx scripts/audio/synth-fixtures.ts --e2e               # génère dans un dossier temporaire,
 *                                                               # lance process.ts puis vérifie les sorties
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { analyzePitch, median, parsePitchReference } from "../../packages/core/src/pitch/index.ts";
import { decodePcm, ffmpeg, probe } from "./ffmpeg.ts";
import { SLOW_TEMPO, formatReport, processAudio } from "./process.ts";

export interface Fixture {
  file: string;
  /** Expression aevalsrc (t en secondes). */
  expr: string;
  duration: number;
  /** F0 attendue (médiane) si pertinente. */
  f0?: number;
}

/** Signal voisé à harmoniques décroissantes, de t0 à t1, de phase `phase` (expression en t). */
const voiced = (phase: string, t0: number, t1: number, harmonics = 5) => {
  const sum = Array.from({ length: harmonics }, (_, k) => `sin(${k + 1}*${phase})/${k + 1}`).join("+");
  // Enveloppe : rampes de 20 ms.
  const env = `min(1,min((t-${t0})/0.02,(${t1}-t)/0.02))`;
  return `if(between(t,${t0},${t1}),0.25*${env}*(${sum}),0)`;
};

export const FIXTURES: Fixture[] = [
  // Sinus pur 200 Hz, 0,5 s de silence de part et d'autre.
  { file: "fx_sine200_mai.wav", expr: `if(between(t,0.5,1.5),0.3*sin(2*PI*200*t),0)`, duration: 2, f0: 200 },
  // Glissando montant 120 → 180 Hz (voix grave), phase = 2π(f0·τ + (f1−f0)·τ²/2T).
  { file: "fx_glide_tuan.wav", expr: voiced(`2*PI*(120*(t-0.5)+60*(t-0.5)*(t-0.5)/2)`, 0.5, 1.5), duration: 2 },
  // Descente 250 → 170 Hz (type huyền).
  { file: "fx_fall_mai.wav", expr: voiced(`2*PI*(250*(t-0.5)-80*(t-0.5)*(t-0.5)/(2*0.6))`, 0.5, 1.1), duration: 1.6 },
  // Deux syllabes séparées de 150 ms : plate 200 Hz puis descendante 200 → 150 Hz (segmentation en syllabes).
  {
    file: "fx_two_mai.wav",
    expr: `${voiced(`2*PI*200*t`, 0.5, 0.8)}+${voiced(`2*PI*(200*(t-0.95)-50*(t-0.95)*(t-0.95)/(2*0.35))`, 0.95, 1.3)}`,
    duration: 1.8,
  },
];

export function generateFixtures(outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  return FIXTURES.map((fx) => {
    const path = join(outDir, fx.file);
    ffmpeg(["-y", "-f", "lavfi", "-i", `aevalsrc='${fx.expr}':s=48000:d=${fx.duration}`, "-ac", "1", "-c:a", "pcm_s24le", path]);
    return path;
  });
}

function e2e(): void {
  const root = mkdtempSync(join(tmpdir(), "parlo-audio-e2e-"));
  const inDir = join(root, "wav");
  const outDir = join(root, "out");
  const failures: string[] = [];
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? "✔" : "✖"} ${msg}`);
    if (!ok) failures.push(msg);
  };
  try {
    generateFixtures(inDir);
    const rows = processAudio({ pack: null, inDir, outDir, pitchAll: true });
    console.log(formatReport(rows));

    for (const fx of FIXTURES) {
      const base = fx.file.replace(/\.wav$/, "");
      const id = base.replace(/_[a-z0-9]+$/, "");
      const files = [`${base}.opus`, `${base}.m4a`, `${base}_slow.opus`, `${base}_slow.m4a`].map((f) => join(outDir, "audio", f));
      check(files.every(existsSync), `${base} : 4 fichiers audio`);
      const nat = probe(files[0]!);
      const slow = probe(files[2]!);
      const m4a = probe(files[1]!);
      check(nat.codec === "opus" && nat.channels === 1 && nat.sampleRate === 48_000, `${base}.opus : opus mono 48 kHz`);
      check(m4a.codec === "aac" && m4a.channels === 1, `${base}.m4a : aac mono`);
      const ratio = slow.duration / nat.duration;
      check(Math.abs(ratio - 1 / SLOW_TEMPO) < 0.06, `${base} : lent/naturel = ${ratio.toFixed(3)} (≈ ${(1 / SLOW_TEMPO).toFixed(3)}), ${nat.duration.toFixed(3)} s → ${slow.duration.toFixed(3)} s`);
      check(nat.duration < fx.duration - 0.5, `${base} : silences rognés (${fx.duration} s → ${nat.duration.toFixed(3)} s)`);

      const pitchFile = join(outDir, "pitch", `${id}.json`);
      let parsed = false;
      try {
        const ref = parsePitchReference(readFileSync(pitchFile, "utf8"));
        parsed = ref.st.length > 10;
      } catch (err) {
        console.log(String(err));
      }
      check(parsed, `pitch/${id}.json parse (format strict)`);

      if (fx.f0) {
        const row = rows.find((r) => r.file === fx.file);
        check(Math.abs((row?.medianHz ?? 0) - fx.f0) < 2, `${base} : F0 médiane du wav = ${row?.medianHz?.toFixed(2)} Hz (attendu ${fx.f0})`);
        for (const [label, file] of [["opus naturel", files[0]!], ["opus lent", files[2]!], ["m4a lent", files[3]!]] as const) {
          const f0s = analyzePitch(decodePcm(file, 16_000), 16_000).flatMap((f) => (f.f0 !== null && f.confidence > 0.8 ? [f.f0] : []));
          const med = median(f0s);
          check(Math.abs(med - fx.f0) < 2, `${base} ${label} : F0 médiane ${med.toFixed(2)} Hz (hauteur préservée)`);
        }
      }
    }

    // Idempotence : un second passage ne refait rien.
    const again = processAudio({ pack: null, inDir, outDir, pitchAll: true, log: () => {} });
    check(again.every((r) => r.audio === "up-to-date" && r.pitch === "up-to-date"), "second passage : tout est à jour (idempotent)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`\n${failures.length} vérification(s) en échec`);
    process.exitCode = 1;
  } else console.log("\nE2E audio OK");
}

function main(): void {
  const { values } = parseArgs({ options: { out: { type: "string" }, e2e: { type: "boolean", default: false } } });
  if (values.e2e) return e2e();
  const out = resolve(values.out ?? join(import.meta.dirname, "out", "fixtures"));
  for (const p of generateFixtures(out)) console.log(p);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
