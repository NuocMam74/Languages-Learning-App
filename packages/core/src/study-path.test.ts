import { describe, expect, it } from "vitest";
import { newCard, type SrsCard } from "./srs.ts";
import { nextRung, orderedGuides, studyPath, studyProgress, type RungId } from "./study-path.ts";
import { loadPack } from "./testing/pack.ts";

/**
 * L'ordre de travail de « Réviser » (contrat phase16 §4). Ce qui est vérifié ici : l'échelle ne
 * ment pas sur ce qu'il reste à faire, et elle désigne toujours **un seul** barreau du jour.
 */

const content = loadPack();
const now = new Date("2026-03-01T09:00:00Z");
const ids = (rungs: readonly { id: RungId }[]) => rungs.map((r) => r.id);

const card = (conceptId: string, over: Partial<SrsCard> = {}): SrsCard => ({ ...newCard(conceptId, now), ...over });
const due = (conceptId: string) => card(conceptId, { state: "review", due: "2026-02-01T09:00:00Z", stability: 3, reps: 3 });
const solid = (conceptId: string) => card(conceptId, { state: "review", due: "2027-01-01T09:00:00Z", stability: 400, reps: 9 });

/** Un concept réel de la catégorie demandée. */
const sample = (pos: string): string => [...content.concepts.values()].find((c) => c.pos === pos)?.id ?? "";

describe("l'échelle", () => {
  it("va toujours du plus simple au plus difficile, urgences en tête", () => {
    const path = studyPath(content, { seen: [], cards: [], readGuides: new Set(), now });
    expect(ids(path)).toEqual(["due", "hard", "words", "pronouns", "grammar", "glue", "speaking"]);
  });

  it("montre tous ses barreaux même quand rien n'a encore été vu", () => {
    const path = studyPath(content, { seen: [], cards: [], readGuides: new Set(), now });
    // Un barreau vide dit « pas encore », pas « interdit » : on veut voir le chemin entier.
    expect(path.filter((r) => r.state === "empty").length).toBeGreaterThan(0);
    expect(nextRung(path)?.id).toBe("grammar"); // les fiches se lisent dès le premier jour
  });

  it("annonce ce qui reste à découvrir dans chaque domaine", () => {
    const path = studyPath(content, { seen: [], cards: [], readGuides: new Set(), now });
    const words = path.find((r) => r.id === "words")!;
    expect(words.seen).toBe(0);
    expect(words.toCome).toBeGreaterThan(100);
  });

  it("un mot n'appartient qu'à un seul barreau", () => {
    const seen = [...content.concepts.keys()];
    const path = studyPath(content, { seen, cards: [], readGuides: new Set(), now });
    const lexical = path.filter((r) => r.conceptIds.length > 0).flatMap((r) => r.conceptIds);
    expect(new Set(lexical).size).toBe(lexical.length);
  });
});

describe("le barreau du jour", () => {
  it("les mots dus passent avant tout le reste", () => {
    const noun = sample("noun");
    const path = studyPath(content, { seen: [noun], cards: [due(noun)], readGuides: new Set(content.guides.keys()), now });
    expect(nextRung(path)?.id).toBe("due");
    expect(path.find((r) => r.id === "due")!.todo).toBe(1);
  });

  it("puis ce qui résiste, avant les domaines neufs", () => {
    const noun = sample("noun");
    const fragile = { ...solid(noun), lapses: 2 };
    const path = studyPath(content, { seen: [noun], cards: [fragile], readGuides: new Set(content.guides.keys()), now });
    expect(nextRung(path)?.id).toBe("hard");
  });

  it("un domaine dont tout est solide ne réclame plus rien", () => {
    const noun = sample("noun");
    const path = studyPath(content, { seen: [noun], cards: [solid(noun)], readGuides: new Set(content.guides.keys()), now });
    expect(path.find((r) => r.id === "words")!.state).toBe("done");
    expect(nextRung(path)).toBeNull();
  });

  it("les mots passent avant la grammaire : on nomme avant de construire", () => {
    const noun = sample("noun");
    const path = studyPath(content, { seen: [noun], cards: [], readGuides: new Set(), now });
    expect(nextRung(path)?.id).toBe("words");
  });
});

describe("les fiches conseils", () => {
  it("entrent dans l'échelle à leur place, dans l'ordre que le contenu impose", () => {
    const grammar = orderedGuides(content, ["grammar"]);
    // Les fiches des bases (contrat phase26 §3) ouvrent le rayon : on lit avant de construire.
    expect(grammar[0]!.id).toBe("g_alphabet");
    expect(grammar.map((g) => g.order)).toEqual([...grammar.map((g) => g.order)].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it("une fiche lue ne réclame plus rien", () => {
    const all = new Set(content.guides.keys());
    const path = studyPath(content, { seen: [], cards: [], readGuides: all, now });
    expect(path.find((r) => r.id === "grammar")!.todo).toBe(0);
    expect(path.find((r) => r.id === "grammar")!.state).toBe("done");
  });
});

describe("la progression d'ensemble", () => {
  it("ne compte que les barreaux entamés", () => {
    const empty = studyProgress(studyPath(content, { seen: [], cards: [], readGuides: new Set(), now }));
    expect(empty.done).toBe(0);
    const all = studyProgress(studyPath(content, { seen: [], cards: [], readGuides: new Set(content.guides.keys()), now }));
    expect(all.done).toBe(2); // grammaire et situations : les seuls barreaux lisibles sans leçon
    expect(all.started).toBe(2);
  });
});
