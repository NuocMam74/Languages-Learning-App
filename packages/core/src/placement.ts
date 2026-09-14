import { ContentError, seededRandom, shuffle, type Exercise } from "./engine.ts";
import { buildReviewExercise } from "./review.ts";
import { nextLesson } from "./session.ts";
import { newCard, review, type SrsCard } from "./srs.ts";
import type { ConceptId, ContentIndex, Curriculum, Lesson, LessonId } from "./types.ts";

/**
 * Mini-test de placement (spec §4.1.4) : 90 s, 8 items adaptatifs, audio seul.
 * Les items sont des données (content/<pack>/placement.json) qui ne référencent
 * que des concepts existants ; le moteur choisit l'item suivant selon les réponses.
 */

export type PlacementSkill = "tone" | "comprehension" | "vocab";

export interface PlacementItem {
  id: string;
  skill: PlacementSkill;
  /** 1 (facile) à 3 (difficile). */
  difficulty: 1 | 2 | 3;
  concept: ConceptId;
  /** Concepts dont le sens (compréhension) ou la forme (vocabulaire) sert de piège. */
  distractors?: ConceptId[];
}

export interface PlacementSpec {
  pack: string;
  durationSeconds: number;
  /** Compétence de chaque position du test, dans l'ordre. */
  slots: PlacementSkill[];
  items: PlacementItem[];
  /** Seuils de score pondéré (0–1) : niveau = plus haut seuil atteint. */
  levels: { level: number; minScore: number }[];
  reviewed: boolean;
}

export interface PlacementAnswer {
  itemId: string;
  correct: boolean;
}

export const PLACEMENT_START_DIFFICULTY = 2;

function targetDifficulty(spec: PlacementSpec, answers: readonly PlacementAnswer[]): number {
  let d = PLACEMENT_START_DIFFICULTY;
  for (const a of answers) {
    if (!spec.items.some((i) => i.id === a.itemId)) continue;
    d = a.correct ? Math.min(3, d + 1) : Math.max(1, d - 1);
  }
  return d;
}

/** Item suivant (adaptatif) ou null quand le test est complet. */
export function nextPlacementItem(spec: PlacementSpec, answers: readonly PlacementAnswer[]): PlacementItem | null {
  const skill = spec.slots[answers.length];
  if (!skill) return null;
  const used = new Set(answers.map((a) => a.itemId));
  const wanted = targetDifficulty(spec, answers);
  const pool = spec.items.filter((i) => i.skill === skill && !used.has(i.id));
  const fallback = spec.items.filter((i) => !used.has(i.id));
  const candidates = pool.length > 0 ? pool : fallback;
  let best: PlacementItem | null = null;
  for (const item of candidates) {
    if (!best || Math.abs(item.difficulty - wanted) < Math.abs(best.difficulty - wanted)) best = item;
  }
  return best;
}

export function buildPlacementExercise(content: ContentIndex, item: PlacementItem, seed: string, stepIndex = 0): Exercise {
  const target = content.concepts.get(item.concept);
  if (!target) throw new ContentError(`Placement ${item.id} : concept inconnu ${item.concept}`);
  const rand = seededRandom(`${seed}:${item.id}`);

  switch (item.skill) {
    case "tone":
      // Audio natif requis : la synthèse vocale n'est jamais utilisée pour les tons.
      return buildReviewExercise(content, item.concept, seed, "tone_identify", { stepIndex, allowTtsTone: false });

    case "comprehension": {
      const others = (item.distractors ?? []).map((id) => {
        const c = content.concepts.get(id);
        if (!c) throw new ContentError(`Placement ${item.id} : distracteur inconnu ${id}`);
        return c;
      });
      const picks = shuffle([target, ...others], rand);
      const options = picks.map((c, i) => ({ id: `g${i}`, label: c.gloss }));
      return {
        type: "listen_pick_text", stepIndex, conceptIds: [target.id], explain: target.note ?? null,
        audio: target, options, answerId: `g${picks.indexOf(target)}`,
      };
    }

    case "vocab": {
      const others = (item.distractors ?? []).flatMap((id) => {
        const c = content.concepts.get(id);
        return c ? [c] : [];
      });
      const withImages = target.image !== undefined && others.length > 0 && others.every((c) => c.image !== undefined);
      const picks = shuffle([target, ...others], rand);
      if (withImages) {
        const options = picks.map((c) => ({ id: c.id, conceptId: c.id, text: c.vi, ...(c.image ? { image: c.image } : {}) }));
        return { type: "listen_pick_image", stepIndex, conceptIds: [target.id], explain: target.note ?? null, audio: target, options, answerId: target.id };
      }
      const options = picks.map((c, i) => ({ id: `v${i}`, text: c.vi }));
      return {
        type: "listen_pick_text", stepIndex, conceptIds: [target.id], explain: target.note ?? null,
        audio: target, options, answerId: `v${picks.indexOf(target)}`,
      };
    }
  }
}

