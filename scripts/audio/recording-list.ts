/**
 * Script d'enregistrement pour les voix natives : tout ce que le contenu d'un pack attend comme audio.
 *
 *   npx tsx scripts/audio/recording-list.ts [--pack vi-south] [--out scripts/audio/out/recording] [--in content/vi-south/audio/wav]
 *
 * Produit <out>/<pack>/recording-list.csv (UTF-8 avec BOM, pour Excel) et recording-list.html (imprimable,
 * une section par voix). La colonne « statut » indique si le wav est déjà présent dans --in.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Concept, CultureCard, Pack } from "../../packages/core/src/types.ts";
import { CONTENT_ROOT, readPackFiles } from "../lib/load-pack.ts";

export interface RecordingItem {
  kind: "concept" | "exemple" | "culture" | "accueil";
  id: string;
  /** Nom du wav à produire. */
  file: string;
  voice: string;
  vi: string;
  fr: string;
  /** true si le nom est proposé (le contenu ne référence pas encore d'audio). */
  suggested: boolean;
  recorded: boolean;
}

const wavName = (src: string) => basename(src).replace(/\.[a-z0-9]+$/i, ".wav");
const voiceOfFile = (file: string) => /_([a-z0-9]+)\.wav$/i.exec(file)?.[1] ?? "?";
/** mai_hcm_f → mai */
export const voiceToken = (voiceId: string) => voiceId.split("_")[0] ?? voiceId;

export function recordingItems(packCode: string, wavDir?: string): { pack: Pack; items: RecordingItem[] } {
  const files = readPackFiles(packCode);
  if (!files.pack) throw new Error(`pack.json introuvable pour ${packCode}`);
  const pack = files.pack.data as Pack;
  const tokens = pack.voices.map((v) => voiceToken(v.id));
  const present = new Set(wavDir && existsSync(wavDir) ? readdirSync(wavDir).map((n) => n.toLowerCase()) : []);
  const items: RecordingItem[] = [];
  const seen = new Set<string>();
  const push = (item: Omit<RecordingItem, "recorded" | "voice"> & { voice?: string }) => {
    if (seen.has(item.file)) return;
    seen.add(item.file);
    const fromFile = voiceOfFile(item.file);
    // Fichiers hors convention <id>_<voix> (cartes culture, exemples) : voix principale du pack.
    const voice = item.voice ?? (tokens.includes(fromFile) ? fromFile : (tokens[0] ?? fromFile));
    items.push({ ...item, voice, recorded: present.has(item.file.toLowerCase()) });
  };

  const concepts = files.concepts.map((f) => f.data as Concept).sort((a, b) => a.id.localeCompare(b.id));
  for (const c of concepts) {
    const natural = c.audio.filter((a) => a.source === "native" && a.speed === "natural");
    if (natural.length) for (const a of natural) push({ kind: "concept", id: c.id, file: wavName(a.src), vi: c.vi, fr: c.gloss.fr, suggested: false });
    else for (const t of tokens) push({ kind: "concept", id: c.id, file: `${c.id}_${t}.wav`, vi: c.vi, fr: c.gloss.fr, suggested: true });
    (c.examples ?? []).forEach((ex, i) => {
      if (ex.audio) push({ kind: "exemple", id: `${c.id}#${i + 1}`, file: wavName(ex.audio), vi: ex.vi, fr: ex.fr, suggested: false });
    });
  }

  const cards = files.culture.map((f) => f.data as CultureCard).sort((a, b) => a.id.localeCompare(b.id));
  for (const card of cards) {
    if (!card.vi) continue;
    if (card.audio) push({ kind: "culture", id: card.id, file: wavName(card.audio), vi: card.vi, fr: card.title.fr, suggested: false });
    else push({ kind: "culture", id: card.id, file: `${card.id}_${tokens[0] ?? "voix"}.wav`, vi: card.vi, fr: card.title.fr, suggested: true });
  }

  if (pack.welcome) {
    const file = pack.welcome.audio ? wavName(pack.welcome.audio) : `welcome_${tokens[0] ?? "voix"}.wav`;
    push({ kind: "accueil", id: "welcome", file, vi: pack.welcome.vi, fr: pack.welcome.translation.fr, suggested: !pack.welcome.audio });
  }
  return { pack, items };
}

