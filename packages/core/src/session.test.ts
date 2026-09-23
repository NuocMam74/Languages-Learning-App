import { describe, expect, it } from "vitest";
import { isLessonUnlocked, isUnitAvailable, isUnitTestPassed, nextLesson, planSession, RECAP_SECONDS, REVIEW_ITEM_SECONDS, OVERRUN_TOLERANCE, unitRequires } from "./session.ts";
import { newCard, review, type SrsCard } from "./srs.ts";
import { loadPack } from "./testing/pack.ts";
import type { Curriculum } from "./types.ts";

const content = loadPack();
const NOW = new Date("2026-09-14T08:00:00Z");
const l01 = content.lessons.get("vi-south.u01.l01")!;

function dueCards(n: number): SrsCard[] {
  const past = new Date("2026-09-01T08:00:00Z");
  return Array.from({ length: n }, (_, i) => review(newCard(`c_x${i}`, past), "good", past));
}

describe("planSession", () => {
  it("nouvel utilisateur : la première leçon puis le bilan", () => {
    const plan = planSession({ targetMinutes: 5, cards: [], nextLesson: l01, now: NOW });
    expect(plan.blocks).toEqual([{ kind: "new", lessonId: "vi-south.u01.l01" }, { kind: "recap" }]);
  });

  it("ne dépasse jamais la durée annoncée au-delà de la tolérance", () => {
    for (const minutes of [5, 10, 15, 20]) {
      for (const due of [0, 3, 40, 300]) {
        const plan = planSession({ targetMinutes: minutes, cards: dueCards(due), nextLesson: l01, now: NOW });
        expect(plan.estimatedSeconds).toBeLessThanOrEqual(minutes * 60 * (1 + OVERRUN_TOLERANCE));
      }
    }
  });

  it("objectif 5 min : quelques révisions dues passent avant la leçon, dans la tolérance", () => {
    const plan = planSession({ targetMinutes: 5, cards: dueCards(3), nextLesson: l01, now: NOW });
    expect(plan.blocks.map((b) => b.kind)).toEqual(["review", "new", "recap"]);
    expect(plan.estimatedSeconds).toBeLessThanOrEqual(300 * (1 + OVERRUN_TOLERANCE));
  });

  it("beaucoup de révisions en retard : journée de révision, sans nouveau", () => {
    const plan = planSession({ targetMinutes: 5, cards: dueCards(12), nextLesson: l01, now: NOW });
    expect(plan.blocks.map((b) => b.kind)).toEqual(["review", "recap"]);
  });

  it("les révisions en trop glissent au lendemain", () => {
    const plan = planSession({ targetMinutes: 5, cards: dueCards(100), nextLesson: null, now: NOW });
    const reviewBlock = plan.blocks.find((b) => b.kind === "review");
    expect(reviewBlock?.kind).toBe("review");
    if (reviewBlock?.kind !== "review") return;
    expect(reviewBlock.conceptIds.length).toBe(Math.floor((300 - RECAP_SECONDS) / REVIEW_ITEM_SECONDS));
    expect(reviewBlock.deferred).toBe(100 - reviewBlock.conceptIds.length);
  });

  it("un mot que la leçon fait travailler ne revient pas en rappel espacé", () => {
    const past = new Date("2026-09-01T08:00:00Z");
    // Deux cartes dues : l'une est un mot de la leçon du jour, l'autre non.
    const inLesson = l01.concepts[0]!;
    const cards = [review(newCard(inLesson, past), "good", past), review(newCard("c_x0", past), "good", past)];
    const plan = planSession({ targetMinutes: 10, cards, nextLesson: l01, now: NOW });
    const block = plan.blocks.find((b) => b.kind === "review");
    expect(block?.kind === "review" && block.conceptIds).toEqual(["c_x0"]);

    // Sans la leçon (révision seule), le mot reste dû : rien n'est perdu, il attend son tour.
    const alone = planSession({ targetMinutes: 10, cards, nextLesson: null, now: NOW });
    const aloneBlock = alone.blocks.find((b) => b.kind === "review");
    expect(aloneBlock?.kind === "review" && [...aloneBlock.conceptIds].sort()).toEqual([inLesson, "c_x0"].sort());
  });

  it("leçon écartée du budget : ses mots restent en rappel espacé", () => {
    const past = new Date("2026-09-01T08:00:00Z");
    const inLesson = l01.concepts[0]!;
    // Assez de retard pour déclencher une journée de révision : la leçon n'entre pas.
    const cards = [review(newCard(inLesson, past), "good", past), ...dueCards(12)];
    const plan = planSession({ targetMinutes: 5, cards, nextLesson: l01, now: NOW });
    expect(plan.blocks.map((b) => b.kind)).toEqual(["review", "recap"]);
    const block = plan.blocks.find((b) => b.kind === "review");
    expect(block?.kind === "review" && block.conceptIds).toContain(inLesson);
  });

  it("commence par des items maîtrisés (réveil) quand il y en a", () => {
    let card = review(newCard("c_ba", new Date("2026-01-01")), "easy", new Date("2026-01-01"));
    for (let i = 0; i < 5; i++) card = review(card, "easy", new Date(card.due));
    const plan = planSession({ targetMinutes: 10, cards: [card], nextLesson: l01, now: new Date(Date.parse(card.due) - 86_400_000) });
    expect(plan.blocks[0]).toEqual({ kind: "warmup", conceptIds: ["c_ba"] });
  });
});

