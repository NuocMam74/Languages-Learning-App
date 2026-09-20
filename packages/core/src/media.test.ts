import { describe, expect, it } from "vitest";
import { startLesson } from "./engine.ts";
import { hasNativeAudio, hasPitchRef, isStepPlayable, playableStepIndexes } from "./media.ts";
import { loadPack } from "./testing/pack.ts";
import { SPEAKING_STEP_TYPES, TONAL_STEP_TYPES, type ContentIndex } from "./types.ts";

const content = loadPack();
const concept = content.concepts.get("c_ma_mom")!;
const native = concept.audio.find((a) => a.source === "native")!;

describe("disponibilité des médias (contrat phase5 §1)", () => {
  it("audio natif et courbe : seulement si le fichier est dans l'index", () => {
    expect(hasNativeAudio(concept, new Set())).toBe(false);
    expect(hasNativeAudio(concept, new Set([native.src]))).toBe(true);
    expect(hasNativeAudio({ audio: [{ ...native, source: "tts" }] }, new Set([native.src]))).toBe(false);
    expect(hasPitchRef({ pitch: "pitch/x.json" }, new Set(["pitch/x.json"]))).toBe(true);
    expect(hasPitchRef({ pitchRef: "pitch/y.json", pitch: "pitch/x.json" }, new Set(["pitch/x.json"]))).toBe(false);
    expect(hasPitchRef({}, new Set())).toBe(false);
  });

  it("séance : étapes tonales sans audio natif retirées (sauf repli de synthèse), indices d'origine conservés", () => {
    const silent: ContentIndex = { ...content, mediaIndex: new Set() };
    const lesson = content.lessons.get("vi-south.u01.l01")!;
    const tonal = lesson.steps.flatMap((s, i) => (TONAL_STEP_TYPES.has(s.type) && !SPEAKING_STEP_TYPES.has(s.type) ? [i] : []));
    expect(tonal.length).toBeGreaterThan(0);
    // Production orale : jamais jouée, donc jamais comptée dans « toutes les étapes ».
    const spoken = lesson.steps.filter((s) => SPEAKING_STEP_TYPES.has(s.type)).length;
    const playable = playableStepIndexes(silent, lesson);
    expect(playable.some((i) => tonal.includes(i))).toBe(false);
    expect(playableStepIndexes(silent, lesson, { toneFallback: true })).toHaveLength(lesson.steps.length - spoken);
    expect(playableStepIndexes(content, lesson)).toHaveLength(lesson.steps.length - spoken);
    const run = startLesson(lesson, "s", new Date(), playable);
    expect(run.queue.map((q) => q.stepIndex)).toEqual(playable);
  });

  it("production orale : retirée de la séance, quels que soient les médias", () => {
    const lesson = content.lessons.get("vi-south.u01.l01")!;
    const speak = lesson.steps.find((s) => s.type === "speak_repeat");
    expect(speak).toBeDefined();
    // Ni avec tous les médias, ni avec le repli de synthèse : l'app ne fait plus répéter à voix haute.
    expect(isStepPlayable(content, speak!)).toBe(false);
    expect(isStepPlayable(content, speak!, { toneFallback: true })).toBe(false);
    expect(playableStepIndexes(content, lesson).some((i) => SPEAKING_STEP_TYPES.has(lesson.steps[i]!.type))).toBe(false);
  });
});
