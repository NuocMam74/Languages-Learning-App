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

describe("formats riches (contrat phase6 §5)", () => {
  const rich = { richFormats: true } as const;

  it("désactivés par défaut : rien ne change pour les appelants existants", () => {
    expect(reviewFormats(content, "c_ma_mom")).not.toContain("fill_gap");
    expect(reviewFormats(content, "c_ma_mom")).not.toContain("match_pairs");
    expect(reviewFormats(content, "c_ma_mom")).not.toContain("build_sentence");
    for (let i = 0; i < 30; i++) {
      expect(["fill_gap", "match_pairs", "build_sentence"]).not.toContain(buildReviewExercise(content, "c_ma_mom", `s${i}`).type);
    }
  });

  it("fill_gap : le concept retiré d'une de ses phrases d'exemple", () => {
    expect(reviewFormats(content, "c_ma_mom", rich)).toContain("fill_gap");
    const ex = buildReviewExercise(content, "c_ma_mom", "x", "fill_gap", rich);
    if (ex.type !== "fill_gap") throw new Error(ex.type);
    expect(ex.text).toBe("Đây là ___ tôi.");
    expect(ex.translation?.fr).toBe("Voici ma mère.");
    expect(ex.options.find((o) => o.id === ex.answerId)?.text).toBe("má");
    expect(ex.options.length).toBeGreaterThanOrEqual(2);
    expect(ex.conceptIds).toEqual(["c_ma_mom"]);
    expect(evaluate(ex, { kind: "choice", optionId: ex.answerId })).toMatchObject({ correct: true, graded: true });
  });

  it("fill_gap indisponible sans phrase d'exemple contenant la forme", () => {
    const noExamples = withConcepts(content, (c) => {
      const { examples: _drop, ...rest } = c;
      return rest;
    });
    expect(reviewFormats(noExamples, "c_ma_mom", rich)).not.toContain("fill_gap");
  });

  it("match_pairs : la cible et deux voisins, glosses et formes distinctes", () => {
    expect(reviewFormats(content, "c_ma_mom", rich)).toContain("match_pairs");
    const ex = buildReviewExercise(content, "c_ma_mom", "x", "match_pairs", rich);
    if (ex.type !== "match_pairs") throw new Error(ex.type);
    expect(ex.mode).toBe("text_gloss");
    expect(ex.left).toHaveLength(3);
    expect(ex.right).toHaveLength(3);
    expect(ex.conceptIds[0]).toBe("c_ma_mom");
    expect(new Set(ex.right.map((o) => o.label?.fr)).size).toBe(3);
    expect(evaluate(ex, { kind: "pairs", pairs: ex.answer })).toMatchObject({ correct: true, graded: true });
  });

  it("build_sentence : les mots d'une phrase d'exemple à remettre dans l'ordre", () => {
    expect(reviewFormats(content, "c_ma_mom", rich)).toContain("build_sentence");
    const ex = buildReviewExercise(content, "c_ma_mom", "x", "build_sentence", rich);
    if (ex.type !== "build_sentence") throw new Error(ex.type);
    // La ponctuation ne devient pas un jeton : on travaille l'ordre des mots (contrat phase9 §6).
    expect(ex.tokens.map((token) => token.text)).not.toContain("tôi.");
    for (const token of ex.tokens) expect(token.text).not.toMatch(/[.,!?;:]/);
    // Les jetons remis dans l'ordre reconstituent exactement la cible.
    expect(ex.target.split(" ").sort()).toEqual(ex.tokens.map((token) => token.text ?? "").sort());
    expect(ex.translation.fr).toBe("Voici ma mère.");
    expect(ex.conceptIds).toEqual(["c_ma_mom"]);
    const ordered = ex.target.split(" ").map((word) => ex.tokens.find((token) => token.text === word)!.id);
    expect(evaluate(ex, { kind: "tokens", optionIds: ordered })).toMatchObject({ correct: true, graded: true });
  });

  it("build_sentence : jamais proposé sans phrase d'exemple de la bonne longueur", () => {
    const tooShort = withConcepts(content, (c) => (c.id === "c_ma_mom" ? { ...c, examples: [{ vi: "Má tôi", fr: "Ma mère" }] } : c));
    expect(reviewFormats(tooShort, "c_ma_mom", rich)).not.toContain("build_sentence");
    const tooLong = withConcepts(content, (c) =>
      c.id === "c_ma_mom" ? { ...c, examples: [{ vi: "Đây là má tôi và đây là ba tôi ở Cần Thơ", fr: "…" }] } : c,
    );
    expect(reviewFormats(tooLong, "c_ma_mom", rich)).not.toContain("build_sentence");
  });

  it("match_pairs impossible quand le pack n'a pas assez de concepts du même type", () => {
    const tiny: ContentIndex = { ...content, concepts: new Map([["c_ma_mom", content.concepts.get("c_ma_mom")!]]) };
    expect(reviewFormats(tiny, "c_ma_mom", rich)).not.toContain("match_pairs");
  });

  it("déterministe pour une même graine", () => {
    expect(buildReviewExercise(content, "c_ma_mom", "s", "match_pairs", rich)).toEqual(buildReviewExercise(content, "c_ma_mom", "s", "match_pairs", rich));
  });
});