describe("nextLesson", () => {
  it("respecte les prérequis et l'ordre du cursus", () => {
    const none = new Set<string>();
    // Les bases (u00, contrat phase26 §2) ouvrent le parcours.
    expect(nextLesson(content.curriculum, content.lessons, none, null)?.id).toBe("vi-south.u00.l01");
    expect(nextLesson(content.curriculum, content.lessons, new Set(["vi-south.u00.l01"]), null)?.id).toBe("vi-south.u00.l02");
    const all = new Set(content.lessons.keys());
    expect(nextLesson(content.curriculum, content.lessons, all, null)).toBeNull();
  });

  it("le parcours du profil trie les unités disponibles : famille, voyage, travail changent réellement l'ordre", () => {
    // Socle u00→u01→u02→u03 réussi : u04 (famille), u05 (travail), u06 (voyage) deviennent disponibles.
    const done = new Set(["vi-south.u00", "vi-south.u01", "vi-south.u02", "vi-south.u03"].flatMap((u) => content.curriculum.units.find((x) => x.id === u)!.lessons));
    expect(nextLesson(content.curriculum, content.lessons, new Set(), "family")?.id).toBe("vi-south.u00.l01");
    expect(nextLesson(content.curriculum, content.lessons, done, "family")?.id).toBe("vi-south.u04.l01");
    expect(nextLesson(content.curriculum, content.lessons, done, "work")?.id).toBe("vi-south.u05.l01");
    expect(nextLesson(content.curriculum, content.lessons, done, "travel")?.id).toBe("vi-south.u06.l01");
    expect(nextLesson(content.curriculum, content.lessons, done, null)?.id).toBe("vi-south.u04.l01");
  });

  it("leçon terminée mais non réussie : c'est elle la prochaine étape, pas un cul-de-sac", () => {
    // Le défaut corrigé : `nextLesson` la comptait comme faite et passait à la suivante, que
    // `isLessonUnlocked` refusait d'ouvrir faute de prérequis **réussi**. La séance du jour se
    // retrouvait vide et l'accueil sans bouton, pendant que le parcours affichait « à refaire ».
    const completed = new Set(["vi-south.u00.l01"]);
    const passed = new Set<string>();
    expect(nextLesson(content.curriculum, content.lessons, completed, null, passed)?.id).toBe("vi-south.u00.l01");
    expect(isLessonUnlocked(content.curriculum, content.lessons, "vi-south.u00.l02", { completed, passed })).toBe(false);
    // Réussie, elle laisse enfin la place à la suivante.
    expect(nextLesson(content.curriculum, content.lessons, completed, null, completed)?.id).toBe("vi-south.u00.l02");
  });

  it("test d'unité terminé sous le seuil : l'unité suivante reste fermée, le test est reproposé", () => {
    const first = content.curriculum.units[0]!;
    const test = first.lessons.find((id) => content.lessons.get(id)?.kind === "unit_test")!;
    const completed = new Set(first.lessons);
    const failed = new Set(first.lessons.filter((id) => id !== test));
    expect(nextLesson(content.curriculum, content.lessons, completed, null, failed)?.id).toBe(test);
    expect(isUnitAvailable(content.curriculum, content.lessons, "vi-south.u01", { completed, passed: failed })).toBe(false);
    expect(nextLesson(content.curriculum, content.lessons, completed, null, completed)?.id).toBe("vi-south.u01.l01");
    expect(isUnitTestPassed(0.7)).toBe(true);
    expect(isUnitTestPassed(0.69)).toBe(false);
  });

  it("graphe : requires explicite ou unité précédente, prérequis inter-unités ignorés, garde des leçons", () => {
    expect(unitRequires(content.curriculum, "vi-south.u10")).toEqual(["vi-south.u05", "vi-south.u06"]);
    const noRequires: Curriculum = { ...content.curriculum, units: content.curriculum.units.map(({ requires: _r, ...u }) => u) };
    expect(unitRequires(noRequires, "vi-south.u02")).toEqual(["vi-south.u01"]);
    expect(unitRequires(noRequires, "vi-south.u01")).toEqual(["vi-south.u00"]);
    expect(unitRequires(noRequires, "vi-south.u00")).toEqual([]);
    const none = { completed: new Set<string>() };
    expect(isLessonUnlocked(content.curriculum, content.lessons, "vi-south.u00.l01", none)).toBe(true);
    expect(isLessonUnlocked(content.curriculum, content.lessons, "vi-south.u01.l01", none)).toBe(false);
    expect(isLessonUnlocked(content.curriculum, content.lessons, "vi-south.u24.l08", none)).toBe(false);
    const u00Test = content.curriculum.units[0]!.lessons.find((id) => content.lessons.get(id)?.kind === "unit_test")!;
    expect(isLessonUnlocked(content.curriculum, content.lessons, "vi-south.u01.l01", { completed: new Set([u00Test]) })).toBe(true);
  });
});
