/**
 * Validation du contenu (CI, bloquant) :
 *   1. schémas JSON (content/schema)
 *   2. contrôles sémantiques (@parlo/core checkContent)
 *   3. présence des médias référencés (avertissement tant que l'audio de travail n'existe pas)
 *
 * Usage : npm run content:validate [-- --production] [-- --strict-media]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { buildContentIndex, checkContent, type ContentIssue } from "@parlo/core";
import { CONTENT_ROOT, listPacks, readPackFiles, rel, toRaw, type JsonFile } from "./lib/load-pack.ts";

const production = process.argv.includes("--production");
const strictMedia = process.argv.includes("--strict-media") || production;

// strictRequired désactivé : les textes localisés exigent "fr" via additionalProperties.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, discriminator: true });
const SCHEMA_BASE = "https://parlo.app/schema/";
const schemaDir = join(CONTENT_ROOT, "schema");
for (const name of readdirSync(schemaDir)) {
  ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, name), "utf8")) as object);
}

const issues: ContentIssue[] = [];
const report = (level: ContentIssue["level"], where: string, message: string) => issues.push({ level, where, message });

function validate(schema: string, file: JsonFile | null, label: string) {
  if (!file) {
    report("error", label, "fichier manquant");
    return;
  }
  const fn = ajv.getSchema(SCHEMA_BASE + schema);
  if (!fn) throw new Error(`Schéma introuvable : ${schema}`);
  if (!fn(file.data)) {
    for (const e of fn.errors ?? []) report("error", rel(file.path), `${e.instancePath || "/"} ${e.message ?? ""}`);
  }
}

const MEDIA_KEYS = new Set(["src", "audio", "image", "pitch", "pitchRef"]);
function collectMedia(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) value.forEach((v) => collectMedia(v, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (MEDIA_KEYS.has(k) && typeof v === "string") out.add(v);
      else collectMedia(v, out);
    }
  }
}

for (const code of listPacks()) {
  const files = readPackFiles(code);
  validate("pack.schema.json", files.pack, `${code}/pack.json`);
  validate("curriculum.schema.json", files.curriculum, `${code}/curriculum.json`);
  if (files.variants) validate("lexical-variants.schema.json", files.variants, `${code}/lexical-variants.json`);
  files.lessons.forEach((f) => validate("lesson.schema.json", f, rel(f.path)));
  files.concepts.forEach((f) => validate("concept.schema.json", f, rel(f.path)));
  files.culture.forEach((f) => validate("culture.schema.json", f, rel(f.path)));

  // Les contrôles sémantiques supposent des fichiers conformes aux schémas.
  if (issues.some((i) => i.level === "error")) continue;

  const index = buildContentIndex(toRaw(files));
  issues.push(...checkContent(index, { production }));

  const media = new Set<string>();
  [...(files.pack ? [files.pack] : []), ...files.lessons, ...files.concepts, ...files.culture].forEach((f) => collectMedia(f.data, media));
  const missing = [...media].filter((m) => !existsSync(join(files.root, m)));
  if (missing.length > 0) {
    report(strictMedia ? "error" : "warning", code, `${missing.length} média(s) référencé(s) absent(s), ex. ${missing.slice(0, 3).join(", ")}`);
  }
}

const errors = issues.filter((i) => i.level === "error");
const warnings = issues.filter((i) => i.level === "warning");
const unreviewed = warnings.filter((w) => w.message.includes("non relue"));
for (const w of warnings.filter((w) => !unreviewed.includes(w))) console.warn(`⚠  ${w.where} — ${w.message}`);
if (unreviewed.length > 0) console.warn(`⚠  ${unreviewed.length} leçon(s) non relue(s) par un locuteur natif (reviewed: false)`);
for (const e of errors) console.error(`✖  ${e.where} — ${e.message}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} erreur(s) de contenu.`);
  process.exit(1);
}
console.log(`✔  Contenu valide (${warnings.length} avertissement(s)).`);
