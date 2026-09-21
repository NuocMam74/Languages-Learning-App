import { describe, expect, it } from "vitest";
import { inMonth, journalDay, monthGrid, monthOf, plannedMinutes, shiftMonth, weekPlan, type WeekPlanInput } from "./calendar.ts";
import { periodOf, type CountersJournal } from "./rewards/counters.ts";
import { activeDaysIn, claimableSteps, questProgress, questSteps, QUEST_TARGET_DAYS } from "./rewards/quest.ts";

/**
 * Calendrier et quête de la semaine (contrat phase24 §4 et §5).
 *
 * Ce qui est tenu : un programme qui ne demande jamais sept jours sur sept, une quête qui compte
 * des **jours** et non du volume, et une grille de mois qui ne perd pas un jour aux bascules.
 */

/** Lundi 21 septembre 2026. */
const MONDAY = new Date(2026, 8, 21, 12);
const week = periodOf("weekly", MONDAY);

const input = (over: Partial<WeekPlanInput> = {}): WeekPlanInput => ({
  dailyGoalMin: 10,
  nextLesson: { title: { fr: "Au marché" }, minutes: 6, to: "/seance" },
  dueCount: 12,
  weakThemes: [{ title: { fr: "Les chiffres" }, to: "/lecon/u03.l02" }],
  hasTutor: true,
  hasGames: true,
  ...over,
});

describe("programme de la semaine", () => {
  it("couvre les sept jours, du lundi au dimanche", () => {
    const plan = weekPlan(week, input());
    expect(plan).toHaveLength(7);
    expect(plan[0]?.day).toBe("2026-09-21");
    expect(plan[0]?.weekday).toBe(0);
    expect(plan.at(-1)?.day).toBe("2026-09-27");
  });

  it("ménage des jours légers, et d'autant plus que l'objectif est court", () => {
    const light = weekPlan(week, input({ dailyGoalMin: 10 })).filter((day) => day.entries[0]?.kind === "rest");
    const heavy = weekPlan(week, input({ dailyGoalMin: 20 })).filter((day) => day.entries[0]?.kind === "rest");
    expect(light.length).toBe(2);
    expect(heavy.length).toBe(1);
    // Le dimanche est toujours du nombre : c'est le jour où l'on décroche le plus.
    expect(light.some((day) => day.weekday === 6)).toBe(true);
  });

  it("ne propose jamais plus de deux choses dans une journée", () => {
    for (const day of weekPlan(week, input())) expect(day.entries.length).toBeLessThanOrEqual(2);
  });

  it("ne nomme le niveau que le premier jour : on ignore lequel viendra jeudi", () => {
    const plan = weekPlan(week, input());
    const named = plan.filter((day) => day.entries.some((entry) => entry.kind === "lesson" && entry.title !== undefined));
    expect(named).toHaveLength(1);
    expect(named[0]?.day).toBe(week.days[0]);
    // Les jours suivants proposent bien un niveau, sans prétendre savoir lequel (jeudi : le
    // mercredi est un jour léger à 10 min/jour).
    const later = plan[3]?.entries[0];
    expect(later?.kind).toBe("lesson");
    expect(later?.title).toBeUndefined();
    expect(later?.to).toBe("/seance");
  });

  it("place le niveau du jour en tête, et fait tourner la seconde activité", () => {
    const plan = weekPlan(week, input());
    expect(plan[0]?.entries[0]?.kind).toBe("lesson");
    expect(plan[1]?.entries[1]?.kind).toBe("redo");
    expect(plan[3]?.entries[1]?.kind).toBe("game");
    expect(plan[4]?.entries[1]?.kind).toBe("tutor");
  });

  it("ne programme pas ce que le pack n'a pas", () => {
    const plan = weekPlan(week, input({ hasGames: false, hasTutor: false, weakThemes: [] }));
    const kinds = new Set(plan.flatMap((day) => day.entries.map((entry) => entry.kind)));
    expect(kinds.has("game")).toBe(false);
    expect(kinds.has("tutor")).toBe(false);
    expect(kinds.has("redo")).toBe(false);
  });

  it("bascule sur la révision quand le parcours est terminé", () => {
    const plan = weekPlan(week, input({ nextLesson: null }));
    const worked = plan.filter((day) => day.entries[0]?.kind !== "rest");
    expect(worked.every((day) => day.entries[0]?.kind === "review")).toBe(true);
  });

  it("ne propose aucune révision quand rien n'est dû", () => {
    const plan = weekPlan(week, input({ dueCount: 0, weakThemes: [] }));
    expect(plan.flatMap((day) => day.entries).some((entry) => entry.kind === "review")).toBe(false);
  });

  it("demande un volume qui tient dans l'objectif choisi", () => {
    // Un programme qui réclame le double de ce que la personne a annoncé ne sera pas suivi.
    const minutes = plannedMinutes(weekPlan(week, input({ dailyGoalMin: 10 })));
    expect(minutes).toBeLessThanOrEqual(7 * 10);
  });

  it("est le même à chaque lecture : il ne change pas sous les yeux", () => {
    expect(weekPlan(week, input())).toEqual(weekPlan(week, input()));
  });
});

