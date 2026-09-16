import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { RawPackFiles } from "@parlo/core";

/** Racine du contenu (défaut : content/ du dépôt). Liaison ES vivante : `setContentRoot` la remplace pour tous les importeurs. */
export let CONTENT_ROOT = join(import.meta.dirname, "..", "..", "content");

/** Change la racine du contenu (ex. `validate-content.ts --root <dir>` sur une copie temporaire du studio). */
export function setContentRoot(dir: string): void {
  CONTENT_ROOT = resolve(dir);
}

export interface JsonFile {
  path: string;
  data: unknown;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonFilesIn(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsonFilesIn(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

/** Packs = dossiers de content/ qui ont un pack.json (un dossier en cours de création est ignoré). */
export function listPacks(): string[] {
  return readdirSync(CONTENT_ROOT).filter(
    (name) => name !== "schema" && statSync(join(CONTENT_ROOT, name)).isDirectory() && existsSync(join(CONTENT_ROOT, name, "pack.json")),
  );
}

/** `features` du pack.json (vide si illisible) : pilote les modules optionnels (tons, variantes). */
export function packFeatures(files: ReturnType<typeof readPackFiles>): string[] {
  const features = (files.pack?.data as { features?: unknown } | undefined)?.features;
  return Array.isArray(features) ? features.filter((f): f is string => typeof f === "string") : [];
}

/** Fichiers d'un pack groupés par nature, avec leur chemin (pour les messages d'erreur). */
export function readPackFiles(code: string) {
  const root = join(CONTENT_ROOT, code);
  const group = (sub: string): JsonFile[] => jsonFilesIn(join(root, sub)).map((path) => ({ path, data: readJson(path) }));
  const single = (name: string): JsonFile | null => {
    try {
      return { path: join(root, name), data: readJson(join(root, name)) };
    } catch {
      return null;
    }
  };
  return {
    root,
    pack: single("pack.json"),
    curriculum: single("curriculum.json"),
    variants: single("lexical-variants.json"),
    lessons: group("lessons"),
    concepts: group("concepts"),
    culture: group("culture"),
    dialogues: group("dialogues"),
  };
}

export function toRaw(files: ReturnType<typeof readPackFiles>): RawPackFiles {
  if (!files.pack || !files.curriculum) throw new Error(`pack.json ou curriculum.json manquant dans ${files.root}`);
  return {
    pack: files.pack.data as RawPackFiles["pack"],
    curriculum: files.curriculum.data as RawPackFiles["curriculum"],
    lessons: files.lessons.map((f) => f.data as RawPackFiles["lessons"][number]),
    concepts: files.concepts.map((f) => f.data as RawPackFiles["concepts"][number]),
    culture: files.culture.map((f) => f.data as RawPackFiles["culture"][number]),
    dialogues: files.dialogues.map((f) => f.data as NonNullable<RawPackFiles["dialogues"]>[number]),
    ...(files.variants ? { variants: files.variants.data as NonNullable<RawPackFiles["variants"]> } : {}),
  };
}

// ---------------------------------------------------------------------------
// Bundle servi (contrat phase5 §1 et §6) et découpage core + unités (audit mobile P1 #6)

/** Dossiers et extensions des médias publiés : identiques à apps/api/app/services/content.py. */
export const MEDIA_DIRS = ["audio", "pitch", "img"] as const;
export const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([".json", ".opus", ".m4a", ".webp", ".png", ".svg"]);

/** Fichiers médias présents d'un pack (chemins absolus). */
export function mediaFiles(code: string): string[] {
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir).flatMap((name) => {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) return walk(full);
          const dot = name.lastIndexOf(".");
          return dot >= 0 && MEDIA_EXTENSIONS.has(name.slice(dot).toLowerCase()) ? [full] : [];
        })
      : [];
  return MEDIA_DIRS.flatMap((d) => walk(join(CONTENT_ROOT, code, d)));
}

const readOptionalJson = (path: string): unknown => (existsSync(path) ? readJson(path) : undefined);

/** Tout le JSON d'un pack tel que servi dans `bundle.json` : fichiers + examens, placement, jeux, index des médias. */
export function readPackBundle(code: string): RawPackFiles {
  const root = join(CONTENT_ROOT, code);
  const examsDir = join(root, "exams");
  const exams = existsSync(examsDir)
    ? readdirSync(examsDir).filter((n) => n.endsWith(".json")).sort().map((n) => readJson(join(examsDir, n)))
    : [];
  const xeOm = readOptionalJson(join(root, "games", "xe_om.json"));
  return {
    ...toRaw(readPackFiles(code)),
    mediaIndex: mediaFiles(code).map((file) => relative(root, file).split("\\").join("/")).sort(),
    exams: exams as NonNullable<RawPackFiles["exams"]>,
    placement: (readOptionalJson(join(root, "placement.json")) ?? null) as NonNullable<RawPackFiles["placement"]> | null,
    games: (xeOm ? { xe_om: xeOm } : {}) as NonNullable<RawPackFiles["games"]>,
  };
}

/** Taille (octets) d'un média du pack ; 0 s'il est absent. */
export function packMediaSize(code: string, path: string): number {
  try {
    return statSync(join(CONTENT_ROOT, code, path)).size;
  } catch {
    return 0;
  }
}

export const rel = (path: string) => relative(join(CONTENT_ROOT, ".."), path).replaceAll("\\", "/");
