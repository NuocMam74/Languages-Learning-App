import { describe, expect, it } from "vitest";
import { challengeProgress, challengeWeekStart, localChallengeSpec, longestDayRun, optimisticProgress, type Challenge, type ChallengeSpec } from "./challenges.ts";
import { makeEvent, type ParloEvent } from "./events.ts";
import { loadPack } from "./testing/pack.ts";

const content = loadPack();
const period = { periodStart: "2026-09-14T00:00:00.000Z", periodEnd: "2026-09-21T00:00:00.000Z" };
const at = (iso: string) => new Date(iso);

const sessionDone = (day: string): ParloEvent =>
  makeEvent("session_completed", { sessionId: "s", xpGained: 10, itemsCount: 5, durationMs: 1000, localDate: day }, at(`${day}T12:00:00Z`));
const lessonDone = (lessonId: string, iso = "2026-09-15T10:00:00Z"): ParloEvent => makeEvent("lesson_completed", { sessionId: "s", lessonId, score: 1, durationMs: 1000 }, at(iso));

describe("défis de la semaine", () => {
  it("lessons : leçons terminées dans la période seulement", () => {
    const spec: ChallengeSpec = { kind: "lessons", target: 5, unit: null, ...period };
    const events = [lessonDone("vi-south.u01.l01"), lessonDone("vi-south.u01.l02"), lessonDone("vi-south.u01.l03", "2026-09-13T23:59:00Z")];
    expect(challengeProgress(spec, events)).toBe(2);
  });

  it("streak_days : plus longue suite de jours consécutifs", () => {
    expect(longestDayRun(["2026-09-14", "2026-09-15", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-15"])).toBe(3);
    const spec: ChallengeSpec = { kind: "streak_days", target: 5, unit: null, ...period };
    expect(challengeProgress(spec, ["2026-09-14", "2026-09-15", "2026-09-16"].map(sessionDone))).toBe(3);
  });

  it("speaking_minutes : 1 item = 10 s", () => {
    const spec: ChallengeSpec = { kind: "speaking_minutes", target: 10, unit: null, ...period };
    const items = Array.from({ length: 13 }, () => makeEvent("pronunciation_scored", { sessionId: null, conceptId: "c_com", score: 70, exerciseType: "speak_repeat" }, at("2026-09-16T08:00:00Z")));
    expect(challengeProgress(spec, items)).toBe(2);
  });

  it("speaking_minutes : un tour de conversation = 20 s (comme l'API)", () => {
    const spec: ChallengeSpec = { kind: "speaking_minutes", target: 10, unit: null, ...period };
    const turn = () => makeEvent("conversation_turn", { conversationId: "c1", mode: "free", words: 6, responseMs: 4000, localDate: "2026-09-16" }, at("2026-09-16T08:00:00Z"));
    const item = makeEvent("pronunciation_scored", { sessionId: null, conceptId: "c_com", score: 70, exerciseType: "speak_repeat" }, at("2026-09-16T08:00:00Z"));
    expect(challengeProgress(spec, [turn(), turn(), item])).toBe(0); // 50 s
    expect(challengeProgress(spec, [turn(), turn(), turn(), item, item])).toBe(1); // 80 s
  });

  it("game_score : parties avec ratio ≥ 0.7", () => {
    const spec: ChallengeSpec = { kind: "game_score", target: 3, unit: null, ...period };
    const game = (correct: number, total: number) => makeEvent("game_played", { game: "cho_noi", correct, total, durationMs: 60_000, localDate: "2026-09-16" }, at("2026-09-16T08:00:00Z"));
    expect(challengeProgress(spec, [game(7, 10), game(6, 10), game(0, 0), game(10, 10)])).toBe(2);
  });

  it("words_theme : mots introduits par les leçons de l'unité", () => {
    const spec: ChallengeSpec = { kind: "words_theme", target: 10, unit: "vi-south.u01", ...period };
    const n = challengeProgress(spec, [lessonDone("vi-south.u01.l06"), lessonDone("vi-south.u02.l01")], content);
    const expected = (content.lessons.get("vi-south.u01.l06")?.review.srsIntroduce ?? []).filter((c) => content.concepts.get(c)?.type === "word").length;
    expect(n).toBe(expected);
    expect(challengeProgress(spec, [lessonDone("vi-south.u01.l06")])).toBe(0);
  });

  it("progression optimiste : serveur + outbox, plafonnée ; maximum pour une série", () => {
    const challenge: Challenge = { id: "c1", kind: "lessons", title: { fr: "5 leçons" }, target: 5, unit: null, progress: 4, completedAt: null, claimedAt: null, badgeCode: "b", ...period };
    expect(optimisticProgress(challenge, [lessonDone("a"), lessonDone("b")])).toBe(5);
    const streak: Challenge = { ...challenge, kind: "streak_days", progress: 2 };
    expect(optimisticProgress(streak, [sessionDone("2026-09-16")])).toBe(2);
  });

  it("défi local : semaine du lundi UTC, rotation déterministe", () => {
    expect(challengeWeekStart(at("2026-09-20T23:00:00Z")).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(challengeWeekStart(at("2026-09-14T00:00:00Z")).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    const a = localChallengeSpec(at("2026-09-15T10:00:00Z"), content);
    const b = localChallengeSpec(at("2026-09-19T10:00:00Z"), content);
    expect(a).toEqual(b);
    expect(a.periodStart).toBe(period.periodStart);
    const kinds = new Set(Array.from({ length: 5 }, (_, w) => localChallengeSpec(new Date(Date.parse(period.periodStart) + w * 7 * 86_400_000), content).kind));
    expect(kinds.size).toBe(5);
  });
});
