import { ContentError, seededRandom, shuffle, type Exercise } from "./engine.ts";
import { contentMedia, hasNativeAudio, type PlayableOptions } from "./media.ts";
import { buildReviewExercise } from "./review.ts";
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

/** Le placement n'est proposé qu'à partir de ce nombre d'items jouables (contrat phase5 §1). */
export const PLACEMENT_MIN_PLAYABLE_ITEMS = 6;

/**
 * Item jouable : il exige un **enregistrement natif**, quelle que soit sa compétence.
 *
 * Le placement est « audio uniquement » (spec §4.1.4) : ses trois familles d'items sont des
 * exercices d'écoute (`tone_identify`, `listen_pick_text`, `listen_pick_image`, toujours avec
 * `audio`). La synthèse vocale est un repli acceptable pour *réviser* un mot déjà rencontré ; elle
 * ne peut pas servir à **situer** quelqu'un qui n'a encore rien appris.
 *
 * Auparavant seuls les items de ton exigeaient l'audio. Conséquence observée sur l'app déployée
 * (aucun enregistrement livré) : un test d'écoute muet, répondu au hasard, qui plaçait l'apprenant
 * plusieurs unités plus loin — et `lessonsBefore` comptait alors toutes les leçons sautées comme
 * réussies, y compris des tests d'unité que personne n'avait passés.
 *
 * `toneFallback` (build de bêta, `VITE_TTS_TONE_FALLBACK`) accepte la synthèse partout : c'est un
 * choix explicite pour rendre l'app jouable avant les enregistrements.
 */
export function isPlacementItemPlayable(content: ContentIndex, item: PlacementItem, options: PlayableOptions = {}): boolean {
  if (options.toneFallback) return true;
  const concept = content.concepts.get(item.concept);
  return concept !== undefined && hasNativeAudio(concept, options.media === undefined ? contentMedia(content) : options.media);
}

/** Spécification réduite aux items jouables ; null si moins de PLACEMENT_MIN_PLAYABLE_ITEMS (placement passé). */
export function playablePlacement(content: ContentIndex, spec: PlacementSpec, options: PlayableOptions = {}): PlacementSpec | null {
  const items = spec.items.filter((i) => isPlacementItemPlayable(content, i, options));
  return items.length >= PLACEMENT_MIN_PLAYABLE_ITEMS ? { ...spec, items } : null;
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

/** Unité d'entrée par niveau estimé 0..3 (contrat phase5 §2) : numéro d'unité cible. */
export const PLACEMENT_ENTRY_UNITS = [1, 3, 5, 7] as const;

/** Numéro d'une unité (`vi-south.u05` → 5), sinon sa position (1-based) dans le cursus. */
function unitNumber(unitId: string, position: number): number {
  const match = /u(\d+)$/.exec(unitId);
  return match ? Number(match[1]) : position + 1;
}

/**
 * Point d'entrée : niveau 0..3 → début de u01 / u03 / u05 / u07, première unité publiée (avec
 * leçons) de numéro ≥ cible. Aucune unité assez loin : la dernière unité publiée. Les unités
 * antérieures sont « sautées » (voir lessonsBefore). `path` est conservé pour compatibilité.
 */
export function resolveEntryLesson(content: ContentIndex, levelEstimate: number, _path: string | null = null): Lesson | null {
  const level = Math.max(0, Math.min(PLACEMENT_ENTRY_UNITS.length - 1, Math.floor(levelEstimate)));
  const target = PLACEMENT_ENTRY_UNITS[level] ?? 1;
  const units = content.curriculum.units
    .map((unit, position) => ({ unit, number: unitNumber(unit.id, position), first: unit.lessons.map((id) => content.lessons.get(id)).find((l) => l !== undefined) }))
    .filter((u): u is typeof u & { first: Lesson } => u.unit.status === "available" && u.first !== undefined);
  const entry = units.find((u) => u.number >= target) ?? units.at(-1);
  return entry?.first ?? null;
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
