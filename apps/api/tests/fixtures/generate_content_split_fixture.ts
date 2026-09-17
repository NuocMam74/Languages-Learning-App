/**
 * Fixture de parité Python ↔ packages/core pour le découpage du contenu (core.json + unités).
 *
 * Régénérer depuis la racine du dépôt après toute modification de packages/core/src/content-split.ts :
 *   npx tsx apps/api/tests/fixtures/generate_content_split_fixture.ts
 *
 * Écrit apps/api/tests/fixtures/content_split_parity.json, rejoué par apps/api/tests/test_content_split.py.
 * Entrée : les unités u01–u02 du pack vi-south (tons, distracteurs d'images, cartes culture partagées), un concept
 * et une carte culture orphelins, des médias présents avec tailles.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { splitPack, type RawPackFiles } from "../../../../packages/core/src/index.ts";
import { readPackBundle } from "../../../../scripts/lib/load-pack.ts";

const full = readPackBundle("vi-south");
const units = full.curriculum.units.slice(0, 2);
const lessonIds = new Set(units.flatMap((u) => u.lessons));
const lessons = full.lessons.filter((l) => lessonIds.has(l.id));
const refs = new Set(lessons.flatMap((l) => [...l.concepts, ...l.review.srsIntroduce, ...l.steps.flatMap((s) => Object.values(s).flat().filter((v): v is string => typeof v === "string"))]));
const concepts = full.concepts.filter((c) => refs.has(c.id)).concat(full.concepts.find((c) => !refs.has(c.id)) ?? []);
const culture = full.culture.filter((c) => refs.has(c.id)).concat(full.culture.find((c) => !refs.has(c.id)) ?? []);
const media = [...new Set(concepts.flatMap((c) => [...c.audio.map((a) => a.src), ...(c.image ? [c.image] : [])]))].filter((_, i) => i % 3 !== 1).sort();

const input: RawPackFiles = {
  pack: full.pack,
  curriculum: { ...full.curriculum, units },
  lessons,
  concepts,
  culture,
  ...(full.variants ? { variants: { ...full.variants, entries: full.variants.entries.slice(0, 3) } } : {}),
  mediaIndex: media,
  exams: [],
  placement: full.placement ?? null,
  games: {},
};
const mediaSizes = Object.fromEntries(media.map((p, i) => [p, 1000 + i * 37]));
const { core, units: files } = splitPack(input, { mediaSize: (p) => mediaSizes[p] ?? 0 });

// Sorties comparées octet pour octet (JSON compact, empreinte SHA-256) ; manifeste des unités en clair pour le diagnostic.
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const expected = { coreSha256: sha(core), unitsSha256: files.map(sha), units: core.units, lessonIndex: core.lessonIndex.length, conceptUnits: core.conceptIndex.map((c) => c.unit ?? null) };
writeFileSync(join(import.meta.dirname, "content_split_parity.json"), `${JSON.stringify({ input, mediaSizes, expected })}\n`);
console.log(`content_split_parity.json : ${files.length} unités, ${concepts.length} concepts, ${media.length} médias`);
