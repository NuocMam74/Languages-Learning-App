import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildContentIndex } from "../content-index.ts";
import type { ContentIndex, RawPackFiles } from "../index.ts";

/** Charge un pack réel depuis content/ (tests uniquement). */
export function loadPack(code = "vi-south"): ContentIndex {
  const root = join(import.meta.dirname, "..", "..", "..", "..", "content", code);
  const read = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
  const all = <T>(dir: string): T[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => read<T>(join(e.parentPath, e.name)));

  const raw: RawPackFiles = {
    pack: read(join(root, "pack.json")),
    curriculum: read(join(root, "curriculum.json")),
    // Facultatif : seuls les packs à variantes régionales (feature lexical_variants) en ont.
    ...(existsSync(join(root, "lexical-variants.json")) ? { variants: read<NonNullable<RawPackFiles["variants"]>>(join(root, "lexical-variants.json")) } : {}),
    lessons: all(join(root, "lessons")),
    concepts: all(join(root, "concepts")),
    culture: all(join(root, "culture")),
    // Facultatif : un pack sans dialogue n'a pas le dossier.
    ...(existsSync(join(root, "dialogues")) ? { dialogues: all<NonNullable<RawPackFiles["dialogues"]>[number]>(join(root, "dialogues")) } : {}),
    // Idem pour les fiches conseils (contrat phase15 §1).
    ...(existsSync(join(root, "guides")) ? { guides: all<NonNullable<RawPackFiles["guides"]>[number]>(join(root, "guides")) } : {}),
  };
  return buildContentIndex(raw);
}
