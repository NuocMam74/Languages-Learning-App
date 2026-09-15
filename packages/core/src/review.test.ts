import { describe, expect, it } from "vitest";
import { evaluate } from "./engine.ts";
import { buildReviewExercise, reviewFormats } from "./review.ts";
import { loadPack } from "./testing/pack.ts";
import { normalizeAnswer, stripTones } from "./text.ts";
import type { Concept, ContentIndex } from "./types.ts";

const content = loadPack();

function withConcepts(base: ContentIndex, patch: (c: Concept) => Concept): ContentIndex {
  return { ...base, concepts: new Map([...base.concepts].map(([id, c]) => [id, patch(c)])) };
}

describe("buildReviewExercise", () => {
  it("construit un exercice jouable pour chaque concept du pack, bonne réponse incluse", () => {
    for (const id of content.concepts.keys()) {
      const ex = buildReviewExercise(content, id, "seed");
      expect(ex.conceptIds).toEqual([id]);
      if (!("answerId" in ex)) throw new Error(`pas un QCM : ${ex.type}`);
      expect(ex.options.map((o) => o.id)).toContain(ex.answerId);
      expect(evaluate(ex, { kind: "choice", optionId: ex.answerId })).toMatchObject({ correct: true, graded: true });
    }
  }, 60_000); // parcourt tout le corpus : le délai suit sa taille

  it("est déterministe pour une même graine (reprise exacte)", () => {
    expect(buildReviewExercise(content, "c_ma_mom", "s1")).toEqual(buildReviewExercise(content, "c_ma_mom", "s1"));
  });

  it("listen_pick_text : les variantes tonales servent de piège", () => {
    const ex = buildReviewExercise(content, "c_ma_mom", "x", "listen_pick_text");
    if (ex.type !== "listen_pick_text") throw new Error(ex.type);
    const texts = ex.options.map((o) => o.text ?? "");
    expect(texts).toContain("má");
    expect(texts.length).toBe(4);
    for (const t of texts) expect(stripTones(normalizeAnswer(t))).toBe("ma");
    expect(new Set(texts.map(normalizeAnswer)).size).toBe(texts.length);
  });

  it("privilégie les concepts connus comme distracteurs", () => {
    const ex = buildReviewExercise(content, "c_toi", "k", "listen_pick_text", { known: ["c_anh", "c_chi", "c_em"] });
    if (ex.type !== "listen_pick_text") throw new Error(ex.type);
    const texts = ex.options.map((o) => o.text ?? "");
    expect(texts).toContain("tôi");
    // Chaque distracteur est soit un concept connu, soit un voisin tonal (même base sans ton) :
    // le corpus grandit, le test ne doit pas figer une liste exacte.
    const known = new Set(["anh", "chị", "em"]);
    for (const text of texts.filter((t) => t !== "tôi")) {
      expect(known.has(text) || stripTones(text) === stripTones("tôi")).toBe(true);
    }
    expect(texts.filter((t) => known.has(t)).length).toBeGreaterThanOrEqual(2);
  });

  it("tone_identify seulement pour un mot d'une syllabe", () => {
    expect(reviewFormats(content, "c_ma_tomb")).toContain("tone_identify");
    expect(reviewFormats(content, "c_cam_on")).not.toContain("tone_identify");
    expect(reviewFormats(content, "s_day_la")).not.toContain("tone_identify");
    const ex = buildReviewExercise(content, "c_ma_tomb", "x", "tone_identify");
    if (ex.type !== "tone_identify") throw new Error(ex.type);
    expect(ex.options.find((o) => o.id === ex.answerId)?.tones).toEqual(["hoi", "nga"]);
  });

  it("jamais de tone_identify sur de la synthèse vocale, sauf autorisation explicite", () => {
    const ttsOnly = withConcepts(content, (c) => ({ ...c, audio: c.audio.map((a) => ({ ...a, source: "tts" as const })) }));
    expect(reviewFormats(ttsOnly, "c_ma_mom")).not.toContain("tone_identify");
    for (let i = 0; i < 20; i++) expect(buildReviewExercise(ttsOnly, "c_ma_mom", `s${i}`).type).not.toBe("tone_identify");
    expect(reviewFormats(ttsOnly, "c_ma_mom", { allowTtsTone: true })).toContain("tone_identify");
  });

  it("listen_pick_image quand les images existent", () => {
    expect(reviewFormats(content, "c_ba")).toContain("listen_pick_image");
    expect(reviewFormats(content, "c_cam_on")).not.toContain("listen_pick_image");
    const ex = buildReviewExercise(content, "c_anh", "x", "listen_pick_image");
    if (ex.type !== "listen_pick_image") throw new Error(ex.type);
    expect(ex.options.every((o) => o.image)).toBe(true);
    expect(new Set(ex.options.map((o) => o.image)).size).toBe(ex.options.length);
  });

  it("varie les formats d'une graine à l'autre", () => {
    const types = new Set(Array.from({ length: 30 }, (_, i) => buildReviewExercise(content, "c_ba", `v${i}`).type));
    expect(types.size).toBeGreaterThanOrEqual(2);
  });

  it("indice de format inapplicable : repli sur un format possible", () => {
    expect(buildReviewExercise(content, "c_cam_on", "x", "tone_identify").type).toBe("listen_pick_text");
  });

  it("stepIndex reporté", () => {
    expect(buildReviewExercise(content, "c_ba", "x", undefined, { stepIndex: 7 }).stepIndex).toBe(7);
  });
});
