import { describe, expect, it } from "vitest";
import { buildExercise, evaluate, GAME_PASS_RATIO } from "../engine.ts";
import { loadPack } from "../testing/pack.ts";
import type { Concept, Tone } from "../types.ts";
import {
  answerChoNoi,
  betterChoNoiBest,
  CHO_NOI_DEFAULTS,
  choNoiBoatProgress,
  choNoiPool,
  choNoiResult,
  choNoiRoundDeadlineMs,
  choNoiTravelMs,
  currentChoNoiRound,
  generateChoNoiRounds,
  heardKey,
  isChoNoiOver,
  pickChoNoiDistractors,
  startChoNoi,
  tickChoNoi,
} from "./cho-noi.ts";

const content = loadPack();
const SOUTH: Tone[][] = [["ngang"], ["huyen"], ["sac"], ["hoi", "nga"], ["nang"]];

function concept(id: string, vi: string, extra: Partial<Concept> = {}): Concept {
  return {
    id, vi, type: "word", gloss: { fr: id }, reviewed: false,
    audio: [{ voice: "v", src: `audio/${id}.opus`, source: "native", speed: "natural" }],
    ...extra,
  };
}

const ma = [
  concept("ma", "ma"), concept("mà", "mà"), concept("má", "má"), concept("mả", "mả"), concept("mã", "mã"), concept("mạ", "mạ"),
];
const others = [concept("anh", "anh"), concept("em", "em"), concept("chao_anh", "chào anh", { type: "structure" })];

describe("choNoiPool", () => {
  it("écarte les concepts sans audio natif en production et les doublons d'écriture", () => {
    const tts = concept("tts", "chị", { audio: [{ voice: "v", src: "x", source: "tts", speed: "natural" }] });
    const dup = concept("ma2", "Ma");
    expect(choNoiPool([...ma, tts, dup], { requireNative: true }).map((c) => c.id)).toEqual(ma.map((c) => c.id));
    expect(choNoiPool([...ma, tts], { requireNative: false })).toHaveLength(7);
  });
});

