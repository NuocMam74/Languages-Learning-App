import { describe, expect, it } from "vitest";
import { canBuild, checkContent } from "./content-checks.ts";
import { makeEvent, uuidv7 } from "./events.ts";
import { loadPack } from "./testing/pack.ts";
import type { ContentIndex, Lesson, LessonStep } from "./types.ts";

const content = loadPack();

function withStep(step: LessonStep): ContentIndex {
  const l01 = content.lessons.get("vi-south.u01.l01")!;
  const lesson: Lesson = { ...l01, steps: [...l01.steps, step] };
  return { ...content, lessons: new Map([...content.lessons, [lesson.id, lesson]]) };
}

const errorsOf = (c: ContentIndex) => checkContent(c).filter((i) => i.level === "error").map((i) => i.message);

describe("checkContent", () => {
  it("les 3 leçons d'exemple sont sans erreur", () => {
    expect(errorsOf(content)).toEqual([]);
  });

  it("refuse d'opposer hỏi et ngã en discrimination auditive (Sud)", () => {
    const errors = errorsOf(withStep({ type: "tone_minimal_pair", pair: ["mả", "mã"] }));
    expect(errors.some((m) => m.includes("indiscernables"))).toBe(true);
  });

  it("refuse une fausse paire minimale", () => {
    expect(errorsOf(withStep({ type: "tone_minimal_pair", pair: ["ma", "ba"] })).some((m) => m.includes("paire minimale"))).toBe(true);
  });

  it("refuse une phrase impossible à construire", () => {
    const step: LessonStep = { type: "build_sentence", target: "Đây là má tôi.", tokens: ["Đây", "là", "ba", "tôi"], translation: { fr: "x" } };
    expect(errorsOf(withStep(step)).some((m) => m.includes("Impossible de former"))).toBe(true);
  });

  it("refuse les références inconnues", () => {
    expect(errorsOf(withStep({ type: "speak_repeat", concept: "c_inconnu" }))).toContain("Concept inconnu : c_inconnu");
    expect(errorsOf(withStep({ type: "spot_the_south", variant: "lv_avion" })).some((m) => m.includes("identiques"))).toBe(true);
  });

  it("refuse une chaîne non NFC", () => {
    expect(errorsOf(withStep({ type: "listen_pick_text", concept: "c_ma_mom", distractors: ["mà".normalize("NFD")] })).some((m) => m.includes("NFC"))).toBe(true);
  });

  it("en production, le contenu non relu est bloquant", () => {
    expect(checkContent(content, { production: true }).some((i) => i.level === "error" && i.message.includes("non relu"))).toBe(true);
  });
});

describe("canBuild", () => {
  it("gère les jetons de plusieurs mots et la ponctuation", () => {
    expect(canBuild("Dạ, em cảm ơn anh.", ["anh", "cảm ơn", "Dạ", "em", "chào"])).toBe(true);
    expect(canBuild("Dạ, em cảm ơn anh.", ["anh", "cảm", "Dạ", "em"])).toBe(false);
  });
});

describe("events", () => {
  it("uuidv7 : format RFC 9562 et ordre chronologique", () => {
    const a = uuidv7(new Date("2026-09-14T08:00:00Z"));
    const b = uuidv7(new Date("2026-09-14T08:00:01Z"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it("uuidv7 : monotone dans une même milliseconde", () => {
    const now = new Date("2026-09-14T09:00:00Z");
    const ids = Array.from({ length: 50 }, () => uuidv7(now));
    expect([...ids].sort()).toEqual(ids);
  });

  it("makeEvent horodate et versionne", () => {
    const e = makeEvent("session_started", { sessionId: "s", source: "lesson", plannedSeconds: 300 }, new Date("2026-09-14T08:00:00Z"));
    expect(e).toMatchObject({ type: "session_started", occurredAt: "2026-09-14T08:00:00.000Z", schemaVersion: 1 });
  });
});
