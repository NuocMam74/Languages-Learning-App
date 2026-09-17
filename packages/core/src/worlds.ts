import { isUnitAvailable, isUnitPassed, type ProgressSets } from "./session.ts";
import type { Curriculum, Lesson, LessonId, Localized, UnitId } from "./types.ts";

/**
 * Mondes (contrat phase11 §1) : une lecture « carte de jeu » du cursus, sans rien y ajouter.
 *
 * Un monde **est** un bloc du cursus (`curriculum.blocks`) — il en existe six, de « L'oreille » à
 * « Raconter ». Chacun contient ses unités, chaque unité ses leçons, et trois blocs portent un
 * certificat (A0, A1, A2) : les mondes 2, 4 et 6 se terminent donc par un examen.
 *
 * Aucune donnée nouvelle, aucune règle de progression nouvelle : le déverrouillage reste celui du
 * graphe d'unités (`isUnitAvailable`) et de la maîtrise des leçons (contrat phase10 §3). Ce module
 * ne fait que **grouper et nommer** ce qui existe, pour qu'on puisse l'afficher comme une carte.
 */

export interface World {
  id: string;
  title: Localized;
  units: UnitId[];
  certificate?: "A0" | "A1" | "A2";
  /** Rang à partir de 1 : « Monde 1 ». */
  number: number;
}

export function worlds(curriculum: Curriculum): World[] {
  return curriculum.blocks.map((block, index) => ({
    id: block.id,
    title: block.title,
    units: [...block.units],
    ...(block.certificate ? { certificate: block.certificate } : {}),
    number: index + 1,
  }));
}

export interface WorldState {
  world: World;
  /** Au moins une unité du monde est ouverte : on peut y entrer. */
  unlocked: boolean;
  /** Toutes ses unités sont réussies. */
  complete: boolean;
  lessonsPassed: number;
  lessonsTotal: number;
  unitsPassed: number;
  unitsTotal: number;
}

/** Leçons d'un monde, dans l'ordre du cursus. */
export function worldLessons(curriculum: Curriculum, world: World): LessonId[] {
  return world.units.flatMap((unitId) => curriculum.units.find((u) => u.id === unitId)?.lessons ?? []);
}

export function worldState(
  curriculum: Curriculum,
  lessons: ReadonlyMap<LessonId, Lesson>,
  world: World,
  progress: ProgressSets,
): WorldState {
  const passed = progress.passed ?? progress.completed;
  const units = world.units.filter((id) => curriculum.units.some((u) => u.id === id));
  const unitsPassed = units.filter((id) => isUnitPassed(curriculum, lessons, id, progress)).length;
  const all = worldLessons(curriculum, world);
  return {
    world,
    // « Ouvert » = une porte existe. On ne demande pas la première unité : un monde dont une unité
    // plus loin serait accessible resterait affiché comme entrable.
    unlocked: units.some((id) => isUnitAvailable(curriculum, lessons, id, progress)),
    complete: units.length > 0 && unitsPassed === units.length,
    lessonsPassed: all.filter((id) => passed.has(id)).length,
    lessonsTotal: all.length,
    unitsPassed,
    unitsTotal: units.length,
  };
}

export function worldStates(curriculum: Curriculum, lessons: ReadonlyMap<LessonId, Lesson>, progress: ProgressSets): WorldState[] {
  return worlds(curriculum).map((world) => worldState(curriculum, lessons, world, progress));
}

/** Identifiants des mondes terminés : ce que les récompenses regardent (contrat phase11 §3). */
export function completedWorlds(curriculum: Curriculum, lessons: ReadonlyMap<LessonId, Lesson>, progress: ProgressSets): string[] {
  return worldStates(curriculum, lessons, progress)
    .filter((state) => state.complete)
    .map((state) => state.world.id);
}

/** Monde d'une leçon, null si elle n'appartient à aucun bloc. */
export function worldOf(curriculum: Curriculum, lessonId: LessonId): World | null {
  const unit = curriculum.units.find((u) => u.lessons.includes(lessonId));
  if (!unit) return null;
  return worlds(curriculum).find((world) => world.units.includes(unit.id)) ?? null;
}

/** Monde où l'on en est : le premier ouvert et non terminé, sinon le dernier ouvert. */
export function currentWorld(states: readonly WorldState[]): World | null {
  return (states.find((s) => s.unlocked && !s.complete) ?? [...states].reverse().find((s) => s.unlocked))?.world ?? null;
}
