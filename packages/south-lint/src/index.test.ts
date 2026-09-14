import { describe, expect, it } from "vitest";
import cases from "../cases.json" with { type: "json" };
import variants from "../../../content/vi-south/lexical-variants.json" with { type: "json" };
import { createSouthLinter, hasBlocking, type LexicalVariantEntry } from "./index.ts";

const lint = createSouthLinter(variants.entries as LexicalVariantEntry[]);

describe("south-lint — cas partagés avec l'API", () => {
  for (const c of cases) {
    it(c.text, () => {
      expect(lint(c.text).map((f) => f.entryId)).toEqual(c.expect);
    });
  }
});

describe("south-lint", () => {
  it("donne des décalages exacts sur le texte NFC", () => {
    const text = "Đây là bố tôi.";
    const [finding] = lint(text);
    expect(finding).toBeDefined();
    expect(text.slice(finding!.start, finding!.end)).toBe("bố");
    expect(finding!.suggestions).toEqual(["ba"]);
  });

  it("reconnaît un texte en NFD", () => {
    expect(lint("Đây là bố tôi.".normalize("NFD")).map((f) => f.entryId)).toEqual(["lv_papa"]);
  });

  it("distingue erreur bloquante et avertissement", () => {
    expect(hasBlocking(lint("Mẹ ơi!"))).toBe(false);
    expect(hasBlocking(lint("Vâng ạ."))).toBe(true);
  });

  it("ignore les entrées dont la forme est identique au Nord et au Sud", () => {
    expect(lint("Máy bay bay trên trời. Bánh ngon.")).toEqual([]);
  });

  it("repère une forme de plusieurs syllabes", () => {
    const l = createSouthLinter([{ id: "lv_x", south: ["xe hơi"], north: ["ô tô"], severity: "error" }]);
    expect(l("ô tô")).toHaveLength(1);
    expect(l("ô")).toHaveLength(0);
  });
});