export interface PlacementResult {
  /** 0 (débutant) à 3. */
  levelEstimate: number;
  correct: number;
  total: number;
  /** Score pondéré par la difficulté, 0–1. */
  score: number;
  knownConceptIds: ConceptId[];
}

/**
 * Score pondéré par la difficulté ; les positions non atteintes (temps écoulé)
 * comptent comme non réussies, à la difficulté de départ.
 */
export function scorePlacement(spec: PlacementSpec, answers: readonly PlacementAnswer[]): PlacementResult {
  const byId = new Map(spec.items.map((i) => [i.id, i]));
  let earned = 0;
  let possible = 0;
  let correct = 0;
  const known: ConceptId[] = [];
  for (const a of answers.slice(0, spec.slots.length)) {
    const item = byId.get(a.itemId);
    if (!item) continue;
    possible += item.difficulty;
    if (a.correct) {
      earned += item.difficulty;
      correct++;
      if (!known.includes(item.concept)) known.push(item.concept);
    }
  }
  possible += Math.max(0, spec.slots.length - answers.length) * PLACEMENT_START_DIFFICULTY;
  const score = possible === 0 ? 0 : earned / possible;
  const levelEstimate = [...spec.levels].sort((a, b) => b.minScore - a.minScore).find((lv) => score >= lv.minScore)?.level ?? 0;
  return { levelEstimate, correct, total: spec.slots.length, score, knownConceptIds: known };
}

/** Leçons existantes d'une unité publiée, dans l'ordre du cursus. */
function unitLessons(curriculum: Curriculum, lessons: ReadonlyMap<LessonId, Lesson>, unitIndex: number): Lesson[] {
  const unit = curriculum.units[unitIndex];
  if (!unit || unit.status !== "available") return [];
  return unit.lessons.flatMap((id) => lessons.get(id) ?? []);
}

/**
 * Point d'entrée : niveau 0 → première leçon ; niveau ≥ 1 → première leçon de
 * la 2e unité si elle est publiée, sinon la leçon disponible suivante.
 */
export function resolveEntryLesson(content: ContentIndex, levelEstimate: number, path: string | null = null): Lesson | null {
  const first = nextLesson(content.curriculum, content.lessons, new Set(), path);
  if (levelEstimate <= 0 || !first) return first;
  const unit2 = unitLessons(content.curriculum, content.lessons, 1)[0];
  if (unit2) return unit2;
  const ordered = content.curriculum.units.flatMap((_, i) => unitLessons(content.curriculum, content.lessons, i));
  const idx = ordered.findIndex((l) => l.id === first.id);
  return ordered[idx + 1] ?? first;
}

/** Leçons situées avant `lessonId` dans l'ordre du cursus (sautées par le placement). */
export function lessonsBefore(curriculum: Curriculum, lessonId: LessonId): LessonId[] {
  const ordered = curriculum.units.flatMap((u) => u.lessons);
  const idx = ordered.indexOf(lessonId);
  return idx <= 0 ? [] : ordered.slice(0, idx);
}

/** Cartes SRS de départ pour les concepts reconnus (note « good »). */
export function placementCards(knownConceptIds: readonly ConceptId[], existing: ReadonlySet<ConceptId>, now: Date): SrsCard[] {
  return knownConceptIds.filter((id) => !existing.has(id)).map((id) => review(newCard(id, now), "good", now));
}

/** Contrôles du fichier de placement (utilisés par le validateur de contenu). */
export function checkPlacement(content: ContentIndex, spec: PlacementSpec): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of spec.items) {
    if (ids.has(item.id)) errors.push(`Item ${item.id} en double`);
    ids.add(item.id);
    if (!content.concepts.has(item.concept)) errors.push(`${item.id} : concept inconnu ${item.concept}`);
    for (const d of item.distractors ?? []) {
      if (!content.concepts.has(d)) errors.push(`${item.id} : distracteur inconnu ${d}`);
      if (d === item.concept) errors.push(`${item.id} : la cible figure dans les distracteurs`);
    }
    if (item.skill !== "tone" && (item.distractors ?? []).length === 0) errors.push(`${item.id} : distracteurs requis`);
    if (item.skill === "tone") {
      const c = content.concepts.get(item.concept);
      if (c && (c.type !== "word" || c.vi.includes(" "))) errors.push(`${item.id} : un item de ton doit porter sur un mot d'une syllabe`);
      if (c && !c.audio.some((a) => a.source === "native")) errors.push(`${item.id} : audio natif requis pour un item de ton`);
    }
  }
  for (const skill of new Set(spec.slots)) {
    const need = spec.slots.filter((s) => s === skill).length;
    const have = spec.items.filter((i) => i.skill === skill).length;
    if (have < need) errors.push(`Compétence ${skill} : ${have} item(s) pour ${need} position(s)`);
  }
  return errors;
}
