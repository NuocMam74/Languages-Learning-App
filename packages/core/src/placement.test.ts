import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlacementExercise,
  checkPlacement,
  lessonsBefore,
  nextPlacementItem,
  placementCards,
  playablePlacement,
  resolveEntryLesson,
  scorePlacement,
  type PlacementAnswer,
  type PlacementSpec,
} from "./placement.ts";
import { loadPack } from "./testing/pack.ts";
import type { ContentIndex } from "./types.ts";

const content = loadPack();
const spec = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "content", "vi-south", "placement.json"), "utf8")) as PlacementSpec;
const NOW = new Date("2026-09-14T08:00:00Z");

function run(correctFor: (index: number) => boolean): PlacementAnswer[] {
  const answers: PlacementAnswer[] = [];
  for (let item = nextPlacementItem(spec, answers); item; item = nextPlacementItem(spec, answers)) {
    answers.push({ itemId: item.id, correct: correctFor(answers.length) });
  }
  return answers;
}

describe("placement.json", () => {
  it("est cohérent avec le pack (concepts existants, assez d'items par compétence)", () => {
    expect(checkPlacement(content, spec)).toEqual([]);
    expect(spec.slots).toHaveLength(8);
    expect(spec.durationSeconds).toBe(90);
  });

  it("chaque item produit un exercice audio avec la bonne réponse parmi les options", () => {
    for (const item of spec.items) {
      const ex = buildPlacementExercise(content, item, "seed");
      if (!("answerId" in ex)) throw new Error(ex.type);
      expect(ex.options.map((o) => o.id)).toContain(ex.answerId);
      expect("audio" in ex && ex.audio).toBeTruthy();
    }
  });

  it("items de ton : tone_identify ; compréhension : choix du sens", () => {
    const tone = spec.items.find((i) => i.skill === "tone")!;
    expect(buildPlacementExercise(content, tone, "s").type).toBe("tone_identify");
    const comp = spec.items.find((i) => i.skill === "comprehension")!;
    const ex = buildPlacementExercise(content, comp, "s");
    if (ex.type !== "listen_pick_text") throw new Error(ex.type);
    expect(ex.options.every((o) => o.label !== undefined)).toBe(true);
  });
});

describe("test adaptatif", () => {
  it("8 items, sans doublon, dans l'ordre des compétences", () => {
    const answers = run(() => true);
    expect(answers).toHaveLength(8);
    expect(new Set(answers.map((a) => a.itemId)).size).toBe(8);
    const skills = answers.map((a) => spec.items.find((i) => i.id === a.itemId)!.skill);
    expect(skills).toEqual(spec.slots);
  });

  it("monte en difficulté après une réussite, descend après une erreur", () => {
    const first = nextPlacementItem(spec, [])!;
    const afterRight = nextPlacementItem(spec, [{ itemId: first.id, correct: true }])!;
    const afterWrong = nextPlacementItem(spec, [{ itemId: first.id, correct: false }])!;
    expect(afterRight.difficulty).toBeGreaterThan(afterWrong.difficulty);
  });

  it("score et niveau", () => {
    const perfect = scorePlacement(spec, run(() => true));
    expect(perfect).toMatchObject({ levelEstimate: 3, correct: 8, total: 8, score: 1 });
    expect(perfect.knownConceptIds.length).toBeGreaterThan(0);

    const none = scorePlacement(spec, run(() => false));
    expect(none).toMatchObject({ levelEstimate: 0, correct: 0, knownConceptIds: [] });

    const half = scorePlacement(spec, run((i) => i % 2 === 0));
    expect(half.levelEstimate).toBeGreaterThanOrEqual(0);
    expect(half.levelEstimate).toBeLessThan(3);
  });

  it("temps écoulé : les positions non atteintes comptent comme ratées", () => {
    const partial = run(() => true).slice(0, 3);
    const result = scorePlacement(spec, partial);
    expect(result.correct).toBe(3);
    expect(result.score).toBeLessThan(1);
    expect(result.total).toBe(8);
  });

  it("cartes SRS de départ (note good) pour les concepts reconnus, sans écraser l'existant", () => {
    const cards = placementCards(["c_ba", "c_anh"], new Set(["c_anh"]), NOW);
    expect(cards.map((c) => c.conceptId)).toEqual(["c_ba"]);
    expect(cards[0]!.state).not.toBe("new");
    expect(cards[0]!.reps).toBe(1);
  });
});

describe("point d'entrée", () => {
  it("niveau 0 → première leçon", () => {
    expect(resolveEntryLesson(content, 0)?.id).toBe("vi-south.u01.l01");
  });

  it("niveaux 0..3 → début de u01 / u03 / u05 / u07 ; les unités antérieures sont sautées", () => {
    expect([0, 1, 2, 3].map((lv) => resolveEntryLesson(content, lv)?.id)).toEqual(["vi-south.u01.l01", "vi-south.u03.l01", "vi-south.u05.l01", "vi-south.u07.l01"]);
    const skipped = lessonsBefore(content.curriculum, "vi-south.u03.l01");
    expect(skipped).toEqual([...content.curriculum.units[0]!.lessons, ...content.curriculum.units[1]!.lessons]);
    expect(lessonsBefore(content.curriculum, "vi-south.u01.l01")).toEqual([]);
  });

  it("unité cible non publiée → première unité publiée de numéro supérieur ; au-delà de la fin → dernière", () => {
    const withoutU3: ContentIndex = {
      ...content,
      curriculum: { ...content.curriculum, units: content.curriculum.units.map((u) => (u.id === "vi-south.u03" ? { ...u, status: "planned" as const } : u)) },
    };
    expect(resolveEntryLesson(withoutU3, 1)?.id).toBe("vi-south.u04.l01");
    const short: ContentIndex = { ...content, curriculum: { ...content.curriculum, units: content.curriculum.units.slice(0, 2) } };
    expect(resolveEntryLesson(short, 3)?.id).toBe("vi-south.u02.l01");
  });

  it("items jouables : sans audio natif, les items de ton sont retirés ; moins de 6 → pas de placement", () => {
    const silent: ContentIndex = { ...content, mediaIndex: new Set() };
    const playable = playablePlacement(silent, spec);
    expect(playable?.items.every((i) => i.skill !== "tone")).toBe(true);
    expect(playablePlacement(silent, { ...spec, items: spec.items.filter((i) => i.skill === "tone").concat(spec.items.filter((i) => i.skill !== "tone").slice(0, 5)) })).toBeNull();
    expect(playablePlacement(silent, spec, { toneFallback: true })?.items).toHaveLength(spec.items.length);
  });
});
