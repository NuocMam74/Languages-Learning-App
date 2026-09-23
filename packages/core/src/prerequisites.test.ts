import { describe, expect, it } from "vitest";
import {
  briefingParts,
  conceptForms,
  isBriefingEmpty,
  lessonBriefing,
  lessonDemands,
  lexicalKey,
  lexiconBefore,
  lexiconOf,
  stepDemands,
  unmetDemands,
} from "./prerequisites.ts";
import { loadPack } from "./testing/pack.ts";
import type { Lesson, LessonStep } from "./types.ts";

/**
 * Prérequis d'une leçon (contrat phase16 §1). Ce qui est vérifié ici, c'est la distinction qui
 * fonde tout le reste : **reconnaître n'est pas produire**. Un leurre n'a pas à être connu ; un
 * jeton de la phrase cible, si.
 */

const content = loadPack();
const lesson = (steps: LessonStep[], introduce: string[] = []): Lesson => ({
  id: "t.l01",
  unit: "vi-south.u01",
  title: { fr: "t" },
  goal: { fr: "t" },
  estimatedMinutes: 5,
  prerequisites: [],
  concepts: introduce,
  steps,
  review: { srsIntroduce: introduce },
  reviewed: true,
});

describe("ce qu'une étape fait produire", () => {
  it("les leurres ne sont pas des prérequis", () => {
    // listen_pick_text : on reconnaît le bon parmi des formes proches, c'est l'exercice même.
    expect(stepDemands({ type: "listen_pick_text", concept: "c_chao", distractors: ["chảo", "cháo"] })).toEqual({
      concepts: [],
      forms: [],
    });
    // build_sentence : la cible, pas les jetons — un jeton en trop est un leurre comme un autre.
    expect(
      stepDemands({ type: "build_sentence", target: "Chào anh.", tokens: ["Chào", "anh", "em"], translation: { fr: "Bonjour." } }),
    ).toEqual({ concepts: [], forms: ["Chào anh."] });
  });

  it("une carte culture et une paire minimale n'exigent rien", () => {
    expect(stepDemands({ type: "culture_card", ref: "cc_tones_south" }).forms).toHaveLength(0);
    expect(stepDemands({ type: "tone_minimal_pair", pair: ["ma", "má"] }).concepts).toHaveLength(0);
  });

  it("une leçon dédoublonne ses exigences", () => {
    const steps: LessonStep[] = [
      { type: "match_pairs", concepts: ["c_chao", "c_anh"] },
      { type: "match_pairs", concepts: ["c_chao"] },
    ];
    expect(lessonDemands(lesson(steps)).concepts).toEqual(["c_chao", "c_anh"]);
  });
});

describe("couverture lexicale", () => {
  it("un mot composé ouvre aussi ses syllabes", () => {
    expect(conceptForms({ vi: "cảm ơn" })).toEqual(["cảm ơn", "cảm", "ơn"]);
    expect(conceptForms({ vi: "chào" })).toEqual(["chào"]);
  });

  it("les tons comptent : ma et má ne sont pas le même mot", () => {
    expect(lexicalKey("Má!")).toBe("má");
    expect(lexicalKey("Má!")).not.toBe(lexicalKey("Ma."));
  });

  it("une phrase faite de mots connus est couverte sans être connue elle-même", () => {
    const known = lexiconOf(content, ["c_chao", "c_anh"]);
    const step: LessonStep = { type: "build_sentence", target: "Chào anh.", tokens: ["Chào", "anh"], translation: { fr: "Bonjour." } };
    expect(unmetDemands(content, lesson([step]), known)).toEqual([]);
  });

  it("un mot jamais présenté est signalé, avec le concept du pack qui le porte", () => {
    const known = lexiconOf(content, ["c_chao"]);
    const step: LessonStep = { type: "build_sentence", target: "Chào em.", tokens: ["Chào", "em"], translation: { fr: "Bonjour." } };
    const unmet = unmetDemands(content, lesson([step]), known);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toMatchObject({ kind: "form", what: "em", step: "build_sentence" });
    // Le concept dont la forme **est** le mot passe devant ceux qui ne font que le contenir.
    expect(unmet[0]!.candidates[0]).toBe("c_em");
  });

  it("les noms propres et les nombres ne sont pas du vocabulaire à apprendre", () => {
    const known = lexiconOf(content, ["c_chao"]);
    const step: LessonStep = {
      type: "build_sentence",
      target: "Chào Lan.",
      tokens: ["Chào", "Lan"],
      translation: { fr: "Bonjour Lan." },
    };
    expect(unmetDemands(content, lesson([step]), known)).toEqual([]);
  });

  it("une majuscule en tête de phrase reste un mot ordinaire", () => {
    // Sans cette règle, le premier mot de chaque phrase passerait pour un nom propre.
    const step: LessonStep = { type: "build_sentence", target: "Em chào.", tokens: ["Em", "chào"], translation: { fr: "Bonjour." } };
    const unmet = unmetDemands(content, lesson([step]), lexiconOf(content, ["c_chao"]));
    expect(unmet.map((u) => u.what)).toEqual(["em"]);
  });
});

