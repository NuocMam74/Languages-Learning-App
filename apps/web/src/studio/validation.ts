import {
  buildContentIndex,
  checkContent,
  checkExam,
  hasFeature,
  type Concept,
  type ContentIssue,
  type CultureCard,
  type Curriculum,
  type ExamFile,
  type Lesson,
  type LexicalVariants,
  type Pack,
  type RawPackFiles,
  type ContentIndex,
} from "@parlo/core";
import { createSouthLinter } from "@parlo/south-lint";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { DocKind } from "./studio-api.ts";
import { st, type StudioKey } from "./i18n.ts";

/**
 * Validation en direct d'un brouillon, dans le navigateur, avec les mêmes règles que la CI
 * (scripts/validate-content.ts) :
 *   1. schémas JSON du dépôt (content/schema, importés par Vite dans le seul chunk du studio) ;
 *   2. contrôles sémantiques @parlo/core sur le pack publié avec le brouillon superposé ;
 *   3. garde du Sud sur les champs vietnamiens.
 * Chaque problème est rattaché à un champ (`path` pointé, ex. `steps.2.concept`) et formulé simplement dans la langue d'interface (messages : i18n/messages/studio.ts).
 */

export interface FieldIssue {
  level: "error" | "warning";
  /** Chemin pointé du champ ; "" = le document entier. */
  path: string;
  message: string;
  source: "schema" | "content" | "south";
}

const schemaFiles = import.meta.glob<object>("../../../../content/schema/*.schema.json", { eager: true, import: "default" });

const SCHEMA_OF: Record<DocKind, string> = {
  lesson: "lesson.schema.json",
  concept: "concept.schema.json",
  culture: "culture.schema.json",
  curriculum: "curriculum.schema.json",
  "lexical-variants": "lexical-variants.schema.json",
  exam: "exam.schema.json",
  pack: "pack.schema.json",
};

let ajv: Ajv2020 | null = null;
const compiled = new Map<DocKind, ValidateFunction>();

function validatorFor(kind: DocKind): ValidateFunction | null {
  const cached = compiled.get(kind);
  if (cached) return cached;
  if (!ajv) {
    // Mêmes options que la CI.
    ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, discriminator: true });
    for (const schema of Object.values(schemaFiles)) ajv.addSchema(schema);
  }
  const fn = ajv.getSchema(`https://parlo.app/schema/${SCHEMA_OF[kind]}`) ?? null;
  if (fn) compiled.set(kind, fn);
  return fn;
}

const PATTERN_HINTS: [RegExp, StudioKey][] = [
  [/\^\(c\|s\|t\|p\)_/, "validation.pattern.concept"],
  [/\\\.u\[0-9\]\{2\}\\\.l/, "validation.pattern.lesson"],
  [/\\\.u\[0-9\]\{2\}\$/, "validation.pattern.unit"],
  [/\^cc_/, "validation.pattern.culture"],
  [/\^lv_/, "validation.pattern.variant"],
  [/opus\|m4a/, "validation.pattern.media"],
  [/___/, "validation.pattern.gap"],
  [/exam/, "validation.pattern.exam"],
];

