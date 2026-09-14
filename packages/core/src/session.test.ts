import { describe, expect, it } from "vitest";
import { nextLesson, planSession, RECAP_SECONDS, REVIEW_ITEM_SECONDS, OVERRUN_TOLERANCE } from "./session.ts";
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

  it("les révisions en trop glissent au lendemain", () => {
    const plan = planSession({ targetMinutes: 5, cards: dueCards(100), nextLesson: null, now: NOW });
    const reviewBlock = plan.blocks.find((b) => b.kind === "review");
    expect(reviewBlock?.kind).toBe("review");
    if (reviewBlock?.kind !== "review") return;
    expect(reviewBlock.conceptIds.length).toBe(Math.floor((300 - RECAP_SECONDS) / REVIEW_ITEM_SECONDS));
    expect(reviewBlock.deferred).toBe(100 - reviewBlock.conceptIds.length);
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
    expect(nextLesson(content.curriculum, content.lessons, none, null)?.id).toBe("vi-south.u01.l01");
    expect(nextLesson(content.curriculum, content.lessons, new Set(["vi-south.u01.l01"]), null)?.id).toBe("vi-south.u01.l02");
    const all = new Set(content.lessons.keys());
    expect(nextLesson(content.curriculum, content.lessons, all, null)).toBeNull();
  });

  it("le parcours du profil remonte les unités taguées", () => {
    const lessons = new Map(content.lessons);
    const base = content.lessons.get("vi-south.u01.l01")!;
    lessons.set("vi-south.u04.l01", { ...base, id: "vi-south.u04.l01", unit: "vi-south.u04", prerequisites: [] });
    const curriculum: Curriculum = {
      ...content.curriculum,
      units: content.curriculum.units.map((u) =>
        u.id === "vi-south.u04" ? { ...u, status: "available" as const, lessons: ["vi-south.u04.l01"] } : u,
      ),
    };
    expect(nextLesson(curriculum, lessons, new Set(), "travel")?.id).toBe("vi-south.u01.l01");
    expect(nextLesson(curriculum, lessons, new Set(), "family")?.id).toBe("vi-south.u04.l01");
  });
});
