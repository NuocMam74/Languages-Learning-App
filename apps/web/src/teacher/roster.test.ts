import type { Curriculum } from "@parlo/core";
import { describe, expect, it } from "vitest";
import { assignmentPayload, classCompletion, daysSince, defaultDirection, percent, selectedLessons, sortRoster, weakest } from "./roster.ts";
import type { RosterStudent } from "./teacher-api.ts";

const student = (id: string, displayName: string, patch: Partial<RosterStudent> = {}): RosterStudent => ({
  id,
  displayName,
  joinedAt: "2026-09-01T10:00:00Z",
  lastActiveDate: null,
  streak: 0,
  xpWeek: 0,
  lessonsCompleted: 0,
  currentLessonId: null,
  weakConcepts: [],
  exams: [],
  ...patch,
});

const roster = [
  student("1", "Minh", { lastActiveDate: "2026-09-14", streak: 5, xpWeek: 120, lessonsCompleted: 8, exams: [{ level: "A0", passed: true, global: 0.8 }] }),
  student("2", "an", { lastActiveDate: null, streak: 0, xpWeek: 0, lessonsCompleted: 0 }),
  student("3", "Ánh", { lastActiveDate: "2026-09-15", streak: 5, xpWeek: 300, lessonsCompleted: 3 }),
  student("4", "Bảo", { lastActiveDate: "2026-09-10", streak: 12, xpWeek: 40, lessonsCompleted: 14, exams: [{ level: "A0", passed: false, global: 0.4 }] }),
];

const names = (rows: RosterStudent[]) => rows.map((s) => s.displayName);

describe("sortRoster", () => {
  it("trie par nom sans tenir compte de la casse ni des accents", () => {
    expect(names(sortRoster(roster, "name", "asc"))).toEqual(["an", "Ánh", "Bảo", "Minh"]);
    expect(names(sortRoster(roster, "name", "desc"))).toEqual(["Minh", "Bảo", "Ánh", "an"]);
  });

  it("dernière activité : les plus récents d'abord, jamais actifs toujours en bas", () => {
    expect(names(sortRoster(roster, "lastActive", "desc"))).toEqual(["Ánh", "Minh", "Bảo", "an"]);
    expect(names(sortRoster(roster, "lastActive", "asc"))).toEqual(["Bảo", "Minh", "Ánh", "an"]);
  });

  it("chiffres : égalités départagées par le nom, sans muter l'entrée", () => {
    const copy = [...roster];
    expect(names(sortRoster(roster, "streak", "desc"))).toEqual(["Bảo", "Ánh", "Minh", "an"]);
    expect(names(sortRoster(roster, "xpWeek", "desc"))).toEqual(["Ánh", "Minh", "Bảo", "an"]);
    expect(names(sortRoster(roster, "lessons", "asc"))).toEqual(["an", "Ánh", "Minh", "Bảo"]);
    expect(names(sortRoster(roster, "exams", "desc"))).toEqual(["Minh", "an", "Ánh", "Bảo"]);
    expect(roster).toEqual(copy);
  });

  it("direction par défaut : nom croissant, le reste décroissant", () => {
    expect(defaultDirection("name")).toBe("asc");
    expect(defaultDirection("xpWeek")).toBe("desc");
  });
});

describe("formatage", () => {
  it("daysSince compte les jours calendaires", () => {
    expect(daysSince("2026-09-15", "2026-09-15")).toBe(0);
    expect(daysSince("2026-09-14", "2026-09-15")).toBe(1);
    expect(daysSince("2026-08-31", "2026-09-15")).toBe(15);
    expect(daysSince(null, "2026-09-15")).toBeNull();
    // Changement d'heure (fin octobre) : pas de demi-journée parasite.
    expect(daysSince("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("percent borne et arrondit", () => {
    expect(percent(0.456)).toBe(46);
    expect(percent(1.2)).toBe(100);
    expect(percent(-1)).toBe(0);
  });

  it("weakest : taux d'erreur décroissant, limité", () => {
    const concepts = [{ id: "a", vi: "a", errorRate: 0.2 }, { id: "b", vi: "b", errorRate: 0.7 }, { id: "c", vi: "c", errorRate: 0.5 }];
    expect(weakest(concepts, 2).map((c) => c.id)).toEqual(["b", "c"]);
  });
});

describe("classCompletion", () => {
  it("ratio borné, total du serveur prioritaire, repli sur l'effectif", () => {
    expect(classCompletion({ completed: 3, total: 5 }, 5)).toEqual({ done: 3, total: 5, ratio: 0.6 });
    expect(classCompletion({ completed: 9, total: 5 }, 5)).toEqual({ done: 5, total: 5, ratio: 1 });
    expect(classCompletion({ completed: 2, total: 0 }, 4)).toEqual({ done: 2, total: 4, ratio: 0.5 });
    expect(classCompletion({ completed: 0, total: 0 }, 0)).toEqual({ done: 0, total: 0, ratio: 0 });
  });
});

const curriculum: Curriculum = {
  pack: "vi-south",
  blocks: [],
  paths: {},
  units: [
    { id: "u1", title: { fr: "U1" }, status: "available", lessons: ["u1.l1", "u1.l2", "u1.l3"] },
    { id: "u2", title: { fr: "U2" }, status: "available", lessons: ["u2.l1", "u2.l2"] },
  ],
};

describe("devoirs : sélection et corps de requête", () => {
  it("leçons dans l'ordre du parcours, sans doublon", () => {
    expect(selectedLessons(curriculum, { units: new Set(["u2"]), lessons: new Set(["u2.l1", "u1.l2"]) })).toEqual(["u1.l2", "u2.l1", "u2.l2"]);
  });

  it("une unité entière seule → unitId", () => {
    expect(assignmentPayload(curriculum, " Salutations ", "2026-09-18", { units: new Set(["u1"]), lessons: new Set() })).toEqual({ title: "Salutations", dueDate: "2026-09-18", unitId: "u1" });
  });

  it("leçons isolées ou unité + leçons → lessonIds", () => {
    expect(assignmentPayload(curriculum, "T", "2026-09-18", { units: new Set(), lessons: new Set(["u1.l3", "u1.l1"]) })).toEqual({ title: "T", dueDate: "2026-09-18", lessonIds: ["u1.l1", "u1.l3"] });
    expect(assignmentPayload(curriculum, "T", "2026-09-18", { units: new Set(["u2"]), lessons: new Set(["u1.l1"]) })).toEqual({ title: "T", dueDate: "2026-09-18", lessonIds: ["u1.l1", "u2.l1", "u2.l2"] });
  });

  it("refuse titre vide, date absente ou aucune leçon", () => {
    const one = { units: new Set<string>(), lessons: new Set(["u1.l1"]) };
    expect(assignmentPayload(curriculum, "  ", "2026-09-18", one)).toBeNull();
    expect(assignmentPayload(curriculum, "T", "", one)).toBeNull();
    expect(assignmentPayload(curriculum, "T", "2026-09-18", { units: new Set(), lessons: new Set() })).toBeNull();
  });
});
