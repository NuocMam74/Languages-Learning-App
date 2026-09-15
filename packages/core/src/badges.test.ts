import { describe, expect, it } from "vitest";
import { BADGE_CODES, countKnownWords, evaluateBadges, isChallengeBadge, NO_NORTH_WINDOW, pushSouthResult, pushToneResult, TONE_EAR_WINDOW, type BadgeInput } from "./badges.ts";
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
  it("codes : Phase 1 + contrat phase5 §3", () => {
    expect(BADGE_CODES).toEqual([
      "first_lesson", "streak_7", "streak_30", "streak_100", "streak_365", "unit_1_done", "words_50", "words_500", "tone_ear",
      "no_north_accent", "culture_explorer", "culture_unit",
    ]);
  });

  it("séries de 100 et 365 jours, 500 mots", () => {
    const streak = { ...emptyStreak(), current: 3, longest: 365 };
    expect(evaluateBadges(base({ streak, knownWords: 500 }), new Set())).toEqual(["streak_7", "streak_30", "streak_100", "streak_365", "words_50", "words_500"]);
  });

  it("sans accent du Nord : ≥ 95 % sur les 30 derniers spot_the_south (fenêtre pleine)", () => {
    const ok = Array.from({ length: NO_NORTH_WINDOW }, (_, i) => i !== 0);
    expect(evaluateBadges(base({ southLog: ok.slice(1) }), new Set())).toEqual([]);
    expect(evaluateBadges(base({ southLog: [true, ...ok.slice(1)] }), new Set())).toEqual(["no_north_accent"]);
    expect(evaluateBadges(base({ southLog: [false, false, ...ok.slice(2)] }), new Set())).toEqual([]);
    let log: boolean[] = [];
    for (let i = 0; i < 40; i++) log = pushSouthResult(log, true);
    expect(log).toHaveLength(NO_NORTH_WINDOW);
  });

  it("culture : 20 cartes réussies, test d'une unité taguée culture réussi", () => {
    expect(evaluateBadges(base({ cultureCardsPassed: 19 }), new Set())).toEqual([]);
    expect(evaluateBadges(base({ cultureCardsPassed: 20 }), new Set())).toEqual(["culture_explorer"]);
    const cultureUnit = content.curriculum.units.find((u) => u.tags?.includes("culture"))!;
    expect(evaluateBadges(base({ passedUnits: new Set(["vi-south.u01"]) }), new Set())).toEqual([]);
    expect(evaluateBadges(base({ passedUnits: new Set([cultureUnit.id]) }), new Set())).toEqual(["culture_unit"]);
  });

  it("badges de défi : serveur seulement, reconnus par leur préfixe", () => {
    expect(isChallengeBadge("challenge_words_theme")).toBe(true);
    expect(isChallengeBadge("streak_7")).toBe(false);
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