const csvCell = (v: string) => (/[";\n,]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export function toCsv(items: readonly RecordingItem[]): string {
  const header = ["statut", "voix", "fichier", "vietnamien", "français", "type", "id", "nom proposé"];
  const rows = items.map((it) => [it.recorded ? "enregistré" : "à enregistrer", it.voice, it.file, it.vi, it.fr, it.kind, it.id, it.suggested ? "oui" : "non"]);
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function toHtml(pack: Pack, items: readonly RecordingItem[]): string {
  const voices = pack.voices.map((v) => ({ ...v, token: voiceToken(v.id) }));
  const known = new Set(voices.map((v) => v.token));
  const groups = [...voices.map((v) => ({ title: `${v.label} — ${v.accent} (${v.token})`, items: items.filter((i) => i.voice === v.token) })), { title: "Autres voix", items: items.filter((i) => !known.has(i.voice)) }].filter((g) => g.items.length);

  const card = (it: RecordingItem, n: number) => `
    <li class="item${it.recorded ? " done" : ""}">
      <span class="n">${n}</span>
      <div class="body">
        <p class="vi" lang="vi">${esc(it.vi)}</p>
        <p class="fr">${esc(it.fr)}</p>
        <p class="meta"><code>${esc(it.file)}</code> · ${esc(it.kind)} · ${esc(it.id)}${it.suggested ? " · nom proposé" : ""}</p>
      </div>
      <span class="box" aria-label="${it.recorded ? "enregistré" : "à enregistrer"}">${it.recorded ? "✓" : ""}</span>
    </li>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Script d'enregistrement — ${esc(pack.name.fr)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 52rem; padding: 1.5rem 1rem; color: #1c1917; background: #fff; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; border-bottom: 2px solid #1c1917; padding-bottom: .25rem; break-after: avoid; }
  .rules { background: #f5f5f4; border-radius: .5rem; padding: .75rem 1rem; font-size: .95rem; }
  .rules li { margin: .2rem 0; }
  ol { list-style: none; padding: 0; margin: 0; }
  .item { display: grid; grid-template-columns: 2.5rem 1fr 2.2rem; gap: .75rem; align-items: center; padding: .9rem 0; border-bottom: 1px solid #d6d3d1; break-inside: avoid; }
  .n { font-variant-numeric: tabular-nums; color: #78716c; text-align: right; }
  .vi { font-family: "Noto Serif", Georgia, "Times New Roman", serif; font-size: 2.4rem; line-height: 1.2; margin: 0; }
  .fr { margin: .15rem 0 0; font-size: 1.05rem; color: #44403c; }
  .meta { margin: .2rem 0 0; font-size: .8rem; color: #78716c; }
  code { font-size: .85rem; }
  .box { width: 1.8rem; height: 1.8rem; border: 2px solid #1c1917; border-radius: .3rem; display: grid; place-items: center; font-weight: bold; }
  .done .vi { color: #78716c; }
  @media print { body { padding: 0; } .rules { background: none; border: 1px solid #a8a29e; } h2 { break-before: page; } h2:first-of-type { break-before: auto; } }
</style>
</head>
<body>
<h1>Script d'enregistrement — ${esc(pack.name.fr)}</h1>
<p>${items.length} fichier(s), dont ${items.filter((i) => !i.recorded).length} à enregistrer.</p>
<ul class="rules">
  <li>WAV 48 kHz, 24 bits, mono. Une prise par fichier, nommée exactement comme indiqué.</li>
  <li>Environ 0,5 s de silence avant et après. Micro à 15–20 cm, pièce calme et meublée.</li>
  <li>Voix naturelle, débit normal, accent du Sud. Ne pas ralentir : la version lente est fabriquée automatiquement.</li>
</ul>
${groups.map((g) => `<h2>${esc(g.title)}</h2>\n<ol>${g.items.map((it, i) => card(it, i + 1)).join("")}\n</ol>`).join("\n")}
</body>
</html>
`;
}

function main(): void {
  const { values } = parseArgs({ options: { pack: { type: "string", default: "vi-south" }, out: { type: "string" }, in: { type: "string" } } });
  const code = values.pack ?? "vi-south";
  const outDir = resolve(values.out ?? join(import.meta.dirname, "out", "recording"), code);
  const wavDir = resolve(values.in ?? join(CONTENT_ROOT, code, "audio", "wav"));
  const { pack, items } = recordingItems(code, wavDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "recording-list.csv"), toCsv(items));
  writeFileSync(join(outDir, "recording-list.html"), toHtml(pack, items));
  const todo = items.filter((i) => !i.recorded).length;
  console.log(`${items.length} fichier(s) attendus (${todo} à enregistrer) → ${outDir}`);
  const byVoice = new Map<string, number>();
  for (const it of items) byVoice.set(it.voice, (byVoice.get(it.voice) ?? 0) + 1);
  for (const [v, n] of byVoice) console.log(`  ${v} : ${n}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
