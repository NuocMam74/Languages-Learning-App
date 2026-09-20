import { describe, expect, it } from "vitest";
import { checkContent } from "./content-checks.ts";
import { practiceCounts, practicedConcepts, unpracticedConcepts } from "./practice.ts";
import { loadPack } from "./testing/pack.ts";
import type { ContentIndex, Lesson, LessonStep } from "./types.ts";

/**
 * Mise en pratique d'une leçon (contrat phase20 §1). Ce qui est vérifié ici, c'est la distinction
 * qui fonde la garde : **montrer n'est pas faire pratiquer**. Une paire minimale montre cinq tons ;
 * seul l'exercice dont un mot est la réponse le met en pratique — et seulement s'il reste dans la
 * séance une fois les étapes sans enregistrement retirées.
 */

const content = loadPack();

const lesson = (steps: LessonStep[], concepts: string[]): Lesson => ({
  id: "vi-south.u01.l01",
  unit: "vi-south.u01",
  title: { fr: "t" },
  goal: { fr: "t" },
  estimatedMinutes: 5,
  prerequisites: [],
  concepts,
  steps,
  review: { srsIntroduce: concepts },
  reviewed: true,
});

describe("ce qu'une étape met en pratique", () => {
  it("le concept dont on choisit la forme, pas les leurres", () => {
    const step: LessonStep = { type: "listen_pick_text", concept: "c_ma_mom", distractors: ["ma", "mà"] };
    expect(practicedConcepts(content, lesson([step], ["c_ma_mom", "c_ma_ghost"]), step)).toEqual(["c_ma_mom"]);
  });

  it("une carte culture ne met rien en pratique : elle n'interroge aucun mot", () => {
    const step: LessonStep = { type: "culture_card", ref: "cc_tones_south" };
    expect(practicedConcepts(content, lesson([step], ["c_ma_mom"]), step)).toEqual([]);
  });

  it("une paire minimale compte pour tous ses audioConcepts : la cible y est tirée au sort", () => {
    const step: LessonStep = { type: "tone_minimal_pair", pair: ["ma", "má"], audioConcepts: ["c_ma_ghost", "c_ma_mom"] };
    expect(practicedConcepts(content, lesson([step], []), step)).toEqual(["c_ma_ghost", "c_ma_mom"]);
  });

  it("une phrase à construire compte pour les mots qu'elle fait écrire, comme suites entières", () => {
    // « ba » est dans la cible ; il ne doit pas être attrapé à l'intérieur d'un autre mot.
    const step: LessonStep = {
      type: "build_sentence",
      target: "Đây là ba tôi.",
      tokens: ["Đây", "là", "ba", "tôi"],
      translation: { fr: "Voici mon père." },
    };
    const practiced = practicedConcepts(content, lesson([step], ["c_ba", "c_ban_table"]), step);
    expect(practiced).toContain("c_ba");
    expect(practiced).not.toContain("c_ban_table");
  });

  it("une réserve implicite de mini-jeu reprend toute la leçon", () => {
    const step: LessonStep = { type: "game", game: "bua_com", conceptPool: "lesson" };
    expect(practicedConcepts(content, lesson([step], ["c_ma_mom", "c_ma_ghost"]), step)).toEqual(["c_ma_mom", "c_ma_ghost"]);
  });
});

describe("décompte sans enregistrement", () => {
  const steps: LessonStep[] = [
    { type: "tone_identify", concept: "c_ma_ghost" },
    { type: "speak_repeat", concept: "c_ma_but" },
    { type: "listen_pick_text", concept: "c_ma_mom", distractors: ["ma", "mà"] },
  ];
  const l = lesson(steps, ["c_ma_ghost", "c_ma_but", "c_ma_mom"]);

  it("un exercice de tons sans voix native est retiré de la séance : il ne met rien en pratique", () => {
    expect(unpracticedConcepts(content, l)).toEqual(["c_ma_ghost", "c_ma_but"]);
    expect(practiceCounts(content, l).get("c_ma_mom")).toBe(1);
  });

  it("la production orale ne compte jamais, même enregistrements présents : l'app n'écoute plus", () => {
    // `media: null` = tout est présent ; seul `speak_repeat` reste écarté.
    expect(unpracticedConcepts(content, l, { media: null })).toEqual(["c_ma_but"]);
  });
});

describe("garde de contenu", () => {
  it("le pack livré met en pratique tout ce qu'il montre", () => {
    const missing = checkContent(content).filter((i) => i.message.startsWith("Jamais mis en pratique"));
    expect(missing).toEqual([]);
  });

  it("un concept montré et jamais demandé est une erreur, avec son identifiant dans le message", () => {
    const broken: ContentIndex = {
      ...content,
      lessons: new Map([...content.lessons, ["vi-south.u01.l01", lesson([{ type: "culture_card", ref: "cc_tones_south" }], ["c_ma_mom"])]]),
    };
    const issues = checkContent(broken).filter((i) => i.message.startsWith("Jamais mis en pratique"));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.level).toBe("error");
    expect(issues[0]?.message).toContain("c_ma_mom");
  });
});
