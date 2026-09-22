import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildContentIndex, type ContentIndex, type RawPackFiles } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../scripts/lib/load-pack.ts";
import { db, favoriteId, ParloDB, setDb } from "./db.ts";
import { isFavorite, likedSteps, lessonsWithLikedSteps, listFavorites, stepPreview, useFavorites, viewFavorites } from "./favorites.ts";
import { exportLocalData } from "./learner.ts";

/**
 * Favoris (contrat phase18 §1). Ce qui est vérifié ici : aimer et retirer sont le même geste, un
 * favori désigne exactement ce qu'on a aimé, et un contenu qui change dessous ne fait rien
 * disparaître en silence.
 */

const raw: RawPackFiles = toRaw(readPackFiles("vi-south"));
const content: ContentIndex = buildContentIndex(raw);
const LESSON = "vi-south.u03.l03";
let dbName = "";

beforeEach(async () => {
  dbName = `parlo-fav-${Math.random().toString(36).slice(2)}`;
  setDb(new ParloDB(dbName));
  await db().open();
  await db().kv.put({ key: "activePack", value: "vi-south" });
  useFavorites.setState({ ids: new Set(), rows: [], loaded: false });
});

afterEach(async () => {
  await db().delete();
  setDb(null);
});

describe("aimer, retirer", () => {
  it("le même bouton fait les deux, et rend l'état d'après", async () => {
    const target = { lessonId: LESSON, stepIndex: 5 };
    expect(await useFavorites.getState().toggle(target, "vi-south")).toBe(true);
    expect(await isFavorite(target, "vi-south")).toBe(true);
    expect(await useFavorites.getState().toggle(target, "vi-south")).toBe(false);
    expect(await isFavorite(target, "vi-south")).toBe(false);
  });

  it("voyage dans l'export local RGPD : un droit d'accès ne peut pas oublier une table", async () => {
    await useFavorites.getState().toggle({ lessonId: LESSON, stepIndex: 5 }, "vi-south");
    const dump = await exportLocalData(new Date("2026-03-01T10:00:00Z"));
    expect(dump.tables.favorites).toHaveLength(1);
    expect(dump.tables.favorites[0]).toMatchObject({ lessonId: LESSON, stepIndex: 5 });
    // Comme les notes : un goût ne remonte jamais au serveur (minimisation, spec §14).
    expect(await db().outbox.count()).toBe(0);
  });

  it("une leçon et un de ses exercices sont deux favoris distincts", async () => {
    await useFavorites.getState().toggle({ lessonId: LESSON }, "vi-south");
    await useFavorites.getState().toggle({ lessonId: LESSON, stepIndex: 5 }, "vi-south");
    const rows = await listFavorites("vi-south");
    expect(rows.map((r) => r.id).sort()).toEqual([favoriteId(LESSON), favoriteId(LESSON, 5)].sort());
    expect(rows.map((r) => r.kind).sort()).toEqual(["lesson", "step"]);
  });

  it("les favoris d'une autre langue ne se mélangent pas", async () => {
    await useFavorites.getState().toggle({ lessonId: LESSON }, "vi-south");
    await useFavorites.getState().toggle({ lessonId: "es.u01.l01" }, "es");
    expect((await listFavorites("vi-south")).map((r) => r.lessonId)).toEqual([LESSON]);
    expect((await listFavorites("es")).map((r) => r.lessonId)).toEqual(["es.u01.l01"]);
  });

  it("on retrouve d'abord ce qu'on vient d'aimer", async () => {
    await db().favorites.bulkPut([
      { id: "a", packCode: "vi-south", kind: "lesson", lessonId: "a", addedAt: "2026-01-01T00:00:00Z" },
      { id: "b", packCode: "vi-south", kind: "lesson", lessonId: "b", addedAt: "2026-03-01T00:00:00Z" },
    ]);
    expect((await listFavorites("vi-south")).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("retrouver ce qu'on a aimé", () => {
  it("un exercice s'affiche par ce qu'il montre, pas par son type", () => {
    const lesson = content.lessons.get(LESSON)!;
    const build = lesson.steps.findIndex((s) => s.type === "build_sentence");
    expect(build).toBeGreaterThanOrEqual(0);
    // La phrase à assembler, telle qu'on la reconnaîtra dans la liste.
    expect(stepPreview(content, lesson.steps[build]!)).toBe("Dạ, con cảm ơn chú.");
  });

  it("un exercice disparu du contenu reste listé, et reste retirable", () => {
    const rows = [{ id: favoriteId(LESSON, 999), packCode: "vi-south", kind: "step" as const, lessonId: LESSON, stepIndex: 999, addedAt: "2026-01-01T00:00:00Z" }];
    const [view] = viewFavorites(content, rows);
    expect(view?.step).toBeNull();
    expect(view?.preview).toBe("");
    // Le titre de la leçon tient encore : le favori n'est pas une ligne vide.
    expect(view?.lessonTitle).not.toBeNull();
  });

  it("les exercices aimés se rejouent dans l'ordre de la leçon, pas dans celui des coups de cœur", () => {
    const rows = [7, 2, 5].map((stepIndex, i) => ({
      id: favoriteId(LESSON, stepIndex),
      packCode: "vi-south",
      kind: "step" as const,
      lessonId: LESSON,
      stepIndex,
      addedAt: `2026-0${i + 1}-01T00:00:00Z`,
    }));
    expect(likedSteps(rows, LESSON)).toEqual([2, 5, 7]);
  });

  it("les leçons concernées sortent dans l'ordre du cursus", () => {
    const rows = [
      { id: "x", packCode: "vi-south", kind: "step" as const, lessonId: "vi-south.u05.l01", stepIndex: 1, addedAt: "2026-01-01T00:00:00Z" },
      { id: "y", packCode: "vi-south", kind: "step" as const, lessonId: "vi-south.u01.l02", stepIndex: 1, addedAt: "2026-02-01T00:00:00Z" },
    ];
    expect(lessonsWithLikedSteps(content, rows)).toEqual(["vi-south.u01.l02", "vi-south.u05.l01"]);
  });

  it("un favori de leçon n'est pas compté comme un exercice", () => {
    const rows = [{ id: LESSON, packCode: "vi-south", kind: "lesson" as const, lessonId: LESSON, addedAt: "2026-01-01T00:00:00Z" }];
    expect(likedSteps(rows, LESSON)).toEqual([]);
    expect(lessonsWithLikedSteps(content, rows)).toEqual([]);
  });
});
