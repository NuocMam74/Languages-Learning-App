import { describe, expect, it } from "vitest";
import { loadPack } from "./testing/pack.ts";
import { completedWorlds, currentWorld, worldLessons, worldOf, worldStates, worlds } from "./worlds.ts";

/**
 * Mondes (contrat phase11 §1) : une lecture du cursus, pas une règle de progression nouvelle.
 * Ce qui est vérifié ici, c'est qu'ils ne mentent pas — ni sur ce qui est ouvert, ni sur ce qui
 * est terminé, ni sur ce qu'ils contiennent.
 */

const content = loadPack();
const { curriculum, lessons } = content;
const list = worlds(curriculum);
const all = (ids: readonly string[]) => new Set(ids);

describe("mondes : structure", () => {
  it("il y a un monde par bloc du cursus, numérotés à partir de 1", () => {
    expect(list).toHaveLength(curriculum.blocks.length);
    expect(list.map((w) => w.number)).toEqual(curriculum.blocks.map((_, i) => i + 1));
    expect(list.map((w) => w.id)).toEqual(curriculum.blocks.map((b) => b.id));
  });

  it("les mondes couvrent toutes les unités du cursus, sans doublon", () => {
    const fromWorlds = list.flatMap((w) => w.units);
    expect(new Set(fromWorlds).size).toBe(fromWorlds.length);
    expect(new Set(fromWorlds)).toEqual(new Set(curriculum.units.map((u) => u.id)));
  });

  it("les leçons d'un monde sont celles de ses unités, dans l'ordre", () => {
    const first = list[0]!;
    const expected = first.units.flatMap((id) => curriculum.units.find((u) => u.id === id)?.lessons ?? []);
    expect(worldLessons(curriculum, first)).toEqual(expected);
    // Toutes les leçons du cursus appartiennent à un monde.
    const total = list.reduce((sum, w) => sum + worldLessons(curriculum, w).length, 0);
    expect(total).toBe(curriculum.units.reduce((sum, u) => sum + u.lessons.length, 0));
  });

  it("trois mondes portent un certificat", () => {
    expect(list.filter((w) => w.certificate).map((w) => w.certificate)).toEqual(["A0", "A1", "A2"]);
  });

  it("retrouve le monde d'une leçon, et rien pour une leçon inconnue", () => {
    const lessonId = worldLessons(curriculum, list[0]!)[0]!;
    expect(worldOf(curriculum, lessonId)?.id).toBe(list[0]!.id);
    expect(worldOf(curriculum, "leçon-qui-n-existe-pas")).toBeNull();
  });
});

describe("mondes : avancement", () => {
  it("au départ, seul le premier monde est ouvert et aucun n'est terminé", () => {
    const states = worldStates(curriculum, lessons, { completed: new Set() });
    expect(states[0]?.unlocked).toBe(true);
    expect(states.slice(1).every((s) => !s.unlocked)).toBe(true);
    expect(states.every((s) => !s.complete)).toBe(true);
    expect(states.every((s) => s.lessonsPassed === 0)).toBe(true);
    expect(states[0]?.lessonsTotal).toBeGreaterThan(0);
    expect(completedWorlds(curriculum, lessons, { completed: new Set() })).toEqual([]);
    expect(currentWorld(states)?.id).toBe(list[0]!.id);
  });

  it("un monde entièrement réussi est terminé, et ouvre le suivant", () => {
    const first = list[0]!;
    const done = all(worldLessons(curriculum, first));
    const states = worldStates(curriculum, lessons, { completed: done, passed: done });
    expect(states[0]?.complete).toBe(true);
    expect(states[0]?.lessonsPassed).toBe(states[0]?.lessonsTotal);
    expect(states[1]?.unlocked).toBe(true);
    expect(completedWorlds(curriculum, lessons, { completed: done, passed: done })).toEqual([first.id]);
    // On en est maintenant au deuxième.
    expect(currentWorld(states)?.id).toBe(list[1]!.id);
  });

  it("terminé sans être réussi ne termine pas le monde", () => {
    const first = list[0]!;
    const done = all(worldLessons(curriculum, first));
    // Tout est allé au bout, rien n'est réussi (contrat phase10 §3).
    const states = worldStates(curriculum, lessons, { completed: done, passed: new Set() });
    expect(states[0]?.complete).toBe(false);
    expect(states[0]?.lessonsPassed).toBe(0);
    expect(completedWorlds(curriculum, lessons, { completed: done, passed: new Set() })).toEqual([]);
  });

  it("l'avancement d'un monde compte ses leçons réussies", () => {
    const first = list[0]!;
    const all0 = worldLessons(curriculum, first);
    const half = new Set(all0.slice(0, 3));
    const states = worldStates(curriculum, lessons, { completed: half, passed: half });
    expect(states[0]?.lessonsPassed).toBe(3);
    expect(states[0]?.complete).toBe(false);
    expect(states[0]?.unlocked).toBe(true);
  });
});
