import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSouthLinter, hasBlocking, type LexicalVariantEntry } from "@parlo/south-lint";
import { describe, expect, it } from "vitest";
import { evaluate, type Exercise } from "../engine.ts";
import { loadPack } from "../testing/pack.ts";
import type { Concept } from "../types.ts";
import {
  applyXeOmAction,
  checkXeOmData,
  currentXeOmInstruction,
  isXeOmOver,
  landmarkTouches,
  moveXeOm,
  pickXeOmRoutes,
  startXeOm,
  turnHeading,
  XE_OM_ACTIONS,
  xeOmActionForCell,
  xeOmHint,
  xeOmIsBridge,
  xeOmPath,
  xeOmResult,
  xeOmShowTranscript,
  xeOmTargets,
  type XeOmAction,
  type XeOmData,
  type XeOmMap,
  type XeOmRoute,
} from "./xe-om.ts";

const root = join(import.meta.dirname, "..", "..", "..", "..", "content", "vi-south");
const data = JSON.parse(readFileSync(join(root, "games", "xe_om.json"), "utf8")) as XeOmData;

const map: XeOmMap = {
  id: "m", cols: 3, rows: 3, canals: [[0, 0], [1, 0]],
  landmarks: [{ id: "cho", block: [1, 1], vi: "chợ", gloss: { fr: "marché" }, icon: "market" }],
};
const route = (instructions: [string, XeOmAction, string?][], start: XeOmRoute["start"] = { at: [0, 2], heading: "N" }): XeOmRoute => ({
  id: "r", map: "m", level: 1, start, reviewed: false,
  instructions: instructions.map(([vi, action, landmark]) => ({ vi, action, gloss: { fr: vi }, ...(landmark ? { landmark } : {}) })),
});
const simple = route([["Chạy thẳng.", "straight"], ["Quẹo phải.", "right"], ["Dừng lại ở chợ.", "stop", "cho"]]);

describe("géométrie", () => {
  it("tourne et avance d'un carrefour ; stop ne bouge pas", () => {
    expect(turnHeading("N", "left")).toBe("W");
    expect(turnHeading("W", "right")).toBe("N");
    expect(applyXeOmAction({ at: [1, 1], heading: "S" }, "left")).toEqual({ at: [2, 1], heading: "E" });
    expect(applyXeOmAction({ at: [1, 1], heading: "S" }, "stop")).toEqual({ at: [1, 1], heading: "S" });
  });

  it("repère au coin d'un pâté, ponts entre deux canaux", () => {
    expect(landmarkTouches(map.landmarks[0]!, [2, 2])).toBe(true);
    expect(landmarkTouches(map.landmarks[0]!, [0, 2])).toBe(false);
    expect(xeOmIsBridge(map, [1, 0], [1, 1])).toBe(true);
    expect(xeOmIsBridge(map, [0, 0], [1, 0])).toBe(false);
  });

  it("toucher la carte : voisin → direction, carrefour actuel → stop, hors carte → rien", () => {
    const pose = { at: [0, 1] as const, heading: "N" as const };
    const targets = xeOmTargets(map, pose);
    expect(targets.left).toBeNull();
    expect(targets.straight).toEqual([0, 0]);
    expect(xeOmActionForCell(map, pose, [1, 1])).toBe("right");
    expect(xeOmActionForCell(map, pose, [0, 1])).toBe("stop");
    expect(xeOmActionForCell(map, pose, [2, 2])).toBeNull();
  });
});

