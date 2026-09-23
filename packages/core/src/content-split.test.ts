import { describe, expect, it } from "vitest";
import type { RawPackFiles } from "./content-index.ts";
import {
  addUnitToIndex,
  buildSplitContentIndex,
  isCoreFile,
  isUnitFile,
  isUnitLoaded,
  lessonConceptRefs,
  mergeSplit,
  missingUnits,
  splitPack,
  unitDownloadBytes,
  unitsForLessons,
  unitsOfConcepts,
  utf8Bytes,
} from "./content-split.ts";
import { buildExercise } from "./engine.ts";
import { buildReviewExercise } from "./review.ts";
import { loadPack } from "./testing/pack.ts";
import type { ContentIndex } from "./types.ts";

const rawOf = (index: ContentIndex, extras: Partial<RawPackFiles> = {}): RawPackFiles => ({
  pack: index.pack,
  curriculum: index.curriculum,
  lessons: [...index.lessons.values()],
  concepts: [...index.concepts.values()],
  culture: [...index.culture.values()],
  ...(index.variants ? { variants: index.variants } : {}),
  ...extras,
});

const vi = rawOf(loadPack("vi-south"), { mediaIndex: ["img/animals/cat.svg", "img/people/anh.svg", "audio/c_anh_mai.opus"], exams: [], placement: null, games: {} });
const es = rawOf(loadPack("es"), { mediaIndex: [], exams: [], placement: null, games: {} });

describe("découpage core + unités", () => {
  it("recompose exactement les fichiers d'origine (vi-south, es)", () => {
    for (const raw of [vi, es]) {
      const { core, units } = splitPack(raw);
      expect(isCoreFile(core)).toBe(true);
      expect(units.every(isUnitFile)).toBe(true);
      const merged = mergeSplit(core, units);
      expect(merged.lessons).toEqual(raw.lessons);
      expect(merged.concepts).toEqual(raw.concepts);
      expect(new Map(merged.culture.map((c) => [c.id, c]))).toEqual(new Map(raw.culture.map((c) => [c.id, c])));
      expect(merged.variants).toEqual(raw.variants);
      expect(merged.mediaIndex).toEqual(raw.mediaIndex);
      // JSON survit à l'aller-retour (fichiers servis).
      expect(JSON.parse(JSON.stringify(core))).toEqual(core);
    }
  });

  it("un concept complet vit dans l'unité qui le cite en premier ; une carte culture dans chaque unité qui la cite", () => {
    const { core, units } = splitPack(vi);
    const order = vi.curriculum.units.map((u) => u.id);
    const unitOf = new Map(core.conceptIndex.map((c) => [c.id, c.unit]));
    for (const unit of units) {
      for (const lesson of unit.lessons) {
        for (const id of lessonConceptRefs(lesson)) {
          const home = unitOf.get(id);
          if (!home) continue;
          expect(order.indexOf(home)).toBeLessThanOrEqual(order.indexOf(unit.unit));
        }
        for (const step of lesson.steps) if (step.type === "culture_card") expect(unit.culture.some((c) => c.id === step.ref)).toBe(true);
      }
    }
    expect(new Set(units.flatMap((u) => u.concepts.map((c) => c.id))).size).toBe(vi.concepts.length);
  });

  it("le core est nettement plus petit que le bundle complet", () => {
    const { core, units } = splitPack(vi);
    const bundleBytes = utf8Bytes(JSON.stringify(vi));
    expect(utf8Bytes(JSON.stringify(core))).toBeLessThan(bundleBytes * 0.45);
    expect(Math.max(...core.units.map((u) => u.bytes))).toBeLessThan(bundleBytes * 0.2);
    expect(core.units.map((u) => u.id)).toEqual(units.map((u) => u.unit));
  });

  it("tailles : JSON de l'unité (octets UTF-8) + médias présents", () => {
    const { core, units } = splitPack(vi, { mediaSize: (p) => (p.endsWith(".svg") ? 1000 : 50_000) });
    for (const [i, u] of units.entries()) {
      const entry = core.units[i]!;
      expect(entry.bytes).toBe(new TextEncoder().encode(JSON.stringify(u)).length);
      expect(entry.mediaCount).toBe(u.media.length);
      expect(u.media.every((p) => vi.mediaIndex!.includes(p))).toBe(true);
      expect(unitDownloadBytes(entry)).toBe(entry.bytes + entry.mediaBytes);
    }
    expect(core.units.reduce((s, u) => s + u.mediaBytes, 0)).toBeGreaterThan(0);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("ạ")).toBe(3);
    expect(utf8Bytes("😀")).toBe(4);
  });
});

