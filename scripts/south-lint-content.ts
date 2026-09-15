/**
 * Garde du Sud sur tout le corpus (CI, bloquant sur les erreurs).
 *
 * Seuls les champs contenant du vietnamien sont analysés. Sont ignorés
 * volontairement : `northernEquivalent`, le fichier lexical-variants.json,
 * les textes localisés ({ fr, en }, langue d'interface) et les étapes
 * `spot_the_south` (qui montrent la forme du Nord à dessein).
 * Couvre aussi exams/, games/ et placement.json.
 */
import { createSouthLinter, hasBlocking, type LexicalVariantEntry, type SouthLintFinding } from "@parlo/south-lint";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listPacks, packFeatures, readPackFiles, rel } from "./lib/load-pack.ts";

const VI_KEYS = new Set(["vi", "target", "tokens", "pair", "distractors", "accepted", "answer", "options", "text", "source"]);
const SKIP_KEYS = new Set(["northernEquivalent", "gloss", "title", "goal", "note", "explain", "body", "translation", "prompt", "label"]);

interface Hit extends SouthLintFinding {
  file: string;
  path: string;
}

let blocking = false;
let total = 0;

for (const code of listPacks()) {
  const files = readPackFiles(code);
  // Module optionnel (ADR 0006) : seuls les packs à variantes régionales sont analysés.
  if (!packFeatures(files).includes("lexical_variants")) {
    console.log(`·  ${code} : pas de feature lexical_variants, garde régionale non applicable.`);
    continue;
  }
  if (!files.variants) {
    console.error(`✖  ${code} : feature lexical_variants déclarée mais lexical-variants.json absent ou illisible.`);
    blocking = true;
    continue;
  }
  const lint = createSouthLinter((files.variants.data as { entries: LexicalVariantEntry[] }).entries);

  const hits: Hit[] = [];
  const walk = (value: unknown, file: string, path: string, inVi: boolean): void => {
    if (typeof value === "string") {
      if (inVi) for (const f of lint(value)) hits.push({ ...f, file, path });
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, file, `${path}[${i}]`, inVi));
    } else if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (obj.type === "spot_the_south") return;
      // Texte localisé { fr, en… } : langue d'interface, pas du vietnamien.
      if ("fr" in obj && Object.keys(obj).every((k) => /^[a-z]{2}(-[A-Z]{2})?$/.test(k))) return;
      for (const [k, v] of Object.entries(obj)) {
        if (SKIP_KEYS.has(k)) continue;
        walk(v, file, path ? `${path}.${k}` : k, inVi || VI_KEYS.has(k));
      }
    }
  };
  // Examens et données de mini-jeux : mêmes règles (instructions de Xe ôm, items d'examen…).
  const extra = ["exams", "games", "placement.json"].flatMap((name) => {
    const path = join(files.root, name);
    if (!existsSync(path)) return [];
    const paths = name.endsWith(".json") ? [path] : readdirSync(path).filter((f) => f.endsWith(".json")).map((f) => join(path, f));
    return paths.map((p) => ({ path: p, data: JSON.parse(readFileSync(p, "utf8")) as unknown }));
  });
  const all = [...(files.pack ? [files.pack] : []), ...files.lessons, ...files.concepts, ...files.culture, ...extra];
  for (const f of all) walk(f.data, rel(f.path), "", false);

  for (const h of hits) {
    const icon = h.severity === "error" ? "✖" : "⚠";
    console[h.severity === "error" ? "error" : "warn"](`${icon}  ${h.file} ${h.path} — « ${h.found} » (Nord) → ${h.suggestions.join(" / ")}`);
  }
  blocking ||= hasBlocking(hits);
  total += hits.length;
}

if (blocking) {
  console.error("\nFormes du Nord détectées dans le corpus du Sud.");
  process.exit(1);
}
console.log(`✔  south-lint : aucune forme du Nord bloquante (${total} signalement(s)).`);
