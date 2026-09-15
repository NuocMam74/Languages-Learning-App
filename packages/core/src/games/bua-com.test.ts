import { describe, expect, it } from "vitest";
import { canBuild } from "../content-checks.ts";
import { buildExercise, evaluate } from "../engine.ts";
import { loadPack } from "../testing/pack.ts";
import { normalizeAnswer } from "../text.ts";
import {
  answerBuaCom,
  BUA_COM_DEFAULTS,
  buaComPoints,
  buaComResult,
  buaComSources,
  buaComWarmth,
  currentBuaComRound,
  generateBuaComRounds,
  isBuaComOver,
  judgeBuaCom,
  pickBuaComDistractors,
  startBuaCom,
  type BuaComRound,
  type BuaComSource,
} from "./bua-com.ts";
import { betterGameBest } from "./common.ts";

const content = loadPack();
const lessonIds = content.curriculum.units.flatMap((u) => u.lessons).filter((id) => content.lessons.has(id));

/** Jetons dans l'ordre de la cible (résolution gloutonne, comme canBuild). */
function solve(round: BuaComRound): string[] {
  let rest = normalizeAnswer(round.source.target);
  const used = new Set<string>();
  const ids: string[] = [];
  while (rest) {
    const tok = [...round.tokens]
      .sort((a, b) => b.text.length - a.text.length)
      .find((t) => !used.has(t.id) && (rest === normalizeAnswer(t.text) || rest.startsWith(`${normalizeAnswer(t.text)} `)));
    if (!tok) throw new Error(`insoluble : ${round.source.target}`);
    used.add(tok.id);
    ids.push(tok.id);
    rest = rest.slice(normalizeAnswer(tok.text).length).trimStart();
  }
  return ids;
}

describe("buaComSources", () => {
  it("pool d'une leçon : ses phrases et celles des leçons antérieures qui partagent un concept, jamais une leçon future", () => {
    const lessonId = "vi-south.u03.l05";
    const lesson = content.lessons.get(lessonId)!;
    const sources = buaComSources(content, lesson.concepts);
    const horizon = lessonIds.indexOf(lessonId);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => lessonIds.indexOf(s.lessonId) <= horizon)).toBe(true);
    expect(sources.every((s) => canBuild(s.target, s.tokens))).toBe(true);
    expect(new Set(sources.map((s) => normalizeAnswer(s.target))).size).toBe(sources.length);
  });

  it("pool vide ou inconnu → aucune phrase", () => {
    expect(buaComSources(content, [])).toEqual([]);
    expect(buaComSources(content, ["c_inconnu"])).toEqual([]);
  });
});

describe("generateBuaComRounds", () => {
  const all = [...content.concepts.keys()];
  const sources = buaComSources(content, all);

  it("déterministe, N manches, phrases de plus en plus longues, pièges ajoutés sans doublon", () => {
    const rounds = generateBuaComRounds(sources, "s1");
    expect(generateBuaComRounds(sources, "s1")).toEqual(rounds);
    expect(generateBuaComRounds(sources, "s2")).not.toEqual(rounds);
    expect(rounds).toHaveLength(BUA_COM_DEFAULTS.rounds);
    for (const [i, round] of rounds.entries()) {
      const texts = round.tokens.map((t) => normalizeAnswer(t.text));
      expect(new Set(texts).size).toBe(texts.length);
      expect(round.tokens.length).toBeGreaterThan(round.source.tokens.length - 1);
      expect(round.tokens.length).toBeLessThanOrEqual(Math.max(BUA_COM_DEFAULTS.maxTokens, round.source.tokens.length));
      expect(canBuild(round.source.target, round.tokens.map((t) => t.text))).toBe(true);
      expect(round.hotMs).toBeGreaterThan(BUA_COM_DEFAULTS.baseMs);
      if (i > 0) {
        const len = (r: BuaComRound) => Math.min(r.source.tokens.length, normalizeAnswer(r.source.target).split(" ").length);
        expect(len(round)).toBeGreaterThanOrEqual(len(rounds[i - 1]!));
      }
    }
  });

  it("préfère les voisins tonals comme pièges", () => {
    const src = (tokens: string[], target = tokens.join(" ")): BuaComSource => ({
      lessonId: "l", stepIndex: 0, target, tokens, translation: { fr: "" }, audioConcept: null, explain: null, order: 0,
    });
    const target = src(["Đây", "là", "ba", "tôi"]);
    const other = src(["bà", "chị", "cảm ơn"]);
    expect(pickBuaComDistractors(target, [target, other], 1, () => 0.9)).toEqual(["bà"]);
    expect(pickBuaComDistractors(target, [target, src(["ba", "Tôi"])], 2, () => 0)).toEqual([]);
  });

  it("aucune source → aucune manche", () => {
    expect(generateBuaComRounds([], "s")).toEqual([]);
  });
});

