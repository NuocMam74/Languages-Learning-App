import { seededRandom, shuffle } from "../engine.ts";
import { normalizeAnswer } from "../text.ts";
import type { Concept, ConceptId, Localized } from "../types.ts";
import type { GameResult } from "./common.ts";

/**
 * Xe ôm (moto-taxi, spec §5.6.3) : le chauffeur donne une consigne orale à la
 * fois (« Quẹo phải… », « Dừng lại ở chợ »), le joueur trace l'itinéraire sur
 * une carte en grille en choisissant, à chaque carrefour, gauche / tout droit /
 * droite / arrêt.
 *
 * Logique pure et déterministe : la carte, la machine à états de l'itinéraire,
 * la validation des gestes et le score. Pas de vies : une erreur fait
 * réécouter, la transcription apparaît après deux ratés, on n'est jamais bloqué.
 */

export type XeOmAction = "left" | "right" | "straight" | "stop";
export type XeOmHeading = "N" | "E" | "S" | "W";
/** [x, y] : x vers l'est, y vers le sud. */
export type XeOmCell = readonly [number, number];
export type XeOmIcon = "market" | "school" | "hospital" | "pagoda" | "cafe" | "pho" | "park" | "station" | "gas";

export interface XeOmLandmark {
  id: string;
  /** Pâté de maisons ; ses 4 coins sont les carrefours « au » repère. */
  block: XeOmCell;
  vi: string;
  gloss: Localized;
  concept?: ConceptId;
  icon: XeOmIcon;
}

export interface XeOmMap {
  id: string;
  /** Carrefours par rangée. */
  cols: number;
  /** Carrefours par colonne. */
  rows: number;
  canals: XeOmCell[];
  landmarks: XeOmLandmark[];
}

export interface XeOmInstruction {
  vi: string;
  action: XeOmAction;
  landmark?: string;
  gloss: Localized;
  audio?: string;
}

export interface XeOmRoute {
  id: string;
  map: string;
  level: number;
  start: { at: XeOmCell; heading: XeOmHeading };
  concepts?: ConceptId[];
  instructions: XeOmInstruction[];
  reviewed: boolean;
}

export interface XeOmData {
  version: 1;
  maps: XeOmMap[];
  routes: XeOmRoute[];
  reviewed: boolean;
}

export const XE_OM_ACTIONS: readonly XeOmAction[] = ["left", "straight", "right", "stop"];
/** Ratés sur une même consigne avant d'afficher la transcription. */
export const XE_OM_TRANSCRIPT_AFTER = 2;
/** Ratés avant de montrer la bonne direction (on ne reste jamais coincé). */
export const XE_OM_HINT_AFTER = 3;
export const XE_OM_DEFAULT_ROUTES = 3;

// ---------------------------------------------------------------------------
// Géométrie

const HEADINGS: readonly XeOmHeading[] = ["N", "E", "S", "W"];
const STEP: Record<XeOmHeading, XeOmCell> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export interface XeOmPose {
  at: XeOmCell;
  heading: XeOmHeading;
}

export function turnHeading(heading: XeOmHeading, action: XeOmAction): XeOmHeading {
  const i = HEADINGS.indexOf(heading);
  if (action === "left") return HEADINGS[(i + 3) % 4] ?? heading;
  if (action === "right") return HEADINGS[(i + 1) % 4] ?? heading;
  return heading;
}

/** Angle d'affichage d'un cap (degrés, 0 = nord, sens horaire). */
export function headingDegrees(heading: XeOmHeading): number {
  return HEADINGS.indexOf(heading) * 90;
}

/** Pose après l'action : tourner puis rouler jusqu'au carrefour suivant ; « stop » ne bouge pas. */
export function applyXeOmAction(pose: XeOmPose, action: XeOmAction): XeOmPose {
  if (action === "stop") return pose;
  const heading = turnHeading(pose.heading, action);
  const [dx, dy] = STEP[heading];
  return { at: [pose.at[0] + dx, pose.at[1] + dy], heading };
}

export function insideXeOmMap(map: Pick<XeOmMap, "cols" | "rows">, [x, y]: XeOmCell): boolean {
  return x >= 0 && y >= 0 && x < map.cols && y < map.rows;
}

