/**
 * Validation du contenu (CI, bloquant) :
 *   1. schémas JSON (content/schema)
 *   2. contrôles sémantiques (@parlo/core checkContent)
 *   3. présence des médias référencés (avertissement tant que l'audio de travail n'existe pas)
 *
 * Usage : npm run content:validate [-- --production] [-- --strict-media] [-- --root <dir>] [-- --json]
 *   --root <dir> : racine du contenu à valider (défaut : content/ du dépôt) — copie superposée du studio (contrat phase4 §1)
 *   --with-south-lint : ajoute la garde du Sud (erreurs bloquantes et avertissements) — utilisé par le studio
 *   --json       : sortie machine sur stdout `{"errors":[{where,message}],"warnings":[{where,message}]}` ;
 *                  code de sortie inchangé (1 s'il y a des erreurs)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { buildContentIndex, checkContent, checkExam, checkPlacement, type ContentIssue, type ExamFile, type PlacementSpec } from "@parlo/core";
import { checkXeOmData, type XeOmData } from "@parlo/core";
import { createSouthLinter, hasBlocking, type LexicalVariantEntry } from "@parlo/south-lint";
import { southLintPack } from "./lib/south-lint-pack.ts";
import { CONTENT_ROOT, listPacks, packFeatures, readPackFiles, rel, setContentRoot, toRaw, type JsonFile } from "./lib/load-pack.ts";

const production = process.argv.includes("--production");
const strictMedia = process.argv.includes("--strict-media") || production;
const jsonOutput = process.argv.includes("--json");
const withSouthLint = process.argv.includes("--with-south-lint");
const rootArg = (() => {
  const i = process.argv.indexOf("--root");
  if (i >= 0) {
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error("--root exige un dossier");
    return value;
  }
  return process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length);
})();
if (rootArg) {
  if (!existsSync(rootArg)) throw new Error(`--root : dossier introuvable : ${rootArg}`);
  setContentRoot(rootArg);
}

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

const errorCount = () => issues.filter((i) => i.level === "error").length;

/**
 * Plusieurs packs (ADR 0006) : l'état SRS local et serveur est indexé par identifiant de
 * concept, sans code de pack. Un même id dans deux packs serait donc une collision.
 */
const conceptOwners = new Map<string, string>();