describe("partie", () => {
  const rounds = generateBuaComRounds(buaComSources(content, [...content.concepts.keys()]), "play");

  it("juge comme build_sentence : juste, presque (ton seul), faux", () => {
    const round = rounds[0]!;
    const ids = solve(round);
    expect(judgeBuaCom(round, ids)).toBe("correct");
    expect(judgeBuaCom(round, [...ids].reverse())).toBe(ids.length > 1 ? "wrong" : "correct");
    const toneSlip: BuaComRound = { ...round, tokens: [{ id: "a", text: "Đây" }, { id: "b", text: "là" }, { id: "c", text: "bà" }, { id: "d", text: "tôi" }], source: { ...round.source, target: "Đây là ba tôi." } };
    expect(judgeBuaCom(toneSlip, ["a", "b", "c", "d"])).toBe("near");
  });

  it("chrono doux : la chaleur baisse le bonus, jamais la réponse", () => {
    const round = rounds[0]!;
    expect(buaComWarmth(round, 0)).toBe(1);
    expect(buaComWarmth(round, round.hotMs * 2)).toBe(0);
    let state = startBuaCom(rounds);
    state = answerBuaCom(state, solve(round), round.hotMs * 3); // plat froid : toujours accepté
    expect(state.answers[0]!.verdict).toBe("correct");
    expect(buaComPoints(state.answers[0]!, round)).toBe(10);
    const hot = answerBuaCom(startBuaCom(rounds), solve(round), 0);
    expect(buaComPoints(hot.answers[0]!, round)).toBe(15);
  });

  it("compte les manches et s'arrête", () => {
    let state = startBuaCom(rounds);
    rounds.forEach((round, i) => {
      expect(currentBuaComRound(state)).toBe(round);
      state = answerBuaCom(state, i === 1 ? [] : solve(round), 1000);
    });
    expect(isBuaComOver(state)).toBe(true);
    expect(answerBuaCom(state, [], 0)).toBe(state);
    const result = buaComResult(state);
    expect(result).toMatchObject({ correct: rounds.length - 1, total: rounds.length });
    expect(betterGameBest(null, result)).toEqual({ points: result.points, correct: result.correct, total: result.total });
  });

  it("intégration moteur : une étape game bua_com d'une leçon fournit un pool jouable", () => {
    const lesson = content.lessons.get("vi-south.u04.l03")!;
    const withGame = { ...lesson, steps: [...lesson.steps, { type: "game" as const, game: "bua_com" as const, conceptPool: "lesson" as const }] };
    const ex = buildExercise(content, withGame, withGame.steps.length - 1, "sess");
    if (ex.type !== "game") throw new Error("pas un jeu");
    const game = generateBuaComRounds(buaComSources(content, ex.conceptIds), "sess");
    expect(game.length).toBeGreaterThan(0);
    let state = startBuaCom(game);
    for (const round of game) state = answerBuaCom(state, solve(round), 500);
    const { correct, total } = buaComResult(state);
    expect(evaluate(ex, { kind: "game", correct, total })).toMatchObject({ correct: true, graded: true });
  });
});
