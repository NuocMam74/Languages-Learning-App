import { describe, expect, it } from "vitest";
import { emptySkillStats, recordSkillAnswer, SKILL_WINDOW_DAYS, type SkillStats } from "./skills.ts";
import {
  ACTIVITY_LOG_DAYS,
  compareHalves,
  dailySeries,
  lastDays,
  normalizeActivityLog,
  recordActivitySeconds,
  regularity,
  seriesTotals,
  shiftDay,
  skillShares,
  STATS_WINDOW_DAYS,
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
