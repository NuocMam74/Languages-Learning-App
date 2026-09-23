import { buildContentIndex, newCard, recordSkillAnswer, emptySkillStats, type ContentIndex } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import { db, ParloDB, setDb } from "../db.ts";
import { historyData, historyView, themeView } from "./data.ts";
import { hubKpis } from "./hub-kpis.ts";

/**
 * Des KPI partout où l'on en a besoin (contrat phase26 §7). Ce qui est vérifié ici, c'est ce que
 * les écrans promettent : l'historique ne commence pas dans le vide, le parcours ne montre pas de
 * zéros à un débutant, et la fiche d'un thème nomme les mots qui résistent.
 */

const content: ContentIndex = buildContentIndex(toRaw(readPackFiles("vi-south")));
const PACK = content.pack.code;
/** Mercredi 23 septembre 2026, midi local : la semaine a commencé lundi 21. */
const NOW = new Date(2026, 8, 23, 12);
let dbName = "";

const progress = (lessonId: string, completedAt: Date, bestScore = 1) => ({
  lessonId,
  packCode: PACK,
  status: "completed" as const,
  bestScore,
  mastered: true,
  attempts: 1,
  completedAt: completedAt.toISOString(),
});

beforeEach(async () => {
  dbName = `parlo-stats-${Math.random().toString(36).slice(2)}`;
  setDb(new ParloDB(dbName));
  await db().open();
});

afterEach(async () => {
  await db().delete();
  setDb(null);
});

describe("historique long", () => {
  it("un apprenant d'avant le journal des semaines retrouve ses mois : niveaux datés et soixante jours", async () => {
    const [first, second] = content.curriculum.units[1]!.lessons as [string, string];
    let stats = emptySkillStats();
    for (let i = 0; i < 10; i++) stats = recordSkillAnswer(stats, "listen_pick_text", i < 8, "2026-09-02");
    await db().kv.bulkPut([
      { key: `${PACK}:stats`, value: stats },
      { key: `${PACK}:activityLog`, value: { "2026-09-02": 900 } },
    ]);
    // Un niveau terminé en juin : bien avant les soixante jours, et avant tout journal.
    await db().lessonProgress.bulkPut([progress(first, new Date(2026, 5, 10, 18)), progress(second, new Date(2026, 8, 22, 9))]);

    const data = await historyData(content, NOW);
    const view = historyView(data, 6);
    expect(view.points[0]).toMatchObject({ week: "2026-06-08", lessons: 1, measured: false });
    expect(view.points.find((p) => p.week === "2026-08-31")).toMatchObject({ answers: 10, correct: 8, seconds: 900, measured: true });
    expect(view.points.at(-1)).toMatchObject({ week: "2026-09-21", lessons: 1 });
    expect(view.totals).toMatchObject({ lessons: 2, answers: 10, ratio: 0.8 });
    expect(view.measuredFrom).toBe("2026-08-31");
    expect(view.shortened).toBe(true);

    // Trois mois ne remontent pas jusqu'en juin : le niveau de juin sort de la période.
    expect(historyView(data, 3).totals.lessons).toBe(1);
  });

  it("le journal des semaines, quand il existe, fait foi au-delà des soixante jours", async () => {
    await db().kv.put({ key: `${PACK}:weeklyLog`, value: { "2026-03-02": { answers: 40, correct: 30, seconds: 2400 } } });
    const view = historyView(await historyData(content, NOW), 12);
    expect(view.points[0]).toMatchObject({ week: "2026-03-02", answers: 40, measured: true });
    // Mesuré depuis mars : les semaines creuses depuis sont des zéros, pas des inconnues.
    expect(view.points.every((p) => p.measured)).toBe(true);
    expect(view.totals.answers).toBe(40);
  });
});

describe("chiffres du parcours", () => {
  it("avant toute activité, la carte n'a rien à montrer", async () => {
    expect((await hubKpis(content, NOW)).active).toBe(false);
  });

  it("la semaine se compte depuis lundi, la réussite sur sept jours", async () => {
    const [lesson] = content.curriculum.units[1]!.lessons as [string];
    let stats = emptySkillStats();
    for (let i = 0; i < 4; i++) stats = recordSkillAnswer(stats, "match_pairs", i < 3, "2026-09-22");
    await db().kv.bulkPut([
      { key: `${PACK}:stats`, value: stats },
      // Dimanche 20 : dans les sept jours, mais pas dans la semaine.
      { key: `${PACK}:activityLog`, value: { "2026-09-20": 600, "2026-09-22": 300, "2026-09-23": 120 } },
    ]);
    await db().lessonProgress.put(progress(lesson, new Date(2026, 8, 21, 20)));

    const view = await hubKpis(content, NOW);
    expect(view.active).toBe(true);
    expect(view.weekSeconds).toBe(420);
    expect(view.weekLessons).toBe(1);
    expect(view.accuracy).toBe(0.75);
    expect(view.days).toHaveLength(7);
    expect(view.days.at(-1)?.day).toBe("2026-09-23");
  });
});

describe("fiche d'un thème", () => {
  it("nomme les mots qui résistent, avec leur sens", async () => {
    const unit = content.curriculum.units[1]!;
    const introduced = unit.lessons.flatMap((id) => content.lessons.get(id)?.review.srsIntroduce ?? []);
    const [a, b] = introduced as [string, string];
    await db().srsCards.bulkPut([
      { ...newCard(a, NOW), state: "review" as const, reps: 5, lapses: 2, packCode: PACK },
      { ...newCard(b, NOW), state: "review" as const, reps: 3, lapses: 0, packCode: PACK },
    ]);
    await db().lessonProgress.put(progress(unit.lessons[0]!, NOW, 0.8));

    const view = await themeView(content, unit.id);
    expect(view?.detail.mark.mark).toBe(16);
    expect(view?.detail.acquired).toBe(2);
    expect(view?.resisting).toEqual([{ conceptId: a, vi: content.concepts.get(a)!.vi, gloss: content.concepts.get(a)!.gloss, lapses: 2 }]);
  });

  it("un thème qui n'existe pas n'a pas de fiche", async () => {
    expect(await themeView(content, "u_nulle_part")).toBeNull();
  });
});