function pointerToPath(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function plural(n: number, one: StudioKey, many: StudioKey): string {
  return st(n > 1 ? many : one, { n });
}

/** Erreur ajv → message clair, rattaché au champ concerné. */
export function describeSchemaError(e: ErrorObject): { path: string; message: string } | null {
  const base = pointerToPath(e.instancePath);
  const params = e.params as Record<string, unknown>;
  const at = (...extra: string[]) => [...base, ...extra].join(".");
  switch (e.keyword) {
    case "required":
      return { path: at(String(params.missingProperty)), message: st("validation.required") };
    case "additionalProperties":
      return { path: at(), message: st("validation.additional", { name: String(params.additionalProperty) }) };
    case "pattern": {
      const pattern = String(params.pattern);
      const hint = PATTERN_HINTS.find(([re]) => re.test(pattern))?.[1];
      return { path: at(), message: st(hint ?? "validation.format") };
    }
    case "minLength":
      return { path: at(), message: st("validation.empty") };
    case "minItems":
      return { path: at(), message: plural(Number(params.limit), "validation.minItems.one", "validation.minItems.many") };
    case "maxItems":
      return { path: at(), message: plural(Number(params.limit), "validation.maxItems.one", "validation.maxItems.many") };
    case "uniqueItems":
      return { path: at(), message: st("validation.unique") };
    case "enum":
    case "const":
      return { path: at(), message: st("validation.enum") };
    case "type":
      return { path: at(), message: st(params.type === "integer" ? "validation.integer" : params.type === "string" ? "validation.string" : "validation.type") };
    case "minimum":
      return { path: at(), message: st("validation.minimum", { n: String(params.limit) }) };
    case "maximum":
      return { path: at(), message: st("validation.maximum", { n: String(params.limit) }) };
    case "exclusiveMinimum":
      return { path: at(), message: st("validation.exclusiveMinimum", { n: String(params.limit) }) };
    case "propertyNames":
    case "pattern_propertyName":
      return { path: at(), message: st("validation.locale") };
    case "discriminator":
      return { path: at("type"), message: st("validation.stepType") };
    case "not":
      return { path: at("type"), message: st("validation.stepNotAllowed") };
    case "oneOf":
    case "anyOf":
    case "allOf":
    case "if":
      return null;
    default:
      return { path: at(), message: e.message ?? st("validation.invalid") };
  }
}

export function schemaIssues(kind: DocKind, data: unknown): FieldIssue[] {
  const fn = validatorFor(kind);
  if (!fn) return [];
  if (fn(data)) return [];
  const errors = fn.errors ?? [];
  const out: FieldIssue[] = [];
  const seen = new Set<string>();
  for (const e of errors) {
    const described = describeSchemaError(e);
    if (!described) continue;
    const key = `${described.path}|${described.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ level: "error", source: "schema", ...described });
  }
  // conceptPool : « lesson | unit | known » OU liste ; ajv n'a alors qu'un oneOf à signaler.
  if (out.length === 0 && errors.length > 0) {
    const first = errors[0];
    out.push({ level: "error", source: "schema", path: first ? pointerToPath(first.instancePath).join(".") : "", message: st("validation.invalid") });
  }
  return out;
}

// --- Pack publié + brouillon superposé -------------------------------------------

export function rawFromIndex(index: ContentIndex): RawPackFiles {
  return {
    pack: index.pack,
    curriculum: index.curriculum,
    lessons: [...index.lessons.values()],
    concepts: [...index.concepts.values()],
    culture: [...index.culture.values()],
    // Sans les dialogues, l'aperçu d'une étape `listen_gist` échouerait (contrat phase6 §6).
    ...(index.dialogues.size > 0 ? { dialogues: [...index.dialogues.values()] } : {}),
    ...(index.variants ? { variants: index.variants } : {}),
  };
}

function replaceById<T extends { id: string }>(items: readonly T[], id: string, next: T): T[] {
  const out = items.filter((item) => item.id !== id);
  out.push(next);
  return out;
}

/** Superpose un document (brouillon) aux fichiers publiés. Les autres brouillons connus peuvent être superposés en chaîne. */
export function overlay(raw: RawPackFiles, kind: DocKind, id: string, data: unknown): RawPackFiles {
  switch (kind) {
    case "lesson":
      return { ...raw, lessons: replaceById(raw.lessons, id, data as Lesson) };
    case "concept":
      return { ...raw, concepts: replaceById(raw.concepts, id, data as Concept) };
    case "culture":
      return { ...raw, culture: replaceById(raw.culture, id, data as CultureCard) };
    case "curriculum":
      return { ...raw, curriculum: data as Curriculum };
    case "lexical-variants":
      return { ...raw, variants: data as LexicalVariants };
    case "pack":
      return { ...raw, pack: data as Pack };
    case "exam":
      return raw;
  }
}

export function overlayAll(raw: RawPackFiles, drafts: Iterable<{ kind: DocKind; id: string; data: unknown }>): RawPackFiles {
  let out = raw;
  for (const d of drafts) out = overlay(out, d.kind, d.id, d.data);
  return out;
}

function belongsTo(issue: ContentIssue, kind: DocKind, id: string): boolean {
  switch (kind) {
    case "lesson":
      return issue.where === id || issue.where.startsWith(`${id} `);
    case "concept":
    case "culture":
      return issue.where === id;
    case "pack":
      return issue.where === "pack.json";
    case "lexical-variants":
      return issue.where === "lexical-variants.json";
    case "curriculum":
      return issue.where === "curriculum.json" || /\.u\d{2}$/.test(issue.where);
    case "exam":
      return true;
  }
}

function nfcPath(message: string): string | null {
  const m = /non NFC en (.+)$/.exec(message);
  return m?.[1] ? m[1].replace(/\[(\d+)\]/g, ".$1").replace(/^\(racine\)$/, "") : null;
}

/** Rattache un problème sémantique (`where` + message du validateur) à un champ du document. */
export function contentIssuePath(issue: ContentIssue, kind: DocKind, id: string, data: unknown): string {
  const nfc = nfcPath(issue.message);
  if (nfc !== null) return nfc;
  const msg = issue.message;
  switch (kind) {
    case "lesson": {
      const step = /étape (\d+)/.exec(issue.where);
      if (step?.[1]) return `steps.${Number(step[1]) - 1}`;
      if (/Prérequis|Cycle/.test(msg)) return "prerequisites";
      if (/srsIntroduce/.test(msg)) return "review.srsIntroduce";
      if (/Concept inconnu/.test(msg)) return "concepts";
      if (/curriculum|listée|Déclarée/.test(msg)) return "unit";
      if (/doit commencer par/.test(msg)) return "id";
      if (/non relue/.test(msg)) return "reviewed";
      return "";
    }
    case "concept":
      if (/tone|Ton déclaré/.test(msg)) return "tone";
      if (/TTS/.test(msg)) return "audio";
      if (/non relu/.test(msg)) return "reviewed";
      return "";
    case "culture": {
      const body = /Corps (\S+)/.exec(msg);
      if (body?.[1]) return `body.${body[1]}`;
      if (/Réponse hors/.test(msg)) return "question.answer";
      return "";
    }
    case "exam": {
      const item = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\w+)\\[(\\d+)\\]`).exec(issue.where);
      if (item?.[1] && item[2]) {
        const sections = (data as Partial<ExamFile>).sections ?? [];
        const s = sections.findIndex((sec) => sec.skill === item[1]);
        return s >= 0 ? `sections.${s}.items.${item[2]}.step` : "sections";
      }
      if (/Unité requise/.test(msg)) return "requiresUnits";
      if (/items|Section/.test(msg)) return "sections";
      if (/non relu/.test(msg)) return "reviewed";
      return "";
    }
    default:
      return "";
  }
}

