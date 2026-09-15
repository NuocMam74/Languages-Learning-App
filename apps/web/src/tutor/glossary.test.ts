import { describe, expect, it } from "vitest";
import { looksVietnamese } from "./ChatView.tsx";
import { glossKey, segmentSentence } from "./glossary.ts";
import { splitSentences } from "./use-conversation.ts";

describe("gloses des phrases de Cô Mai", () => {
  const glossary = new Map([
    [glossKey("cảm ơn"), { fr: "merci" }],
    [glossKey("khỏe"), { fr: "en forme" }],
    [glossKey("nghen"), { fr: "hein" }],
  ]);

  it("repère les groupes les plus longs et laisse la ponctuation hors du mot", () => {
    const segments = segmentSentence("Em khỏe, cảm ơn cô nghen!", glossary);
    expect(segments.filter((s) => s.key).map((s) => s.text)).toEqual(["khỏe", "cảm ơn", "nghen"]);
    expect(segments.map((s) => s.text).join("")).toBe("Em khỏe, cảm ơn cô nghen!");
  });

  it("insensible à la casse et à la normalisation Unicode", () => {
    const decomposed = "Cảm ơn".normalize("NFD");
    expect(segmentSentence(decomposed, glossary)[0]).toEqual({ text: "Cảm ơn", key: "cảm ơn" });
  });

  it("consulte les glossaires dans l'ordre (serveur puis pack)", () => {
    const server = new Map([[glossKey("cô"), { fr: "madame (enseignante)" }]]);
    expect(segmentSentence("cô", server, glossary)).toEqual([{ text: "cô", key: "cô" }]);
  });
});

describe("découpage et détection", () => {
  it("découpe un texte en phrases courtes", () => {
    expect(splitSentences("Chào em! Em khỏe không? Dạ.")).toEqual(["Chào em!", "Em khỏe không?", "Dạ."]);
    expect(splitSentences("Sans ponctuation")).toEqual(["Sans ponctuation"]);
  });

  it("distingue le vietnamien du français accentué", () => {
    expect(looksVietnamese("Dạ, em khỏe.")).toBe(true);
    expect(looksVietnamese("Très bien, on continue à côté.")).toBe(false);
  });
});