export function sameCell(a: XeOmCell, b: XeOmCell): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Le carrefour est-il un coin du pâté du repère ? */
export function landmarkTouches(landmark: Pick<XeOmLandmark, "block">, [x, y]: XeOmCell): boolean {
  const [bx, by] = landmark.block;
  return (x === bx || x === bx + 1) && (y === by || y === by + 1);
}

/** Un tronçon entre deux carrefours voisins longe-t-il un canal des deux côtés (= un pont) ? */
export function xeOmIsBridge(map: Pick<XeOmMap, "canals">, from: XeOmCell, to: XeOmCell): boolean {
  const canal = (bx: number, by: number) => map.canals.some(([cx, cy]) => cx === bx && cy === by);
  const [x1, y1] = from;
  const [x2, y2] = to;
  if (y1 === y2 && Math.abs(x1 - x2) === 1) {
    const bx = Math.min(x1, x2);
    return canal(bx, y1 - 1) && canal(bx, y1);
  }
  if (x1 === x2 && Math.abs(y1 - y2) === 1) {
    const by = Math.min(y1, y2);
    return canal(x1 - 1, by) && canal(x1, by);
  }
  return false;
}

/** Carrefour visé par chaque action depuis la pose (null si hors carte). « stop » = le carrefour actuel. */
export function xeOmTargets(map: Pick<XeOmMap, "cols" | "rows">, pose: XeOmPose): Record<XeOmAction, XeOmCell | null> {
  const out = {} as Record<XeOmAction, XeOmCell | null>;
  for (const action of XE_OM_ACTIONS) {
    const next = applyXeOmAction(pose, action).at;
    out[action] = insideXeOmMap(map, next) ? next : null;
  }
  return out;
}

/** Toucher un carrefour de la carte → l'action correspondante (null si ce n'est ni le carrefour actuel ni un voisin atteignable). */
export function xeOmActionForCell(map: Pick<XeOmMap, "cols" | "rows">, pose: XeOmPose, cell: XeOmCell): XeOmAction | null {
  const targets = xeOmTargets(map, pose);
  return XE_OM_ACTIONS.find((a) => targets[a] !== null && sameCell(targets[a] as XeOmCell, cell)) ?? null;
}

/** Poses successives d'un itinéraire joué sans faute : [départ, après consigne 1, …]. */
export function xeOmPath(route: XeOmRoute): XeOmPose[] {
  const poses: XeOmPose[] = [{ at: route.start.at, heading: route.start.heading }];
  for (const instruction of route.instructions) poses.push(applyXeOmAction(poses.at(-1) as XeOmPose, instruction.action));
  return poses;
}

// ---------------------------------------------------------------------------
// Contrôles de contenu (scripts/validate-content.ts)

