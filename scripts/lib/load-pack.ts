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
    ...(files.variants ? { variants: files.variants.data as NonNullable<RawPackFiles["variants"]> } : {}),
  };
}

export const rel = (path: string) => relative(join(CONTENT_ROOT, ".."), path).replaceAll("\\", "/");