describe("checkXeOmData", () => {
  const wrap = (routes: XeOmRoute[]): XeOmData => ({ version: 1, maps: [map], routes, reviewed: false });

  it("accepte un itinéraire cohérent", () => {
    expect(checkXeOmData(wrap([simple]))).toEqual([]);
    expect(xeOmPath(simple).map((p) => p.at)).toEqual([[0, 2], [0, 1], [1, 1], [1, 1]]);
  });

  it("refuse sortie de carte, repère absent du carrefour, stop manquant ou prématuré", () => {
    const issues = checkXeOmData(wrap([
      route([["Quẹo trái.", "left"], ["Dừng lại.", "stop"]]),
      route([["Dừng lại ở chợ.", "stop", "cho"]]),
      route([["Dừng lại.", "stop"], ["Chạy thẳng.", "straight"]]),
      route([["Chạy thẳng ở chợ.", "straight", "cho"], ["Dừng lại.", "stop"]]),
    ]));
    expect(issues.join("\n")).toMatch(/sort de la carte/);
    expect(issues.join("\n")).toMatch(/n'est pas au carrefour/);
    expect(issues.join("\n")).toMatch(/« stop » avant la fin/);
    expect(issues.join("\n")).toMatch(/dernière consigne/);
  });

  it("le fichier du pack est valide, du Sud, et de difficulté croissante", () => {
    const concepts = new Set(loadPack().concepts.keys());
    expect(checkXeOmData(data, concepts)).toEqual([]);
    expect(data.routes.length).toBeGreaterThanOrEqual(6);
    expect(data.routes.length).toBeLessThanOrEqual(10);
    const levels = data.routes.map((r) => r.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(data.routes.every((r) => r.reviewed === false)).toBe(true);

    const variants = JSON.parse(readFileSync(join(root, "lexical-variants.json"), "utf8")) as { entries: LexicalVariantEntry[] };
    const lint = createSouthLinter(variants.entries);
    const texts = [...data.routes.flatMap((r) => r.instructions.map((i) => i.vi)), ...data.maps.flatMap((m) => m.landmarks.map((l) => l.vi))];
    for (const text of texts) {
      expect(text).toBe(text.normalize("NFC"));
      expect(hasBlocking(lint(text)), text).toBe(false);
    }
    // « quẹo » (Sud, familier) domine ; « rẽ » reste possible.
    const all = texts.join(" ");
    expect((all.match(/quẹo/gi) ?? []).length).toBeGreaterThan((all.match(/rẽ/gi) ?? []).length);
  });

  it("« qua cầu » passe vraiment un pont", () => {
    for (const r of data.routes) {
      const m = data.maps.find((x) => x.id === r.map)!;
      const path = xeOmPath(r);
      r.instructions.forEach((instruction, i) => {
        if (/qua cầu/.test(instruction.vi)) expect(xeOmIsBridge(m, path[i]!.at, path[i + 1]!.at), `${r.id} #${i + 1}`).toBe(true);
      });
    }
  });
});

describe("pickXeOmRoutes", () => {
  it("jeu libre : déterministe, niveaux croissants, sans doublon", () => {
    const a = pickXeOmRoutes(data, "s1");
    expect(pickXeOmRoutes(data, "s1")).toEqual(a);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((r) => r.id)).size).toBe(3);
    for (let i = 1; i < a.length; i++) expect(a[i]!.level).toBeGreaterThanOrEqual(a[i - 1]!.level);
  });

  it("séance : privilégie les itinéraires qui recoupent le pool", () => {
    const pool = [{ id: "c_x", vi: "cây xăng", type: "word", gloss: { fr: "" }, audio: [], reviewed: false }] as Concept[];
    const picked = pickXeOmRoutes(data, "s", { count: 1, pool });
    expect(picked[0]!.instructions.some((i) => i.vi.includes("cây xăng"))).toBe(true);
  });
});

describe("partie", () => {
  it("valide les gestes, transcription après deux ratés, indice après trois, score au premier coup", () => {
    const other = route([["Quẹo phải.", "right"], ["Dừng lại.", "stop"]], { at: [0, 0], heading: "S" });
    let state = startXeOm([simple, other]);
    expect(currentXeOmInstruction(state)?.action).toBe("straight");
    expect(xeOmShowTranscript(state, false)).toBe(false);
    expect(xeOmShowTranscript(state, true)).toBe(true);

    // Consigne 1 : deux ratés puis juste.
    state = moveXeOm(state, "left").state;
    let step = moveXeOm(state, "right");
    expect(step.outcome).toEqual({ kind: "wrong", misses: 2 });
    state = step.state;
    expect(state.pose.at).toEqual([0, 2]); // un raté ne bouge pas
    expect(xeOmShowTranscript(state, false)).toBe(true);
    expect(xeOmHint(state)).toBeNull();
    state = moveXeOm(state, "stop").state;
    expect(xeOmHint(state)).toBe("straight");
    step = moveXeOm(state, "straight");
    expect(step.outcome).toEqual({ kind: "moved", firstTry: false });
    state = step.state;
    expect(state.trail).toEqual([[0, 2], [0, 1]]);
    expect(state.misses).toBe(0);

    state = moveXeOm(state, "right").state;
    step = moveXeOm(state, "stop");
    expect(step.outcome).toEqual({ kind: "arrived", firstTry: true, routeIndex: 0 });
    state = step.state;
    expect(state.routeIndex).toBe(1);
    expect(state.pose).toEqual({ at: [0, 0], heading: "S" });

    // Deuxième itinéraire : un raté puis juste (4 points), puis stop.
    state = moveXeOm(state, "straight").state;
    state = moveXeOm(state, "right").state;
    state = moveXeOm(state, "stop").state;
    expect(isXeOmOver(state)).toBe(true);
    expect(moveXeOm(state, "stop").outcome).toEqual({ kind: "over" });
    expect(xeOmResult(state)).toEqual({ correct: 3, total: 5, points: 10 * 3 + 4 });
  });

  it("partie parfaite sur le pack → réussite pour le moteur", () => {
    const routes = pickXeOmRoutes(data, "perfect");
    let state = startXeOm(routes);
    while (!isXeOmOver(state)) state = moveXeOm(state, currentXeOmInstruction(state)!.action).state;
    const { correct, total } = xeOmResult(state);
    expect(correct).toBe(total);
    const ex: Exercise = { type: "game", game: "xe_om", stepIndex: 0, conceptIds: [], explain: null };
    expect(evaluate(ex, { kind: "game", correct, total })).toMatchObject({ correct: true, graded: true });
    expect(XE_OM_ACTIONS).toHaveLength(4);
  });
});