export function checkXeOmData(data: XeOmData, knownConcepts?: ReadonlySet<ConceptId>): string[] {
  const issues: string[] = [];
  const maps = new Map<string, XeOmMap>();
  for (const map of data.maps) {
    if (maps.has(map.id)) issues.push(`carte ${map.id} : identifiant en double`);
    maps.set(map.id, map);
    const blocks = { cols: map.cols - 1, rows: map.rows - 1 };
    const taken = new Set<string>();
    for (const cell of map.canals) {
      if (!insideXeOmMap(blocks, cell)) issues.push(`carte ${map.id} : canal hors carte [${cell.join(", ")}]`);
      taken.add(cell.join(","));
    }
    const ids = new Set<string>();
    for (const landmark of map.landmarks) {
      const where = `carte ${map.id}, repère ${landmark.id}`;
      if (ids.has(landmark.id)) issues.push(`${where} : identifiant en double`);
      ids.add(landmark.id);
      if (!insideXeOmMap(blocks, landmark.block)) issues.push(`${where} : pâté hors carte`);
      if (taken.has(landmark.block.join(","))) issues.push(`${where} : pâté déjà occupé (canal ou autre repère)`);
      taken.add(landmark.block.join(","));
      if (landmark.concept && knownConcepts && !knownConcepts.has(landmark.concept)) issues.push(`${where} : concept inconnu ${landmark.concept}`);
    }
  }

  const routeIds = new Set<string>();
  for (const route of data.routes) {
    const where = `itinéraire ${route.id}`;
    if (routeIds.has(route.id)) issues.push(`${where} : identifiant en double`);
    routeIds.add(route.id);
    const map = maps.get(route.map);
    if (!map) {
      issues.push(`${where} : carte inconnue ${route.map}`);
      continue;
    }
    for (const id of route.concepts ?? []) if (knownConcepts && !knownConcepts.has(id)) issues.push(`${where} : concept inconnu ${id}`);
    if (!insideXeOmMap(map, route.start.at)) issues.push(`${where} : départ hors carte`);

    const last = route.instructions.length - 1;
    route.instructions.forEach((instruction, i) => {
      if (instruction.action === "stop" && i !== last) issues.push(`${where}, consigne ${i + 1} : « stop » avant la fin`);
      if (i === last && instruction.action !== "stop") issues.push(`${where} : la dernière consigne doit être « stop »`);
    });

    let pose: XeOmPose = { at: route.start.at, heading: route.start.heading };
    for (const [i, instruction] of route.instructions.entries()) {
      if (instruction.landmark) {
        const landmark = map.landmarks.find((l) => l.id === instruction.landmark);
        if (!landmark) issues.push(`${where}, consigne ${i + 1} : repère inconnu ${instruction.landmark}`);
        else if (!landmarkTouches(landmark, pose.at)) {
          issues.push(`${where}, consigne ${i + 1} : « ${landmark.vi} » n'est pas au carrefour [${pose.at.join(", ")}]`);
        } else if (!normalizeAnswer(instruction.vi).includes(normalizeAnswer(landmark.vi))) {
          issues.push(`${where}, consigne ${i + 1} : la consigne ne nomme pas « ${landmark.vi} »`);
        }
      }
      const next = applyXeOmAction(pose, instruction.action);
      if (!insideXeOmMap(map, next.at)) {
        issues.push(`${where}, consigne ${i + 1} : sort de la carte`);
        break;
      }
      pose = next;
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Choix des itinéraires

/** Recoupement d'un itinéraire avec un pool de concepts : concepts déclarés ou formes lues dans les consignes. */
export function xeOmRouteOverlap(route: XeOmRoute, map: XeOmMap | undefined, pool: readonly Concept[]): number {
  const text = ` ${route.instructions.map((i) => normalizeAnswer(i.vi)).join(" ")} `;
  const declared = new Set([...(route.concepts ?? []), ...(map?.landmarks.flatMap((l) => (l.concept ? [l.concept] : [])) ?? [])]);
  return pool.filter((c) => declared.has(c.id) || (normalizeAnswer(c.vi) !== "" && text.includes(` ${normalizeAnswer(c.vi)} `))).length;
}

/**
 * Itinéraires d'une partie, de difficulté croissante. Sans pool (jeu libre) :
 * un itinéraire tiré dans chaque tranche de niveaux. Avec pool (séance) : ceux
 * qui recoupent le plus les concepts de la leçon, à égalité les plus faciles.
 */
export function pickXeOmRoutes(data: XeOmData, seed: string, { count = XE_OM_DEFAULT_ROUTES, pool }: { count?: number; pool?: readonly Concept[] } = {}): XeOmRoute[] {
  const rand = seededRandom(`xe_om:${seed}`);
  const maps = new Map(data.maps.map((m) => [m.id, m]));
  const playable = data.routes.filter((r) => maps.has(r.map));
  const n = Math.max(0, Math.min(count, playable.length));
  if (n === 0) return [];
  const byLevel = (a: XeOmRoute, b: XeOmRoute) => a.level - b.level;

  if (pool && pool.length > 0) {
    const scored = shuffle(playable, rand).map((route) => ({ route, overlap: xeOmRouteOverlap(route, maps.get(route.map), pool) }));
    scored.sort((a, b) => b.overlap - a.overlap || a.route.level - b.route.level);
    return scored.slice(0, n).map((s) => s.route).sort(byLevel);
  }

  const sorted = [...playable].sort(byLevel);
  const out: XeOmRoute[] = [];
  for (let k = 0; k < n; k++) {
    const from = Math.floor((k * sorted.length) / n);
    const to = Math.floor(((k + 1) * sorted.length) / n);
    const band = sorted.slice(from, Math.max(to, from + 1));
    out.push(band[Math.floor(rand() * band.length)] as XeOmRoute);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Partie

export interface XeOmAnswer {
  route: number;
  instruction: number;
  /** Juste du premier coup : seule réussite notée. */
  firstTry: boolean;
  misses: number;
}

export interface XeOmState {
  routes: XeOmRoute[];
  routeIndex: number;
  instructionIndex: number;
  pose: XeOmPose;
  /** Carrefours parcourus sur l'itinéraire courant (départ compris). */
  trail: XeOmCell[];
  /** Ratés sur la consigne courante. */
  misses: number;
  answers: XeOmAnswer[];
}

export type XeOmMoveOutcome =
  | { kind: "wrong"; misses: number }
  | { kind: "moved"; firstTry: boolean }
  /** « stop » juste : itinéraire terminé (la partie peut l'être aussi). */
  | { kind: "arrived"; firstTry: boolean; routeIndex: number }
  | { kind: "over" };

function startPose(route: XeOmRoute | undefined): XeOmPose {
  return route ? { at: route.start.at, heading: route.start.heading } : { at: [0, 0], heading: "N" };
}

export function startXeOm(routes: XeOmRoute[]): XeOmState {
  const first = routes[0];
  const pose = startPose(first);
  return { routes, routeIndex: 0, instructionIndex: 0, pose, trail: [pose.at], misses: 0, answers: [] };
}

export function isXeOmOver(state: XeOmState): boolean {
  return state.routeIndex >= state.routes.length;
}

export function currentXeOmRoute(state: XeOmState): XeOmRoute | null {
  return state.routes[state.routeIndex] ?? null;
}

export function currentXeOmInstruction(state: XeOmState): XeOmInstruction | null {
  return currentXeOmRoute(state)?.instructions[state.instructionIndex] ?? null;
}

/** Transcription visible : mode silencieux, ou après deux ratés. */
export function xeOmShowTranscript(state: XeOmState, silent: boolean): boolean {
  return silent || state.misses >= XE_OM_TRANSCRIPT_AFTER;
}

/** Direction à souligner pour débloquer le joueur (après trois ratés), sinon null. */
export function xeOmHint(state: XeOmState): XeOmAction | null {
  return state.misses >= XE_OM_HINT_AFTER ? (currentXeOmInstruction(state)?.action ?? null) : null;
}

/** Joue une action à la consigne courante. Un raté ne déplace pas la moto. */
export function moveXeOm(state: XeOmState, action: XeOmAction): { state: XeOmState; outcome: XeOmMoveOutcome } {
  const route = currentXeOmRoute(state);
  const instruction = currentXeOmInstruction(state);
  if (!route || !instruction) return { state, outcome: { kind: "over" } };

  if (action !== instruction.action) {
    const misses = state.misses + 1;
    return { state: { ...state, misses }, outcome: { kind: "wrong", misses } };
  }

  const firstTry = state.misses === 0;
  const answers = [...state.answers, { route: state.routeIndex, instruction: state.instructionIndex, firstTry, misses: state.misses }];
  if (action === "stop" || state.instructionIndex + 1 >= route.instructions.length) {
    const routeIndex = state.routeIndex + 1;
    const pose = startPose(state.routes[routeIndex]);
    return {
      state: { ...state, routeIndex, instructionIndex: 0, pose, trail: [pose.at], misses: 0, answers },
      outcome: { kind: "arrived", firstTry, routeIndex: state.routeIndex },
    };
  }
  const pose = applyXeOmAction(state.pose, action);
  return {
    state: { ...state, instructionIndex: state.instructionIndex + 1, pose, trail: [...state.trail, pose.at], misses: 0, answers },
    outcome: { kind: "moved", firstTry },
  };
}

/** Points : 10 du premier coup, 4 au deuxième essai, 0 ensuite. */
export function xeOmPoints(answer: XeOmAnswer): number {
  if (answer.firstTry) return 10;
  return answer.misses === 1 ? 4 : 0;
}

/** Résultat pour le moteur : consignes justes du premier coup / consignes jouées. */
export function xeOmResult(state: XeOmState): GameResult {
  return {
    correct: state.answers.filter((a) => a.firstTry).length,
    total: state.answers.length,
    points: state.answers.reduce((sum, a) => sum + xeOmPoints(a), 0),
  };
}
