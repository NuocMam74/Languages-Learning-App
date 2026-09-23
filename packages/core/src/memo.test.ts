import { describe, expect, it } from "vitest";
import { ESSENTIAL_RULES, ESSENTIAL_WORDS, isMemoEmpty, memoEssentials, memoSheet, unitMemoSheet } from "./memo.ts";
import { loadPack } from "./testing/pack.ts";
import type { LessonId } from "./types.ts";

/**
 * Fiches mémoire (contrat phase23 §4), vérifiées sur le contenu réel : une fiche qui se construit
 * en test sur un pack de démonstration ne dit rien de celles qu'un apprenant emportera.
 *
 * Ce qui est tenu ici tient en une phrase : **la fiche ne dit que ce que le niveau a enseigné**,
 * et elle le dit pour tous les niveaux, pas pour un échantillon choisi.
 */

const content = loadPack();
const lessons = [...content.lessons.values()];

describe("fiche d'un niveau", () => {
  it("porte le titre du niveau, son objectif et son thème", () => {
    const lesson = lessons[0]!;
    const sheet = memoSheet(content, lesson.id)!;
    expect(sheet.title).toEqual(lesson.title);
    expect(sheet.goal).toEqual(lesson.goal);
    expect(sheet.unit).toBe(lesson.unit);
    expect(sheet.unitTitle).toEqual(content.curriculum.units.find((u) => u.id === lesson.unit)?.title);
  });

  it("ne reprend que ce que le niveau introduit, jamais ce qu'il révise", () => {
    // Depuis le contrat phase21 §2, un niveau interroge des mots déjà présentés de son unité pour
    // atteindre 20 exercices. Ces mots ont leur propre fiche : les recopier ici la diluerait.
    const revising = lessons.find((l) => l.concepts.length > l.review.srsIntroduce.length && l.review.srsIntroduce.length > 0);
    expect(revising, "aucun niveau ne révise : le contenu a changé de forme").toBeDefined();
    const sheet = memoSheet(content, revising!.id)!;
    const listed = new Set([...sheet.words, ...sheet.structures, ...sheet.sounds].map((entry) => entry.id));
    expect([...listed].sort()).toEqual([...revising!.review.srsIntroduce].sort());
  });

  it("range les tons et les sons à part du vocabulaire", () => {
    // La leçon 1 du pack du Sud présente les cinq tons de « ma » : rien à ranger en vocabulaire.
    const sheet = memoSheet(content, "vi-south.u01.l01" as LessonId);
    expect(sheet).not.toBeNull();
    const kinds = new Set([...sheet!.words, ...sheet!.structures, ...sheet!.sounds].map((e) => content.concepts.get(e.id)?.type));
    expect(kinds.has(undefined)).toBe(false);
    for (const entry of sheet!.sounds) expect(["tone", "sound"]).toContain(content.concepts.get(entry.id)?.type);
    for (const entry of sheet!.structures) expect(content.concepts.get(entry.id)?.type).toBe("structure");
  });

  it("garde les explications du niveau, une seule fois chacune", () => {
    const withTips = lessons.find((l) => l.steps.filter((s) => "explain" in s && s.explain).length >= 2)!;
    const sheet = memoSheet(content, withTips.id)!;
    expect(sheet.tips.length).toBeGreaterThan(0);
    expect(new Set(sheet.tips.map((tip) => JSON.stringify(tip))).size).toBe(sheet.tips.length);
  });

  it("rebouche le trou des phrases à compléter : on emporte la phrase, pas le gabarit", () => {
    const sheets = lessons.map((lesson) => memoSheet(content, lesson.id)!);
    const phrases = sheets.flatMap((sheet) => sheet.phrases);
    expect(phrases.length).toBeGreaterThan(0);
    // Aucun blanc ne survit : une fiche qui affiche « Chung cư này gần chợ, ___ hơi ồn » ne se relit pas.
    for (const phrase of phrases) expect(phrase.vi).not.toMatch(/_{2,}|…/);
  });

  it("nomme le piège du Nord quand la forme diffère, et se tait quand elle est la même", () => {
    const sheets = lessons.map((lesson) => memoSheet(content, lesson.id)!);
    const pitfalls = sheets.flatMap((sheet) => sheet.pitfalls);
    expect(pitfalls.length).toBeGreaterThan(0);
    for (const pitfall of pitfalls) expect(pitfall.north).not.toBe(pitfall.vi);
  });

  it("n'invente rien : chaque mot cité existe dans le pack, avec la même forme", () => {
    for (const lesson of lessons) {
      const sheet = memoSheet(content, lesson.id)!;
      for (const entry of [...sheet.words, ...sheet.structures, ...sheet.sounds]) {
        const concept = content.concepts.get(entry.id);
        expect(concept, `${entry.id} absent du pack`).toBeDefined();
        expect(entry.vi).toBe(concept!.vi);
        expect(entry.gloss).toEqual(concept!.gloss);
      }
    }
  });

  it("un niveau inconnu ne lève pas : il n'a simplement pas de fiche", () => {
    expect(memoSheet(content, "vi-south.u99.l99" as LessonId)).toBeNull();
  });
});