describe("index partiel", () => {
  const { core, units } = splitPack(vi);
  const u01 = units.find((u) => u.unit === "vi-south.u01")!;

  it("hub sans unité : cursus, titres, concepts compacts ; leçons sans étapes", () => {
    const index = buildSplitContentIndex(core);
    expect(index.lessons.size).toBe(vi.lessons.length);
    expect(index.concepts.size).toBe(vi.concepts.length);
    expect(index.lessons.get("vi-south.u01.l01")?.steps).toEqual([]);
    expect(index.lessons.get("vi-south.u01.l01")?.title).toEqual(vi.lessons.find((l) => l.id === "vi-south.u01.l01")?.title);
    expect(missingUnits(index, ["vi-south.u01", "vi-south.u01", "inconnue"])).toEqual(["vi-south.u01"]);
    expect(isUnitLoaded(index, "vi-south.u01")).toBe(false);
    // Les révisions se construisent avec l'index compact.
    const id = vi.lessons[0]!.review.srsIntroduce[0]!;
    expect(() => buildReviewExercise(index, id, "seed")).not.toThrow();
  });

  it("ensureUnits : une unité chargée rend ses leçons jouables, en place", () => {
    const index = buildSplitContentIndex(core);
    const lessonIds = u01.lessons.map((l) => l.id);
    expect(unitsForLessons(index, lessonIds)).toContain("vi-south.u01");
    expect(addUnitToIndex(index, u01)).toBe(true);
    expect(isUnitLoaded(index, "vi-south.u01")).toBe(true);
    for (const needed of unitsForLessons(index, lessonIds)) addUnitToIndex(index, units.find((u) => u.unit === needed)!);
    for (const lesson of u01.lessons) {
      const full = index.lessons.get(lesson.id)!;
      expect(full.steps.length).toBeGreaterThan(0);
      full.steps.forEach((_, i) => expect(() => buildExercise(index, full, i, "s")).not.toThrow());
    }
    // Autre version : ignorée.
    expect(addUnitToIndex(index, { ...units[1]!, version: 99 })).toBe(false);
  });

  it("unités des concepts dus (révisions)", () => {
    const index = buildSplitContentIndex(core);
    const late = units.at(-1)!.concepts[0]!.id;
    expect(unitsOfConcepts(index, [late, "inconnu"])).toEqual([units.at(-1)!.unit]);
  });

  it("un index complet (ancien bundle) n'a jamais d'unité manquante", () => {
    const full = loadPack("vi-south");
    expect(missingUnits(full, ["vi-south.u01"])).toEqual([]);
    expect(isUnitLoaded(full, "vi-south.u01")).toBe(true);
  });
});

describe("dialogues dans le découpage (contrat phase6 §3)", () => {
  const dialogue = {
    id: "dlg_test",
    title: { fr: "Test" },
    turns: [
      { speaker: "A", vi: "Chào anh.", translation: { fr: "Bonjour." }, audio: "audio/dlg_a.opus" },
      { speaker: "B", vi: "Dạ chào cô.", translation: { fr: "Bonjour." }, audio: "audio/dlg_b.opus" },
    ],
    question: { prompt: { fr: "Qui parle ?" }, options: [{ fr: "Deux personnes" }, { fr: "Une" }], answer: 0 },
    reviewed: true,
  };

  it("un pack sans dialogue produit exactement le même core qu'avant (parité API)", () => {
    expect(splitPack(vi).core.dialogues).toBeUndefined();
    expect("dialogues" in splitPack(vi).core).toBe(false);
  });

  it("les dialogues voyagent dans le core et se retrouvent dans l'index", () => {
    const first = [...vi.lessons][0]!;
    const raw: RawPackFiles = {
      ...vi,
      dialogues: [dialogue],
      mediaIndex: [...(vi.mediaIndex ?? []), "audio/dlg_a.opus", "audio/dlg_b.opus"],
      lessons: vi.lessons.map((l) => (l.id === first.id ? { ...l, steps: [...l.steps, { type: "listen_gist" as const, dialogue: "dlg_test" }] } : l)),
    };
    const { core, units } = splitPack(raw);
    expect(core.dialogues).toEqual([dialogue]);
    const index = buildSplitContentIndex(core, units);
    expect(index.dialogues.get("dlg_test")?.turns).toHaveLength(2);
    expect(mergeSplit(core, units).dialogues).toEqual([dialogue]);
    // L'audio du dialogue se télécharge avec l'unité qui le joue.
    expect(units.find((u) => u.unit === first.unit)?.media).toContain("audio/dlg_a.opus");
  });
});