describe("le lexique du cursus", () => {
  it("s'accumule dans l'ordre des unités", () => {
    const first = content.curriculum.units[0]!.lessons[0]!;
    // Rien n'est acquis avant la toute première leçon.
    expect(lexiconBefore(content, first).concepts.size).toBe(0);
    const later = content.curriculum.units[5]!.lessons[0]!;
    expect(lexiconBefore(content, later).concepts.size).toBeGreaterThan(50);
  });

  it("plus aucune leçon ne fait produire un mot que rien n'a présenté", () => {
    // C'est le constat qui a motivé ce contrat, devenu une garantie : 55 leçons sur 194 étaient
    // dans ce cas. Les mots manquants ont été introduits dans une leçon enseignante amont, et les
    // quinze que le pack ne portait pas ont été écrits. `checkContent` tient la même garde en CI.
    const debt: string[] = [];
    for (const unit of content.curriculum.units) {
      for (const id of unit.lessons) {
        const l = content.lessons.get(id);
        if (!l) continue;
        const known = lexiconOf(content, [...lexiconBefore(content, id).concepts, ...l.review.srsIntroduce]);
        const unmet = unmetDemands(content, l, known);
        if (unmet.length > 0) debt.push(`${id} : ${unmet.map((u) => u.what).join(", ")}`);
      }
    }
    expect(debt).toEqual([]);
  });
});

describe("la fiche de préparation", () => {
  const known = new Set<string>();

  it("présente les mots neufs, et rappelle ceux que les exercices réutilisent", () => {
    const real = content.lessons.get("vi-south.u03.l03")!;
    const briefing = lessonBriefing(content, real, { known });
    expect(briefing.discover).toEqual(real.review.srsIntroduce);
    // Rien ne doit figurer deux fois : un mot présenté n'est pas aussi rappelé.
    expect(briefing.recall.filter((id) => briefing.discover.includes(id))).toEqual([]);
  });

  it("montre la phrase modèle quand un jeton échappe au corpus", () => {
    // Le corpus ne laisse plus un seul mot orphelin (voir plus haut) : on éprouve donc le
    // mécanisme sur une forme qui n'existe nulle part, comme le serait une phrase ajoutée demain
    // avec un mot pas encore écrit.
    const step: LessonStep = {
      type: "build_sentence",
      target: "Chào bẹp.",
      tokens: ["Chào", "bẹp"],
      translation: { fr: "Bonjour bẹp." },
    };
    const briefing = lessonBriefing(content, lesson([step]), { known: new Set(["c_chao"]) });
    // Plutôt que de laisser assembler à l'aveugle, la fiche donne la phrase entière, traduite.
    expect(briefing.models).toEqual([{ vi: "Chào bẹp.", translation: { fr: "Bonjour bẹp." } }]);
  });

  it("n'explique un format d'exercice que la première fois", () => {
    const step: LessonStep = { type: "match_pairs", concepts: ["c_chao"] };
    expect(lessonBriefing(content, lesson([step], ["c_chao"]), { known }).formats).toEqual(["match_pairs"]);
    const seenFormats = new Set<LessonStep["type"]>(["match_pairs"]);
    expect(lessonBriefing(content, lesson([step], ["c_chao"]), { known, seenFormats }).formats).toEqual([]);
  });

  it("un choix multiple n'a pas besoin qu'on explique sa consigne", () => {
    const step: LessonStep = { type: "listen_pick_text", concept: "c_chao", distractors: ["cháo"] };
    expect(lessonBriefing(content, lesson([step], ["c_chao"]), { known }).formats).toEqual([]);
  });

  it("une leçon dont tout est connu n'a rien à préparer", () => {
    const real = content.lessons.get("vi-south.u01.l01")!;
    const everything = new Set(content.concepts.keys());
    const briefing = lessonBriefing(content, real, {
      known: everything,
      seenFormats: new Set(real.steps.map((s) => s.type)),
      readGuides: new Set(content.guides.keys()),
    });
    expect(isBriefingEmpty(briefing)).toBe(true);
    expect(briefingParts(briefing)).toBe(0);
  });

  it("chaque volet non vide compte pour une consultation", () => {
    const real = content.lessons.get("vi-south.u03.l03")!;
    const briefing = lessonBriefing(content, real, { known });
    expect(briefingParts(briefing)).toBeGreaterThan(0);
    expect(briefingParts(briefing)).toBe(
      (briefing.discover.length > 0 ? 1 : 0) +
        (briefing.recall.length > 0 ? 1 : 0) +
        (briefing.models.length > 0 ? 1 : 0) +
        (briefing.cited.length > 0 ? 1 : 0) +
        briefing.guides.length +
        briefing.formats.length,
    );
  });

  it("un test d'unité ne reçoit jamais de fiche : on ne distribue pas l'antisèche avec l'épreuve", () => {
    const test = [...content.lessons.values()].find((l) => l.kind === "unit_test")!;
    expect(isBriefingEmpty(lessonBriefing(content, test, { known }))).toBe(true);
  });

  it("aucune leçon du corpus ne laisse un mot non préparé", () => {
    // La garantie centrale du contrat : quel que soit l'état de l'apprenant, ce que les exercices
    // font produire lui a été montré — par la fiche pour une leçon enseignante, par le cursus
    // amont pour un test d'unité, qui n'en reçoit jamais (on ne distribue pas l'antisèche avec
    // l'épreuve).
    const unprepared: string[] = [];
    for (const unit of content.curriculum.units) {
      for (const id of unit.lessons) {
        const l = content.lessons.get(id);
        if (!l) continue;
        const before = lexiconBefore(content, id);
        const briefing = lessonBriefing(content, l, { known: before.concepts });
        const after = lexiconOf(content, [...before.concepts, ...briefing.discover, ...briefing.recall]);
        const left = unmetDemands(content, l, after);
        if (left.length > 0) unprepared.push(`${id} (${l.kind ?? "lesson"}) : ${left.map((u) => u.what).join(", ")}`);
      }
    }
    expect(unprepared).toEqual([]);
  });
});
