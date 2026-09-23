import { describe, expect, it } from "vitest";
import { citedWords, isVietnameseWord, lessonBriefing, lexiconBefore, lexiconOf, unitGuides, unmetExposure, type KnownLexicon } from "./prerequisites.ts";
import { loadPack } from "./testing/pack.ts";
import type { Lesson, LessonStep } from "./types.ts";

/**
 * Ce qu'une leçon fait **voir** (contrat phase26 §4). La garde des prérequis ne regardait que ce
 * qu'on produit ; dès le niveau 2, on choisissait « chào » parmi « giả sử » et « đối diện ». Ici :
 * on ne montre pas un mot qu'on n'a pas appris — sauf les variantes tonales de la réponse, qui sont
 * l'exercice même.
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
const knowing = (ids: string[]): KnownLexicon => lexiconOf(content, ids);

describe("repérer un mot vietnamien dans un texte français", () => {
  it("les graphies impossibles en français, et elles seules", () => {
    for (const word of ["hồng", "cháo", "đi", "mả", "ơi", "ư", "chị"]) expect(isVietnameseWord(word), word).toBe(true);
    for (const word of ["là", "à", "ma", "été", "fête", "où", "maïs"]) expect(isVietnameseWord(word), word).toBe(false);
  });

  it("ni les prononciations figurées entre guillemets, ni les noms propres", () => {
    expect(citedWords("On écrit bạn, on entend « bạng ».")).toEqual(["bạn"]);
    expect(citedWords("Tôi sống ở Sài Gòn : une grande ville.")).toEqual(["sống", "ở"]);
  });
});

describe("les leurres sont des mots appris", () => {
  it("un leurre inconnu est signalé, avec le concept qui le présenterait", () => {
    const step: LessonStep = { type: "listen_pick_text", concept: "c_chao", distractors: ["nước mía"] };
    const unmet = unmetExposure(content, lesson([step], ["c_chao"]), knowing(["c_chao"]));
    expect(unmet.map((u) => [u.kind, u.what])).toEqual([["decoy", "nước"], ["decoy", "mía"]]);
  });

  it("une variante tonale de la réponse est l'exercice même : on n'a pas à la connaître", () => {
    const step: LessonStep = { type: "listen_pick_text", concept: "c_chao", distractors: ["cháo", "chạo"] };
    expect(unmetExposure(content, lesson([step], ["c_chao"]), knowing(["c_chao"]))).toEqual([]);
  });

  it("le reste d'une phrase à trous se lit : il doit être connu", () => {
    const step: LessonStep = { type: "fill_gap", text: "___ anh, đối diện.", answer: "chào", options: ["chào", "anh"] };
    const unmet = unmetExposure(content, lesson([step], ["c_chao", "c_anh"]), knowing(["c_chao", "c_anh"]));
    expect(unmet.map((u) => u.what)).toEqual(["đối", "diện"]);
  });
});

describe("les mots cités par un conseil", () => {
  it("un mot cité qui a un concept est présenté par la fiche, avec sa traduction", () => {
    const step: LessonStep = { type: "listen_pick_text", concept: "c_chao", distractors: ["cháo"], explain: { fr: "chào, pas gió." } };
    const l = lesson([step], ["c_chao"]);
    expect(unmetExposure(content, l, knowing(["c_chao"]))).toEqual([]);
    expect(lessonBriefing(content, l, { known: new Set() }).cited).toEqual(["c_gio_wind"]);
  });

  it("une expression citée entière est traduite par l'expression", () => {
    const step: LessonStep = { type: "listen_pick_text", concept: "c_chao", distractors: ["cháo"], explain: { fr: "thời tiết : la météo." } };
    expect(lessonBriefing(content, lesson([step], ["c_chao"]), { known: new Set() }).cited).toEqual(["s_thoi_tiet"]);
  });

  it("une forme du Nord mise en regard du Sud n'est pas à apprendre", () => {
    const step: LessonStep = { type: "spot_the_south", variant: "lv_papa", explain: { fr: "Au Sud, papa se dit ba ; bố est la forme du Nord." } };
    expect(unmetExposure(content, lesson([step]), knowing(["c_ba"]))).toEqual([]);
  });

  it("un mot cité que rien ne traduit est signalé : il faut l'écrire ou le retirer", () => {
    const step: LessonStep = { type: "listen_pick_text", concept: "c_chao", distractors: ["cháo"], explain: { fr: "chào, pas bẹp." } };
    expect(unmetExposure(content, lesson([step], ["c_chao"]), knowing(["c_chao"])).map((u) => [u.kind, u.what])).toEqual([["cited", "bẹp"]]);
  });
});

describe("le corpus", () => {
  it("aucun niveau ne montre un mot que rien n'a présenté", () => {
    const shown: string[] = [];
    for (const unit of content.curriculum.units) {
      for (const id of unit.lessons) {
        const l = content.lessons.get(id)!;
        const before = lexiconBefore(content, id);
        const own = lexiconOf(content, l.review.srsIntroduce);
        const known = { concepts: new Set([...before.concepts, ...own.concepts]), forms: new Set([...before.forms, ...own.forms]) };
        for (const u of unmetExposure(content, l, known)) shown.push(`${id} : ${u.kind} ${u.what}`);
      }
    }
    expect(shown).toEqual([]);
  });

  it("les bases ouvrent le parcours, et chaque niveau des bases a sa fiche avant les exercices", () => {
    const first = content.curriculum.units[0]!;
    expect(first.id).toBe("vi-south.u00");
    expect(first.requires).toEqual([]);
    expect(content.curriculum.units.find((u) => u.id === "vi-south.u01")!.requires).toEqual(["vi-south.u00"]);
    const guides = (id: string) => unitGuides(content, content.lessons.get(id)!);
    expect(guides("vi-south.u00.l01")).toEqual(["g_alphabet"]);
    expect(guides("vi-south.u00.l03")).toEqual(["g_syllabe_tons"]);
    expect(guides("vi-south.u00.l04")).toEqual(["g_pronoms_sujets"]);
    expect(guides("vi-south.u00.l06")).toEqual(["g_nombres"]);
    // La fiche du niveau passe dans la préparation, avant ses mots.
    expect(lessonBriefing(content, content.lessons.get("vi-south.u00.l01")!, { known: new Set() }).guides).toEqual(["g_alphabet"]);
  });
});