export function contentIssues(raw: RawPackFiles, kind: DocKind, id: string, data: unknown): FieldIssue[] {
  try {
    const index = buildContentIndex(overlay(raw, kind, id, data));
    const issues = kind === "exam" ? checkExam(index, data as ExamFile, id) : checkContent(index).filter((i) => belongsTo(i, kind, id));
    return issues.map((i) => ({ level: i.level, source: "content" as const, path: contentIssuePath(i, kind, id, data), message: i.message }));
  } catch (error) {
    return [{ level: "error", source: "content", path: "", message: st("validation.checkFailed", { message: error instanceof Error ? error.message : String(error) }) }];
  }
}

// --- Garde du Sud ------------------------------------------------------------------

type ViField = { path: string; text: string };

const STEP_VI_ARRAYS: Record<string, string[]> = {
  listen_pick_text: ["distractors"],
  listen_transcribe: ["accepted"],
  tone_minimal_pair: ["pair"],
  build_sentence: ["tokens"],
  fill_gap: ["options"],
  translate_to_vi: ["accepted"],
};
const STEP_VI_STRINGS: Record<string, string[]> = {
  build_sentence: ["target"],
  fill_gap: ["text", "answer"],
  translate_to_fr: ["source"],
};

function stepViFields(step: unknown, prefix: string): ViField[] {
  if (!step || typeof step !== "object") return [];
  const s = step as Record<string, unknown>;
  const type = String(s.type ?? "");
  const out: ViField[] = [];
  for (const key of STEP_VI_STRINGS[type] ?? []) {
    if (typeof s[key] === "string") out.push({ path: `${prefix}.${key}`, text: s[key] });
  }
  for (const key of STEP_VI_ARRAYS[type] ?? []) {
    const list = s[key];
    if (Array.isArray(list)) list.forEach((v, i) => typeof v === "string" && out.push({ path: `${prefix}.${key}.${i}`, text: v }));
  }
  return out;
}