describe("quête de la semaine", () => {
  const journal = (days: readonly string[]): CountersJournal =>
    Object.fromEntries(days.map((day) => [day, { items: 6 }]));

  it("compte des jours, pas du volume", () => {
    // Trois cents items en une seule journée ne valent pas trois jours.
    const marathon: CountersJournal = { "2026-09-21": { items: 300 } };
    expect(activeDaysIn(marathon, week)).toHaveLength(1);
    expect(questProgress(marathon, week, {}).steps.every((view) => !view.done)).toBe(true);
  });

  it("un jour compte dès qu'on a répondu, même trois minutes", () => {
    expect(activeDaysIn({ "2026-09-21": { items: 1 } }, week)).toEqual(["2026-09-21"]);
    // Une partie de jeu compte aussi ; ouvrir l'application sans rien faire, non.
    expect(activeDaysIn({ "2026-09-21": { games: 1 } }, week)).toHaveLength(1);
    expect(activeDaysIn({ "2026-09-21": { minutes: 4 } }, week)).toHaveLength(0);
  });

  it("ouvre les paliers au fur et à mesure, sans jamais en refermer un", () => {
    const three = questProgress(journal(week.days.slice(0, 3)), week, {});
    expect(three.steps.map((view) => view.done)).toEqual([true, false, false]);
    expect(three.next?.days).toBe(5);

    const five = questProgress(journal(week.days.slice(0, 5)), week, {});
    expect(five.steps.map((view) => view.done)).toEqual([true, true, false]);
    // Le premier palier reste réclamable : rien ne se perd en cours de semaine.
    expect(claimableSteps(five)).toHaveLength(2);
  });

  it("un palier réclamé ne se reréclame pas", () => {
    const steps = questSteps(week);
    const progress = questProgress(journal(week.days), week, { [steps[0]!.id]: "2026-09-23T10:00:00Z" });
    expect(claimableSteps(progress).map((step) => step.days)).toEqual([5, 7]);
  });

  it("le gros de la récompense est au cinquième jour, pas au septième", () => {
    const steps = questSteps(week);
    const [three, five, seven] = steps as [typeof steps[0], typeof steps[0], typeof steps[0]];
    expect(QUEST_TARGET_DAYS).toEqual([3, 5, 7]);
    // Le saut le plus fort est celui qui installe l'habitude.
    expect(five.coins - three.coins).toBeGreaterThan(seven.coins - five.coins);
    expect(five.chest).not.toBeNull();
  });

  it("les identifiants changent d'une semaine à l'autre", () => {
    const next = periodOf("weekly", new Date(2026, 8, 28, 12));
    expect(questSteps(week)[0]?.id).not.toBe(questSteps(next)[0]?.id);
  });
});

describe("grille du mois", () => {
  it("commence un lundi et finit un dimanche, semaines pleines", () => {
    const weeks = monthGrid("2026-09");
    expect(weeks[0]?.[0]).toBe("2026-08-31");
    for (const row of weeks) expect(row).toHaveLength(7);
    expect(weeks.at(-1)?.at(-1)).toBe("2026-10-04");
  });

  it("contient tous les jours du mois, une seule fois chacun", () => {
    for (const month of ["2026-01", "2026-02", "2026-09", "2027-03"]) {
      const days = monthGrid(month).flat().filter((day) => inMonth(day, month));
      const expected = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
      expect(days, month).toHaveLength(expected);
      expect(new Set(days).size, month).toBe(expected);
    }
  });

  it("navigue d'un mois à l'autre sans se tromper d'année", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthOf("2026-09-21")).toBe("2026-09");
    expect(inMonth("2026-10-01", "2026-09")).toBe(false);
  });
});

describe("journal d'un jour", () => {
  const data = {
    journal: { "2026-09-21": { items: 24, correct: 19, minutes: 9 } } as CountersJournal,
    lessonsByDay: { "2026-09-21": [{ title: { fr: "Au marché" }, mark: 16 }] },
    today: "2026-09-21",
  };

  it("rend ce qui a été fait, niveaux compris", () => {
    const day = journalDay("2026-09-21", data);
    expect(day.active).toBe(true);
    expect(day.counters.items).toBe(24);
    expect(day.lessons[0]?.mark).toBe(16);
    expect(day.future).toBe(false);
  });

  it("un jour sans rien n'est pas un jour à venir", () => {
    const day = journalDay("2026-09-20", data);
    expect(day.active).toBe(false);
    expect(day.future).toBe(false);
    expect(day.lessons).toEqual([]);
  });

  it("un jour à venir est marqué comme tel : on n'y montre que le programme", () => {
    expect(journalDay("2026-09-25", data).future).toBe(true);
  });
});
