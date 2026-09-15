import { describe, expect, it } from "vitest";
import { badgeCodesFor, evaluateBadges } from "./badges.ts";
import { checkContent } from "./content-checks.ts";
import { buildExercise, evaluate } from "./engine.ts";
import { choNoiPool, generateChoNoiRounds, heardKey } from "./games/cho-noi.ts";
import { buildReviewExercise, reviewFormats } from "./review.ts";
import { nextLesson } from "./session.ts";
import { emptyStreak } from "./streak.ts";
import { loadPack } from "./testing/pack.ts";
import type { ContentIndex, Lesson } from "./types.ts";

/**
 * Preuve d'extensibilité (ADR 0006) : le pack `es` (features: []) passe par le même
 * moteur que vi-south, sans code propre à l'espagnol.
 */

const es = loadPack("es");
const vi = loadPack("vi-south");

describe("pack sans tons ni variantes (es)", () => {
  it("contenu valide : aucune erreur sémantique", () => {
    expect(checkContent(es).filter((i) => i.level === "error")).toEqual([]);
    expect(es.variants).toBeUndefined();
    expect(es.pack.toneSystem).toBeUndefined();
  });

  it("chaque étape de chaque leçon se construit et s'évalue", () => {
    for (const lesson of es.lessons.values()) {
      lesson.steps.forEach((step, i) => {
        const ex = buildExercise(es, lesson, i, "seed");
        expect(ex.type).toBe(step.type);
        if ("answerId" in ex) expect(evaluate(ex, { kind: "choice", optionId: ex.answerId }).correct).toBe(true);
      });
    }
  });

  it("parcours : la première leçon est es.u01.l01, puis les prérequis s'enchaînent", () => {
    expect(nextLesson(es.curriculum, es.lessons, new Set(), null)?.id).toBe("es.u01.l01");
    expect(nextLesson(es.curriculum, es.lessons, new Set(["es.u01.l01"]), "travel")?.id).toBe("es.u01.l02");
  });

  it("révision : jamais de format tonal, jamais deux formes qui ne diffèrent que par l'accent", () => {
    for (const id of es.concepts.keys()) {
      expect(reviewFormats(es, id, { allowTtsTone: true })).not.toContain("tone_identify");
      const ex = buildReviewExercise(es, id, "s", undefined, { allowTtsTone: true });
      expect(ex.type).not.toBe("tone_identify");
    }
    const tu = buildReviewExercise(es, "c_es_tu", "s", "listen_pick_text");
    if (tu.type === "listen_pick_text") expect(tu.options.map((o) => o.text)).not.toContain("tu");
  });

  it("Chợ nổi sans système tonal : manches jouables, homographes à l'accent près jamais opposés", () => {
    expect(heardKey("sí")).toBe(heardKey("si"));
    const lesson = es.lessons.get("es.u01.l03") as Lesson;
    const pool = choNoiPool(lesson.concepts.map((id) => es.concepts.get(id)!), { requireNative: false });
    const rounds = generateChoNoiRounds(pool, "es", {}, es.pack.toneSystem?.heardClasses);
    expect(rounds.length).toBeGreaterThan(0);
    for (const round of rounds) expect(new Set(round.boats.map((b) => heardKey(b.text))).size).toBe(round.boats.length);
  });

  it("badges : l'oreille tonale ne s'applique qu'aux packs tonals", () => {
    expect(badgeCodesFor(es.pack)).not.toContain("tone_ear");
    expect(badgeCodesFor(vi.pack)).toContain("tone_ear");
    const input = { curriculum: es.curriculum, completedLessons: new Set<string>(), streak: emptyStreak(), knownWords: 0, toneLog: Array<boolean>(50).fill(true) };
    expect(evaluateBadges({ ...input, features: es.pack.features }, new Set())).not.toContain("tone_ear");
    expect(evaluateBadges({ ...input, features: vi.pack.features }, new Set())).toContain("tone_ear");
  });
});

describe("contrôles pilotés par pack.features", () => {
  const withLesson = (content: ContentIndex, patch: Partial<Lesson>): ContentIndex => {
    const lesson = { ...(content.lessons.get("es.u01.l01") as Lesson), ...patch };
    return { ...content, lessons: new Map([...content.lessons, [lesson.id, lesson]]) };
  };

  it("un exercice de tons dans un pack sans « tones » est refusé", () => {
    const lesson = es.lessons.get("es.u01.l01") as Lesson;
    const bad = withLesson(es, { steps: [...lesson.steps, { type: "tone_identify", concept: "c_es_hola" }] });
    expect(checkContent(bad).some((i) => i.level === "error" && i.message.includes("tones"))).toBe(true);
  });

  it("spot_the_south sans « lexical_variants », toneSystem sans « tones » : refusés", () => {
    const lesson = es.lessons.get("es.u01.l01") as Lesson;
    const bad = withLesson(es, { steps: [...lesson.steps, { type: "spot_the_south", variant: "lv_x" }] });
    expect(checkContent(bad).some((i) => i.message.includes("lexical_variants"))).toBe(true);
    const toneless = { ...es, pack: { ...es.pack, toneSystem: vi.pack.toneSystem! } };
    expect(checkContent(toneless).some((i) => i.where === "pack.json")).toBe(true);
  });
});
