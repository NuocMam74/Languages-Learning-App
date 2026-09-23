import { describe, expect, it } from "vitest";
import { emptySkillStats, recordSkillAnswer, SKILL_WINDOW_DAYS, type SkillStats } from "./skills.ts";
import {
  ACTIVITY_LOG_DAYS,
  compareHalves,
  dailySeries,
  lastDays,
  mondayOf,
  normalizeActivityLog,
  normalizeWeeklyLog,
  recordActivitySeconds,
  recordWeeklyAnswer,
  recordWeeklySeconds,
  regularity,
  seedWeeklyLog,
  seriesTotals,
  shiftDay,
  skillShares,
  STATS_WINDOW_DAYS,
  WEEKLY_LOG_WEEKS,
  weeklySeries,
  weeklyTotals,
  weeksOfMonths,
} from "./stats.ts";

/**
 * Séries de l'écran Statistiques (contrat phase23 §1). Ce qui est tenu ici : un jour sans séance
 * est un zéro visible, une tendance ne s'annonce pas sur trois réponses, et rien n'est affiché
 * au-delà de ce que la mesure garde.
 */

const TODAY = "2026-09-21";

/** Petite fabrique : `{ "2026-09-20": [correct, total] }` pour une compétence d'écoute. */
function statsFrom(byDay: Record<string, [number, number]>): SkillStats {
  let stats = emptySkillStats();
  for (const [day, [correct, total]] of Object.entries(byDay)) {
    for (let i = 0; i < total; i++) stats = recordSkillAnswer(stats, "listen_pick_text", i < correct, day);
  }
  return stats;
}

describe("arithmétique des jours", () => {
  it("recule et avance d'un jour sans se tromper de mois", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay(TODAY, 0)).toBe(TODAY);
  });

  it("la fenêtre finit aujourd'hui et commence au bon jour", () => {
    const days = lastDays(TODAY, 7);
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toBe(TODAY);
    expect(days[0]).toBe("2026-09-15");
  });
});

describe("série journalière", () => {
  it("un jour sans séance vaut zéro, pas un trou", () => {
    const stats = statsFrom({ [TODAY]: [3, 4], [shiftDay(TODAY, -2)]: [1, 2] });
    const series = dailySeries(stats, {}, TODAY, 4);
    expect(series.map((p) => p.answers)).toEqual([0, 2, 0, 4]);
    // Le jour creux n'a pas de ratio : 0 % se lirait comme « tout faux », ce qui est faux.
    expect(series[0]?.ratio).toBeNull();
    expect(series[3]?.ratio).toBe(0.75);
  });

  it("ne dépasse jamais ce que la mesure garde", () => {
    // `byDay` ne conserve que 60 jours : une fenêtre de 120 jours inventerait deux mois d'abandon.
    expect(dailySeries(emptySkillStats(), {}, TODAY, 120)).toHaveLength(SKILL_WINDOW_DAYS);
  });

  it("porte les minutes du journal d'activité", () => {
    const series = dailySeries(emptySkillStats(), { [TODAY]: 480 }, TODAY, 3);
    expect(series.at(-1)?.seconds).toBe(480);
    expect(series[0]?.seconds).toBe(0);
  });
});

describe("totaux de la fenêtre", () => {
  const stats = statsFrom({ [TODAY]: [8, 10], [shiftDay(TODAY, -1)]: [5, 10], [shiftDay(TODAY, -3)]: [0, 0] });
  const series = dailySeries(stats, { [TODAY]: 600, [shiftDay(TODAY, -1)]: 300 }, TODAY, 7);

  it("compte les jours travaillés, pas les jours du calendrier", () => {
    const totals = seriesTotals(series);
    expect(totals.activeDays).toBe(2);
    expect(totals.answers).toBe(20);
    expect(totals.ratio).toBe(0.65);
  });

  it("la moyenne de minutes porte sur les jours travaillés", () => {
    // 15 minutes sur deux séances : 7,5 min par séance, pas 2,1 min par jour de calendrier.
    expect(seriesTotals(series).minutesPerActiveDay).toBe(7.5);
  });

  it("le meilleur jour est un jour où il s'est passé quelque chose, le plus récent à égalité", () => {
    expect(seriesTotals(series).best?.day).toBe(TODAY);
    expect(seriesTotals(dailySeries(emptySkillStats(), {}, TODAY, 7)).best).toBeNull();
  });

  it("la régularité est la part de jours travaillés", () => {
    expect(regularity(series)).toBeCloseTo(2 / 7);
    expect(regularity([])).toBe(0);
  });
});

