import type { Concept, ContentIndex, CultureCard, Curriculum, LexicalVariants, Lesson, Pack } from "./types.ts";

/** Fichiers bruts d'un pack, quelle que soit leur provenance (disque, CDN, IndexedDB). */
export interface RawPackFiles {
  pack: Pack;
  curriculum: Curriculum;
  lessons: readonly Lesson[];
  concepts: readonly Concept[];
  culture: readonly CultureCard[];
  variants?: LexicalVariants;
}

export function buildContentIndex(raw: RawPackFiles): ContentIndex {
  return {
    pack: raw.pack,
    curriculum: raw.curriculum,
    lessons: new Map(raw.lessons.map((l) => [l.id, l])),
    concepts: new Map(raw.concepts.map((c) => [c.id, c])),
    culture: new Map(raw.culture.map((c) => [c.id, c])),
    ...(raw.variants ? { variants: raw.variants } : {}),
  };
}
