import { createSouthLinter, type LexicalVariantEntry, type SouthLintFinding } from "@parlo/south-lint";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packFeatures, readPackFiles, rel } from "./load-pack.ts";

/**
 * Garde du Sud appliquée à un pack (à la racine de contenu courante, cf. setContentRoot).
 * Partagée par `scripts/south-lint-content.ts` (CI) et `validate-content.ts --with-south-lint` (studio).
 *
 * Seuls les champs contenant du vietnamien sont analysés. Sont ignorés volontairement :
 * `northernEquivalent`, lexical-variants.json, les textes localisés ({ fr, en }) et les étapes
 * `spot_the_south`. Couvre aussi exams/, games/ et placement.json.
 */

const VI_KEYS = new Set(["vi", "target", "tokens", "pair", "distractors", "accepted", "answer", "options", "text", "source"]);
const SKIP_KEYS = new Set(["northernEquivalent", "gloss", "title", "goal", "note", "explain", "body", "translation", "prompt", "label"]);

export interface SouthLintHit extends SouthLintFinding {
  file: string;
  path: string;
}

export type PackLintResult =
  | { status: "not_applicable" }
  | { status: "missing_variants" }
  | { status: "linted"; hits: SouthLintHit[] };

export function southLintPack(code: string): PackLintResult {
  const files = readPackFiles(code);
  if (!packFeatures(files).includes("lexical_variants")) return { status: "not_applicable" };
  if (!files.variants) return { status: "missing_variants" };
  const lint = createSouthLinter((files.variants.data as { entries: LexicalVariantEntry[] }).entries);

  const hits: SouthLintHit[] = [];
  const walk = (value: unknown, file: string, path: string, inVi: boolean): void => {
    if (typeof value === "string") {
      if (inVi) for (const f of lint(value)) hits.push({ ...f, file, path });
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, file, `${path}[${i}]`, inVi));
    } else if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (obj.type === "spot_the_south") return;
      // Texte localisé { fr, en… } : langue d'interface, pas du vietnamien. Un objet qui porte un champ `vi`
      // (exemple { vi, fr, en }) est du contenu, jamais un texte d'interface.
      if ("fr" in obj && !("vi" in obj) && Object.keys(obj).every((k) => /^[a-z]{2}(-[A-Z]{2})?$/.test(k))) return;
      for (const [k, v] of Object.entries(obj)) {
        if (SKIP_KEYS.has(k)) continue;
        walk(v, file, path ? `${path}.${k}` : k, inVi || VI_KEYS.has(k));
      }
    }
  };
  const extra = ["exams", "games", "dialogues", "placement.json"].flatMap((name) => {
    const path = join(files.root, name);
    if (!existsSync(path)) return [];
    const paths = name.endsWith(".json") ? [path] : readdirSync(path).filter((f) => f.endsWith(".json")).map((f) => join(path, f));
    return paths.map((p) => ({ path: p, data: JSON.parse(readFileSync(p, "utf8")) as unknown }));
  });
  const all = [...(files.pack ? [files.pack] : []), ...files.lessons, ...files.concepts, ...files.culture, ...extra];
  for (const f of all) walk(f.data, rel(f.path), "", false);
  return { status: "linted", hits };
}