describe("tendance", () => {
  it("ne se prononce pas tant qu'une moitié manque de matière", () => {
    const stats = statsFrom({ [TODAY]: [9, 10] });
    expect(compareHalves(dailySeries(stats, {}, TODAY, 8)).trend).toBe("unknown");
  });

  it("annonce un progrès quand l'écart sort du bruit", () => {
    const stats = statsFrom({ [shiftDay(TODAY, -6)]: [5, 20], [TODAY]: [18, 20] });
    const comparison = compareHalves(dailySeries(stats, {}, TODAY, 8));
    expect(comparison.trend).toBe("up");
    expect(comparison.previous).toBe(0.25);
    expect(comparison.recent).toBe(0.9);
  });

  it("une variation de quelques points reste stable : le bruit n'est pas un progrès", () => {
    // 75 % puis 77,5 % : deux points et demi, soit très exactement ce qu'un mauvais jour fait bouger.
    const stats = statsFrom({ [shiftDay(TODAY, -6)]: [15, 20], [TODAY]: [31, 40] });
    expect(compareHalves(dailySeries(stats, {}, TODAY, 8)).trend).toBe("flat");
  });
});

describe("répartition par compétence", () => {
  it("les quatre compétences sont toujours là, même à zéro", () => {
    const shares = skillShares(emptySkillStats(), lastDays(TODAY, STATS_WINDOW_DAYS));
    expect(shares).toHaveLength(4);
    expect(shares.every((s) => s.answers === 0 && s.share === 0 && s.ratio === null)).toBe(true);
  });

  it("les parts se rapportent au total de la fenêtre, et rien d'autre", () => {
    let stats = emptySkillStats();
    for (let i = 0; i < 3; i++) stats = recordSkillAnswer(stats, "listen_pick_text", true, TODAY);
    stats = recordSkillAnswer(stats, "match_pairs", false, TODAY);
    // Hors fenêtre : ne doit peser sur aucune part.
    stats = recordSkillAnswer(stats, "speak_repeat", true, shiftDay(TODAY, -40));
    const shares = skillShares(stats, lastDays(TODAY, 7));
    expect(shares.find((s) => s.skill === "listening")?.share).toBe(0.75);
    expect(shares.find((s) => s.skill === "vocabulary")?.ratio).toBe(0);
    expect(shares.find((s) => s.skill === "speaking")?.answers).toBe(0);
  });
});

describe("journal des minutes", () => {
  it("cumule les séances d'un même jour", () => {
    const log = recordActivitySeconds(recordActivitySeconds({}, TODAY, 300), TODAY, 200);
    expect(log[TODAY]).toBe(500);
  });

  it("reste borné, et garde les jours les plus récents", () => {
    let log: Record<string, number> = {};
    for (let i = 0; i < ACTIVITY_LOG_DAYS + 10; i++) log = recordActivitySeconds(log, shiftDay(TODAY, -i), 60);
    expect(Object.keys(log)).toHaveLength(ACTIVITY_LOG_DAYS);
    expect(log[TODAY]).toBe(60);
    expect(log[shiftDay(TODAY, -(ACTIVITY_LOG_DAYS + 5))]).toBeUndefined();
  });

  it("une valeur venue d'une version antérieure est ramenée à sa forme", () => {
    expect(normalizeActivityLog({ "pas-un-jour": 10, "2026-09-21": "300", "2026-09-20": -5, "2026-09-19": 61.4 })).toEqual({
      "2026-09-21": 300,
      "2026-09-19": 61,
    });
  });
});

