import { describe, expect, it } from "vitest";
import { assignmentProgress, dueWhen, featuredAssignment, isComplete, nextLesson } from "./assignments.ts";
import type { MyClass, StudentAssignment } from "./classes-api.ts";
import { normalizeJoinCode } from "./classes-api.ts";

const assignment = (id: string, dueDate: string | null, completed: number, lessonIds = ["l1", "l2", "l3", "l4", "l5"]): StudentAssignment => ({
  id,
  title: `Devoir ${id}`,
  lessonIds,
  dueDate,
  completed,
  total: lessonIds.length,
});

describe("assignmentProgress", () => {
  it("serveur ou progression locale : le maximum, borné au total", () => {
    const a = assignment("a", "2026-09-18", 2);
    expect(assignmentProgress(a)).toEqual({ done: 2, total: 5 });
    expect(assignmentProgress(a, new Set(["l1", "l2", "l3", "autre"]))).toEqual({ done: 3, total: 5 });
    expect(assignmentProgress({ ...a, completed: 9 })).toEqual({ done: 5, total: 5 });
    expect(isComplete(a, new Set(["l1", "l2", "l3", "l4", "l5"]))).toBe(true);
  });

  it("total absent : nombre de leçons du devoir", () => {
    expect(assignmentProgress({ ...assignment("a", null, 1), total: 0 })).toEqual({ done: 1, total: 5 });
  });
});

describe("dueWhen", () => {
  const today = "2026-09-15"; // mardi
  it("aujourd'hui, demain, jour de la semaine sous 7 jours, date sinon", () => {
    expect(dueWhen("2026-09-15", today).kind).toBe("today");
    expect(dueWhen("2026-09-16", today).kind).toBe("tomorrow");
    expect(dueWhen("2026-09-18", today)).toEqual({ kind: "weekday", weekday: "vendredi" });
    expect(dueWhen("2026-09-22", today, "fr")).toEqual({ kind: "date", date: "22 septembre", overdue: false });
    expect(dueWhen("2026-09-10", today, "fr")).toEqual({ kind: "date", date: "10 septembre", overdue: true });
  });
});

describe("featuredAssignment", () => {
  const classes: MyClass[] = [
    { id: "c1", name: "Mardi", teacherName: "Cô Hoa", assignments: [assignment("late", "2026-08-01", 0), assignment("fri", "2026-09-18", 3), assignment("done", "2026-09-16", 5)] },
    { id: "c2", name: "Jeudi", teacherName: "Thầy Nam", assignments: [assignment("soon", "2026-09-17", 1), assignment("nodue", null, 0)] },
  ];

  it("le devoir non terminé à l'échéance la plus proche, retards anciens ignorés", () => {
    expect(featuredAssignment(classes, "2026-09-15")).toMatchObject({ classId: "c2", assignment: { id: "soon" } });
  });

  it("la progression locale peut terminer un devoir", () => {
    const local = new Set(["l1", "l2", "l3", "l4", "l5"]);
    expect(featuredAssignment(classes, "2026-09-15", local)).toBeNull();
  });

  it("sans échéance en dernier ; aucune classe → null", () => {
    const only = [{ ...classes[1]!, assignments: [assignment("nodue", null, 0), assignment("x", "2026-12-01", 0)] }];
    expect(featuredAssignment(only, "2026-09-15")?.assignment.id).toBe("x");
    expect(featuredAssignment([], "2026-09-15")).toBeNull();
  });
});

describe("nextLesson et codes", () => {
  it("première leçon non terminée et disponible", () => {
    const a = assignment("a", null, 0, ["l1", "l2", "l3"]);
    expect(nextLesson(a, new Set(["l1"]), (id) => id !== "l2")).toBe("l3");
    expect(nextLesson(a, new Set(["l1", "l3"]), (id) => id !== "l2")).toBeNull();
  });

  it("normalise un code Crockford base32 saisi à la main", () => {
    expect(normalizeJoinCode("ab-c1 23")).toBe("ABC123");
    expect(normalizeJoinCode("oil9zz")).toBe("0119ZZ");
    expect(normalizeJoinCode("ABCU12")).toBeNull();
    expect(normalizeJoinCode("ABC")).toBeNull();
  });
});