describe("distracteurs", () => {
  it("préfère les voisins tonals (même base sans tons)", () => {
    const d = pickChoNoiDistractors(ma[2]!, [...others, ...ma], 2, () => 0.5, SOUTH);
    expect(d.every((c) => c.vi.normalize("NFD").startsWith("ma"))).toBe(true);
  });

  it("n'oppose jamais hỏi à ngã (spec §7.1)", () => {
    expect(heardKey("mả", SOUTH)).toBe(heardKey("mã", SOUTH));
    for (let s = 0; s < 50; s++) {
      const rounds = generateChoNoiRounds([...ma, ...others], `seed${s}`, { boats: 4 }, SOUTH);
      for (const round of rounds) {
        const keys = round.boats.map((b) => heardKey(b.text, SOUTH));
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  it("se rabat sur le même type, puis sur le reste", () => {
    const d = pickChoNoiDistractors(others[0]!, others, 2, () => 0.1, SOUTH);
    expect(d.map((c) => c.id)).toEqual(["em", "chao_anh"]);
  });
});

describe("generateChoNoiRounds", () => {
  it("est déterministe pour une même graine", () => {
    const a = generateChoNoiRounds([...ma, ...others], "s1", {}, SOUTH);
    expect(generateChoNoiRounds([...ma, ...others], "s1", {}, SOUTH)).toEqual(a);
    expect(generateChoNoiRounds([...ma, ...others], "s2", {}, SOUTH)).not.toEqual(a);
  });

  it("produit N manches valides, cible présente, couloirs distincts, sans cible répétée d'affilée", () => {
    const rounds = generateChoNoiRounds([...ma, ...others], "s1", {}, SOUTH);
    expect(rounds).toHaveLength(CHO_NOI_DEFAULTS.rounds);
    rounds.forEach((round, i) => {
      expect(round.boats).toHaveLength(3);
      expect(round.boats.some((b) => b.conceptId === round.targetId)).toBe(true);
      expect(new Set(round.boats.map((b) => b.lane)).size).toBe(3);
      expect(round.boats.every((b) => b.stagger >= 0 && b.stagger <= CHO_NOI_DEFAULTS.maxStagger)).toBe(true);
      if (i > 0) expect(round.targetId).not.toBe(rounds[i - 1]!.targetId);
    });
  });

  it("accélère : la traversée raccourcit à chaque manche", () => {
    const rounds = generateChoNoiRounds(ma, "s", {}, SOUTH);
    for (let i = 1; i < rounds.length; i++) expect(rounds[i]!.travelMs).toBeLessThan(rounds[i - 1]!.travelMs);
    expect(choNoiTravelMs(0)).toBe(CHO_NOI_DEFAULTS.startTravelMs);
    expect(choNoiTravelMs(CHO_NOI_DEFAULTS.rounds - 1)).toBe(CHO_NOI_DEFAULTS.endTravelMs);
  });

  it("reste vide sans au moins deux mots distinguables à l'oreille", () => {
    expect(generateChoNoiRounds([ma[0]!], "s", {}, SOUTH)).toEqual([]);
    expect(generateChoNoiRounds([ma[3]!, ma[4]!], "s", {}, SOUTH)).toEqual([]); // mả / mã : même son au Sud
  });

  it("fonctionne avec moins de concepts que de barques", () => {
    const rounds = generateChoNoiRounds([ma[0]!, ma[1]!], "s", {}, SOUTH);
    expect(rounds.every((r) => r.boats.length === 2)).toBe(true);
  });
});

describe("partie", () => {
  const rounds = generateChoNoiRounds([...ma, ...others], "play", {}, SOUTH);

  it("compte justes, ratés et sorties, sans vies ni blocage", () => {
    let state = startChoNoi(rounds);
    for (let i = 0; i < rounds.length; i++) {
      const round = currentChoNoiRound(state)!;
      const wrong = round.boats.find((b) => b.conceptId !== round.targetId)!.conceptId;
      const chosen = i < 7 ? round.targetId : i === 7 ? wrong : null;
      state = answerChoNoi(tickChoNoi(state, 1000), chosen, 1000);
    }
    expect(isChoNoiOver(state)).toBe(true);
    expect(currentChoNoiRound(state)).toBeNull();
    const result = choNoiResult(state);
    expect(result).toMatchObject({ correct: 7, total: 10 });
    expect(result.points).toBeGreaterThan(70);
    expect(answerChoNoi(state, "anh", 1)).toBe(state); // partie finie : ignoré
  });

  it("s'arrête après la durée maximale", () => {
    let state = startChoNoi(rounds, 60_000);
    state = answerChoNoi(tickChoNoi(state, 30_000), rounds[0]!.targetId, 500);
    expect(isChoNoiOver(state)).toBe(false);
    state = tickChoNoi(state, 30_000);
    expect(isChoNoiOver(state)).toBe(true);
    expect(choNoiResult(state)).toMatchObject({ correct: 1, total: 1 });
  });

  it("donne plus de points aux réponses rapides", () => {
    const fast = choNoiResult(answerChoNoi(startChoNoi(rounds), rounds[0]!.targetId, 100)).points;
    const slow = choNoiResult(answerChoNoi(startChoNoi(rounds), rounds[0]!.targetId, 6000)).points;
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThanOrEqual(10);
  });

  it("calcule la progression des barques et l'échéance de la cible", () => {
    const round = rounds[0]!;
    const target = round.boats.find((b) => b.conceptId === round.targetId)!;
    expect(choNoiBoatProgress(target, round, choNoiRoundDeadlineMs(round))).toBeCloseTo(1);
    expect(choNoiBoatProgress(target, round, 0)).toBeLessThanOrEqual(0);
  });

  it("garde le meilleur score", () => {
    const a = { correct: 5, total: 10, points: 60 };
    const b = { correct: 8, total: 10, points: 100 };
    expect(betterChoNoiBest(null, a)).toEqual(a);
    expect(betterChoNoiBest(betterChoNoiBest(null, b), a)).toEqual(b);
  });
});

describe("intégration avec le pack et le moteur", () => {
  it("la leçon 1 (ma, mà, má, mả, mạ) donne une partie jouable", () => {
    const lesson = content.lessons.get("vi-south.u01.l01")!;
    const step = lesson.steps.findIndex((s) => s.type === "game");
    const ex = buildExercise(content, lesson, step, "sess");
    if (ex.type !== "game") throw new Error("pas un jeu");
    const pool = choNoiPool(ex.conceptIds.map((id) => content.concepts.get(id)!), { requireNative: true });
    const rounds = generateChoNoiRounds(pool, "sess", {}, content.pack.toneSystem?.heardClasses);
    expect(rounds).toHaveLength(10);

    let state = startChoNoi(rounds);
    for (const round of rounds) state = answerChoNoi(state, round.targetId, 800);
    const { correct, total } = choNoiResult(state);
    expect(evaluate(ex, { kind: "game", correct, total })).toMatchObject({ correct: true, graded: true });
    expect(evaluate(ex, { kind: "game", correct: Math.ceil(total * GAME_PASS_RATIO) - 1, total }).correct).toBe(false);
  });
});