describe("historique long : le journal des semaines", () => {
  it("une semaine commence le lundi, quel que soit le jour", () => {
    // 21 septembre 2026 : un lundi.
    expect(mondayOf("2026-09-21")).toBe("2026-09-21");
    expect(mondayOf("2026-09-27")).toBe("2026-09-21");
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("cumule réponses, réussites et secondes dans la semaine du jour", () => {
    let log = recordWeeklyAnswer({}, "2026-09-22", true);
    log = recordWeeklyAnswer(log, "2026-09-26", false);
    log = recordWeeklySeconds(log, "2026-09-27", 420);
    expect(log).toEqual({ "2026-09-21": { answers: 2, correct: 1, seconds: 420 } });
  });

  it("reste borné aux semaines écrites les plus récentes", () => {
    let log = {};
    for (let i = 0; i < WEEKLY_LOG_WEEKS + 5; i++) log = recordWeeklySeconds(log, shiftDay(TODAY, -7 * i), 60);
    expect(Object.keys(log)).toHaveLength(WEEKLY_LOG_WEEKS);
    expect(Object.keys(log).sort().at(-1)).toBe(mondayOf(TODAY));
  });

  it("une horloge qui recule ne vide rien : on compte des semaines écrites, pas un écart de dates", () => {
    let log = recordWeeklySeconds({}, "2027-06-01", 60);
    log = recordWeeklySeconds(log, "2026-01-05", 60);
    expect(Object.keys(log)).toHaveLength(2);
  });

  it("une valeur abîmée est ramenée à sa forme ; une clé qui n'est pas un lundi y est ramenée", () => {
    expect(normalizeWeeklyLog({ nope: { answers: 3 }, "2026-09-23": { answers: "5", correct: 9, seconds: 61.6 }, "2026-09-14": { answers: 0 } })).toEqual({
      "2026-09-21": { answers: 5, correct: 5, seconds: 62 },
    });
  });

  it("à la lecture, les soixante jours comblent les semaines d'avant le journal — sans compter deux fois", () => {
    const stats = statsFrom({ "2026-08-04": [6, 10], "2026-09-15": [3, 4] });
    const activity = { "2026-08-04": 600, "2026-09-15": 120 };
    // La semaine du 14 septembre est déjà dans le journal, plus fournie : elle n'est pas écrasée.
    const weekly = { "2026-09-14": { answers: 9, correct: 7, seconds: 900 } };
    expect(seedWeeklyLog(weekly, stats, activity)).toEqual({
      "2026-08-03": { answers: 10, correct: 6, seconds: 600 },
      "2026-09-14": { answers: 9, correct: 7, seconds: 900 },
    });
    // Le journal vient d'être créé : il ne connaît que la fin de la semaine, les jours en savent plus.
    const partial = { "2026-09-14": { answers: 1, correct: 1, seconds: 60 } };
    expect(seedWeeklyLog(partial, stats, activity)["2026-09-14"]).toEqual({ answers: 4, correct: 3, seconds: 120 });
  });
});

describe("historique long : la série des semaines", () => {
  const weekly = {
    [mondayOf(shiftDay(TODAY, -14))]: { answers: 20, correct: 15, seconds: 1200 },
    [mondayOf(TODAY)]: { answers: 10, correct: 9, seconds: 600 },
  };

  it("commence à la première semaine connue, pas douze mois en arrière", () => {
    const series = weeklySeries(weekly, [], TODAY, weeksOfMonths(12));
    expect(weeksOfMonths(3)).toBe(13);
    expect(weeksOfMonths(12)).toBe(52);
    expect(series.map((p) => p.answers)).toEqual([20, 0, 10]);
    // La semaine creuse du milieu est un zéro mesuré, et n'a pas de taux.
    expect(series[1]).toMatchObject({ measured: true, ratio: null });
    expect(series.at(-1)?.week).toBe(mondayOf(TODAY));
  });

  it("les niveaux remontent avant le journal ; ces semaines-là ne sont pas des zéros", () => {
    const old = shiftDay(TODAY, -60);
    const series = weeklySeries(weekly, [old, old, TODAY], TODAY, 13);
    expect(series[0]).toMatchObject({ week: mondayOf(old), lessons: 2, measured: false, ratio: null });
    expect(series.at(-1)?.lessons).toBe(1);
    const totals = weeklyTotals(series);
    expect(totals.lessons).toBe(3);
    expect(totals.measuredWeeks).toBe(3);
    // 30 minutes sur trois semaines mesurées : la moyenne n'est pas diluée par les semaines inconnues.
    expect(totals.minutesPerWeek).toBe(10);
    expect(totals.ratio).toBe(0.8);
  });

  it("la fenêtre coupe ce qui est plus ancien qu'elle", () => {
    expect(weeklySeries(weekly, [shiftDay(TODAY, -200)], TODAY, 13)).toHaveLength(13);
  });

  it("rien de connu : pas de série du tout, plutôt qu'une rangée de zéros", () => {
    expect(weeklySeries({}, [], TODAY, 13)).toEqual([]);
  });

  it("la tendance se lit aussi semaine contre semaine", () => {
    const points = weeklySeries(
      { [mondayOf(shiftDay(TODAY, -7))]: { answers: 20, correct: 10, seconds: 0 }, [mondayOf(TODAY)]: { answers: 20, correct: 18, seconds: 0 } },
      [],
      TODAY,
      13,
    );
    expect(compareHalves(points).trend).toBe("up");
  });
});
