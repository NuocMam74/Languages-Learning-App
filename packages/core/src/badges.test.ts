import { describe, expect, it } from "vitest";
import { BADGE_CODES, countKnownWords, evaluateBadges, pushToneResult, TONE_EAR_WINDOW, type BadgeInput } from "./badges.ts";
import { newCard, review } from "./srs.ts";
import { emptyStreak } from "./streak.ts";
import { loadPack } from "./testing/pack.ts";

const content = loadPack();
const NOW = new Date("2026-09-14T08:00:00Z");

const base = (patch: Partial<BadgeInput> = {}): BadgeInput => ({
  curriculum: content.curriculum,
  completedLessons: new Set(),
  streak: emptyStreak(),
  knownWords: 0,
  toneLog: [],
  ...patch,
});

describe("badges", () => {
  it("les 6 codes de la Phase 1", () => {
    expect(BADGE_CODES).toEqual(["first_lesson", "streak_7", "streak_30", "unit_1_done", "words_50", "tone_ear"]);
  });

  it("rien pour un nouvel utilisateur", () => {
    expect(evaluateBadges(base(), new Set())).toEqual([]);
  });

  it("première leçon, puis unité 1 terminée", () => {
    expect(evaluateBadges(base({ completedLessons: new Set(["vi-south.u01.l01"]) }), new Set())).toEqual(["first_lesson"]);
    const unit1 = content.curriculum.units[0]!.lessons;
    expect(evaluateBadges(base({ completedLessons: new Set(unit1) }), new Set(["first_lesson"]))).toEqual(["unit_1_done"]);
  });

  it("séries de 7 et 30 jours (la plus longue compte)", () => {
    expect(evaluateBadges(base({ streak: { ...emptyStreak(), current: 7, longest: 7 } }), new Set())).toEqual(["streak_7"]);
    expect(evaluateBadges(base({ streak: { ...emptyStreak(), current: 1, longest: 30 } }), new Set())).toEqual(["streak_7", "streak_30"]);
  });

  it("50 mots", () => {
    expect(evaluateBadges(base({ knownWords: 49 }), new Set())).toEqual([]);
    expect(evaluateBadges(base({ knownWords: 50 }), new Set())).toEqual(["words_50"]);
    const words = new Set(["c_ba", "c_anh"]);
    const cards = [review(newCard("c_ba", NOW), "good", NOW), newCard("c_anh", NOW), review(newCard("s_day_la", NOW), "good", NOW)];
    expect(countKnownWords(cards, words)).toBe(1);
  });

  it("oreille tonale : ≥ 95 % sur les 50 derniers items de tons", () => {
    const perfect49 = Array.from({ length: 49 }, () => true);
    expect(evaluateBadges(base({ toneLog: perfect49 }), new Set())).toEqual([]);
    const ok = [...Array.from({ length: 47 }, () => true), false, false, true];
    expect(evaluateBadges(base({ toneLog: ok }), new Set())).toEqual(["tone_ear"]);
    const tooMany = [...Array.from({ length: 47 }, () => true), false, false, false];
    expect(evaluateBadges(base({ toneLog: tooMany }), new Set())).toEqual([]);
    let log: boolean[] = [false, false, false];
    for (let i = 0; i < TONE_EAR_WINDOW; i++) log = pushToneResult(log, true);
    expect(log).toHaveLength(TONE_EAR_WINDOW);
    expect(evaluateBadges(base({ toneLog: log }), new Set())).toEqual(["tone_ear"]);
  });

  it("un badge déjà gagné n'est pas redonné", () => {
    expect(evaluateBadges(base({ knownWords: 80 }), new Set(["words_50"]))).toEqual([]);
  });
});