describe("couverture du parcours", () => {
  it("chaque niveau du cursus a une fiche, et aucune n'est vide", () => {
    const empty = content.curriculum.units
      .flatMap((unit) => unit.lessons)
      .filter((id) => {
        const sheet = memoSheet(content, id);
        return sheet === null || isMemoEmpty(sheet);
      });
    expect(empty).toEqual([]);
  });

  it("une fiche tient sur une page qu'on relit : jamais plus de 40 lignes à retenir", () => {
    // Garde de forme, pas de goût. Une fiche de 200 lignes n'est plus un pense-bête, et personne
    // ne s'en apercevrait avant de l'imprimer.
    // La fiche d'un thème entier (épreuve, contrat phase26 §5) en réunit plusieurs : elle n'est pas
    // tenue à une page, son pense-bête au bilan l'est.
    for (const lesson of lessons.filter((l) => l.kind !== "unit_test")) {
      const sheet = memoSheet(content, lesson.id)!;
      const lines = sheet.words.length + sheet.structures.length + sheet.sounds.length + sheet.phrases.length;
      expect(lines, `${lesson.id} : ${lines} lignes`).toBeLessThanOrEqual(40);
    }
  });
});

describe("fiche d'un thème et pense-bête du bilan (contrat phase26 §5)", () => {
  it("l'épreuve porte la fiche du thème entier : tous les mots de ses niveaux, sans doublon", () => {
    const unit = content.curriculum.units[0]!;
    const test = unit.lessons.find((id) => content.lessons.get(id)?.kind === "unit_test")!;
    const sheet = memoSheet(content, test)!;
    expect(sheet.lessonId).toBe(test);
    expect(sheet.title).toEqual(unit.title);
    const taught = unit.lessons
      .filter((id) => (content.lessons.get(id)?.kind ?? "lesson") === "lesson")
      .flatMap((id) => content.lessons.get(id)!.review.srsIntroduce);
    const ids = [...sheet.words, ...sheet.structures, ...sheet.sounds].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(taught.filter((id) => content.concepts.has(id))));
    expect(unitMemoSheet(content, "inconnue", test)).toBeNull();
  });

  it("le pense-bête garde l'essentiel : quelques mots, les règles des fiches du niveau, les pièges", () => {
    const sheet = memoSheet(content, "vi-south.u00.l01")!;
    const essentials = memoEssentials(content, sheet);
    expect(essentials.words.length).toBeLessThanOrEqual(ESSENTIAL_WORDS);
    expect(essentials.words.length + essentials.moreWords).toBe(sheet.words.length + sheet.structures.length + sheet.sounds.length);
    // Les pièges de la fiche de l'alphabet, lue avant ce niveau, passent en tête des règles.
    expect(essentials.rules[0]).toEqual(content.guides.get("g_alphabet")!.pitfalls![0]);
    expect(essentials.rules.length).toBeLessThanOrEqual(ESSENTIAL_RULES);
  });
});