for (const code of listPacks()) {
  const files = readPackFiles(code);
  const errorsBefore = errorCount();
  for (const f of files.concepts) {
    const id = (f.data as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const owner = conceptOwners.get(id);
    if (owner && owner !== code) report("error", rel(f.path), `Concept ${id} déjà défini par le pack ${owner} (préfixer les ids, ex. c_${code.replace(/-/g, "_")}_…)`);
    else conceptOwners.set(id, code);
  }
  validate("pack.schema.json", files.pack, `${code}/pack.json`);
  validate("curriculum.schema.json", files.curriculum, `${code}/curriculum.json`);
  if (files.variants) validate("lexical-variants.schema.json", files.variants, `${code}/lexical-variants.json`);
  files.lessons.forEach((f) => validate("lesson.schema.json", f, rel(f.path)));
  files.concepts.forEach((f) => validate("concept.schema.json", f, rel(f.path)));
  files.culture.forEach((f) => validate("culture.schema.json", f, rel(f.path)));
  files.dialogues.forEach((f) => validate("dialogue.schema.json", f, rel(f.path)));
  files.guides.forEach((f) => validate("guide.schema.json", f, rel(f.path)));

  // Les contrôles sémantiques supposent des fichiers conformes aux schémas (ceux de ce pack).
  if (errorCount() > errorsBefore) continue;

  const index = buildContentIndex(toRaw(files));
  issues.push(...checkContent(index, { production }));

  // Mini-test de placement (facultatif par pack).
  const placementPath = join(files.root, "placement.json");
  if (existsSync(placementPath)) {
    const placement: JsonFile = { path: placementPath, data: JSON.parse(readFileSync(placementPath, "utf8")) };
    const before = issues.length;
    validate("placement.schema.json", placement, rel(placementPath));
    if (issues.length === before) {
      for (const message of checkPlacement(index, placement.data as PlacementSpec)) report("error", rel(placementPath), message);
    }
  }

  // Examens de certificat (contrat phase2 §2.1) : schéma, puis 25 items, sections, concepts des unités requises.
  const examDir = join(files.root, "exams");
  const exams: JsonFile[] = existsSync(examDir)
    ? readdirSync(examDir).filter((n) => n.endsWith(".json")).map((n) => ({ path: join(examDir, n), data: JSON.parse(readFileSync(join(examDir, n), "utf8")) as unknown }))
    : [];
  const levels = new Map<string, string>();
  for (const exam of exams) {
    const before = issues.filter((i) => i.level === "error").length;
    validate("exam.schema.json", exam, rel(exam.path));
    if (issues.filter((i) => i.level === "error").length > before) continue;
    const data = exam.data as ExamFile;
    const where = rel(exam.path);
    if (!data.id.startsWith(`${code}.`)) report("error", where, `id ${data.id} hors du pack ${code}`);
    const expectedName = `${data.level.toLowerCase()}.json`;
    if (!exam.path.endsWith(expectedName)) report("error", where, `Le fichier d'un examen ${data.level} doit s'appeler ${expectedName}`);
    if (levels.has(data.level)) report("error", where, `Niveau ${data.level} déjà défini par ${levels.get(data.level)}`);
    levels.set(data.level, where);
    issues.push(...checkExam(index, data, where).map((i) => (production && i.message.includes("non relu") ? { ...i, level: "error" as const } : i)));
  }

  // Données de mini-jeux (games/) : Xe ôm — schéma, cohérence des itinéraires, garde du Sud sur les consignes.
  const games: JsonFile[] = [];
  const xeOmPath = join(files.root, "games", "xe_om.json");
  if (existsSync(xeOmPath)) {
    const xeOm: JsonFile = { path: xeOmPath, data: JSON.parse(readFileSync(xeOmPath, "utf8")) };
    games.push(xeOm);
    const before = issues.filter((i) => i.level === "error").length;
    validate("game-xe-om.schema.json", xeOm, rel(xeOmPath));
    if (issues.filter((i) => i.level === "error").length === before) {
      const data = xeOm.data as XeOmData;
      for (const message of checkXeOmData(data, new Set(index.concepts.keys()))) report("error", rel(xeOmPath), message);
      if (production && (!data.reviewed || data.routes.some((r) => !r.reviewed))) report("error", rel(xeOmPath), "Itinéraires non relus");
      const texts = [...data.maps.flatMap((m) => m.landmarks.map((l) => l.vi)), ...data.routes.flatMap((r) => r.instructions.map((i) => i.vi))];
      for (const text of texts) if (text !== text.normalize("NFC")) report("error", rel(xeOmPath), `Chaîne non NFC : « ${text} »`);
      if (files.variants && packFeatures(files).includes("lexical_variants")) {
        const lint = createSouthLinter((files.variants.data as { entries: LexicalVariantEntry[] }).entries);
        for (const text of texts) if (hasBlocking(lint(text))) report("error", rel(xeOmPath), `Forme du Nord dans « ${text} »`);
      }
    }
  }

  const media = new Set<string>();
  [...(files.pack ? [files.pack] : []), ...files.lessons, ...files.concepts, ...files.culture, ...files.dialogues, ...files.guides, ...exams, ...games].forEach((f) => collectMedia(f.data, media));
  const missing = [...media].filter((m) => !existsSync(join(files.root, m)));
  if (missing.length > 0) {
    report(strictMedia ? "error" : "warning", code, `${missing.length} média(s) référencé(s) absent(s), ex. ${missing.slice(0, 3).join(", ")}`);
  }
}

if (withSouthLint) {
  for (const code of listPacks()) {
    const result = southLintPack(code);
    if (result.status === "missing_variants") report("error", code, "feature lexical_variants déclarée mais lexical-variants.json absent");
    if (result.status !== "linted") continue;
    for (const h of result.hits) {
      report(h.severity === "error" ? "error" : "warning", `${h.file} ${h.path}`, `« ${h.found} » est une forme du Nord → ${h.suggestions.join(" / ")}`);
    }
  }
}

const errors = issues.filter((i) => i.level === "error");
const warnings = issues.filter((i) => i.level === "warning");

if (jsonOutput) {
  const plain = (list: ContentIssue[]) => list.map(({ where, message }) => ({ where, message }));
  process.stdout.write(`${JSON.stringify({ errors: plain(errors), warnings: plain(warnings) })}\n`);
  // exitCode plutôt que exit() : sur un tube (Windows), exit() pourrait tronquer la sortie JSON.
  process.exitCode = errors.length > 0 ? 1 : 0;
} else {
  const unreviewed = warnings.filter((w) => w.message.includes("non relue"));
  for (const w of warnings.filter((w) => !unreviewed.includes(w))) console.warn(`⚠  ${w.where} — ${w.message}`);
  // Le repli groupé ne concerne plus que les leçons : les fiches conseils partagent la formule
  // « non relue », et les compter comme des leçons donnerait un chiffre faux.
  if (unreviewed.length > 0) console.warn(`⚠  ${unreviewed.length} élément(s) non relu(s) par un locuteur natif (reviewed: false)`);
  for (const e of errors) console.error(`✖  ${e.where} — ${e.message}`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} erreur(s) de contenu.`);
    process.exit(1);
  }
  console.log(`✔  Contenu valide (${warnings.length} avertissement(s)).`);
}