/** Champs en vietnamien du Sud d'un document (northernEquivalent et le tableau des variantes sont exclus exprès). */
export function viFields(kind: DocKind, data: unknown): ViField[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const out: ViField[] = [];
  switch (kind) {
    case "concept":
      if (typeof d.vi === "string") out.push({ path: "vi", text: d.vi });
      if (Array.isArray(d.examples)) d.examples.forEach((ex, i) => typeof (ex as { vi?: unknown })?.vi === "string" && out.push({ path: `examples.${i}.vi`, text: (ex as { vi: string }).vi }));
      break;
    case "culture":
      if (typeof d.vi === "string") out.push({ path: "vi", text: d.vi });
      break;
    case "lesson":
      if (Array.isArray(d.steps)) d.steps.forEach((step, i) => out.push(...stepViFields(step, `steps.${i}`)));
      break;
    case "exam":
      if (Array.isArray(d.sections)) {
        d.sections.forEach((section, s) => {
          const items = (section as { items?: unknown })?.items;
          if (Array.isArray(items)) items.forEach((item, i) => out.push(...stepViFields((item as { step?: unknown })?.step, `sections.${s}.items.${i}.step`)));
        });
      }
      break;
    case "pack": {
      const welcome = d.welcome as { vi?: unknown } | undefined;
      if (typeof welcome?.vi === "string") out.push({ path: "welcome.vi", text: welcome.vi });
      break;
    }
    default:
      break;
  }
  return out;
}

export function southIssues(kind: DocKind, data: unknown, variants: LexicalVariants | undefined): FieldIssue[] {
  if (!variants) return [];
  const lint = createSouthLinter(variants.entries);
  const out: FieldIssue[] = [];
  for (const field of viFields(kind, data)) {
    for (const f of lint(field.text)) {
      out.push({
        level: f.severity,
        source: "south",
        path: field.path,
        message: st("validation.north", { found: f.found, suggestions: f.suggestions.join(" / ") }),
      });
    }
  }
  return out;
}

// --- Tout ensemble -------------------------------------------------------------------

export interface ValidationContext {
  /** Pack publié (avec les autres brouillons connus superposés) ; null si indisponible : schémas seuls. */
  raw: RawPackFiles | null;
}

export function validateDraft(ctx: ValidationContext, kind: DocKind, id: string, data: unknown): FieldIssue[] {
  const schema = schemaIssues(kind, data);
  if (schema.length > 0 || !ctx.raw) return schema;
  const withDraft = overlay(ctx.raw, kind, id, data);
  const lintable = hasFeature(withDraft.pack, "lexical_variants") && kind !== "lexical-variants";
  return [...contentIssues(ctx.raw, kind, id, data), ...(lintable ? southIssues(kind, data, withDraft.variants) : [])];
}

/** Problèmes exactement sur ce champ. */
export function issuesAt(issues: readonly FieldIssue[], path: string): FieldIssue[] {
  return issues.filter((i) => i.path === path);
}

/** Problèmes sur ce champ ou ses sous-champs. */
export function issuesUnder(issues: readonly FieldIssue[], prefix: string): FieldIssue[] {
  return issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));
}
