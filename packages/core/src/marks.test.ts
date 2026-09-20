import { describe, expect, it } from "vitest";
import { MARK_MAX, markLevel, overallMark, themeMarks, weakestThemes } from "./marks.ts";
import { GRADED_STEPS_PER_LESSON, gradedSteps, markOutOf20 } from "./practice.ts";
import { loadPack } from "./testing/pack.ts";
import type { LessonId } from "./types.ts";

/**
 * Notes du parcours (contrat phase21). Ce qui est vérifié ici, c'est ce qui rend une moyenne
 * honnête : le même barème partout, le meilleur essai, et un thème à peine entamé qui ne se fait
 * pas traiter de point faible.
 */

const content = loadPack();
const unit1 = content.curriculum.units[0]!;
const unit2 = content.curriculum.units[1]!;

const scores = (entries: [LessonId, number][]) => new Map(entries);

describe("barème", () => {
  it("un niveau compte 20 exercices notés, sauf ceux qui ouvrent un thème", () => {
    const counts = [...content.lessons.values()].map((lesson) => gradedSteps(content, lesson).length);
    // Jamais au-dessus : au-delà, la note du niveau pèserait plus lourd que les autres.
    expect(Math.max(...counts)).toBe(GRADED_STEPS_PER_LESSON);
    // La très grande majorité y est. Les autres ouvrent un thème et n'ont rien à réviser.
    const complete = counts.filter((n) => n === GRADED_STEPS_PER_LESSON).length;
    expect(complete / counts.length).toBeGreaterThan(0.85);
  });

  it("la note est la part de réussite ramenée sur 20, au demi-point", () => {
    expect(markOutOf20(1)).toBe(MARK_MAX);
    expect(markOutOf20(0)).toBe(0);
    expect(markOutOf20(0.75)).toBe(15);
    // 17/20 d'un niveau à 20 questions comme d'un niveau à 10 : la note reste comparable.
    expect(markOutOf20(17 / 20)).toBe(17);
    expect(markOutOf20(8.5 / 10)).toBe(17);
  });

  it("les seuils de lecture sont ceux des compétences, exprimés sur 20", () => {
    expect(markLevel(11.5)).toBe("fragile");
    expect(markLevel(12)).toBe("solid");
    expect(markLevel(16.9)).toBe("solid");
    expect(markLevel(17)).toBe("strong");
  });
});

describe("notes par thème", () => {
  it("un thème vaut la moyenne de ses niveaux notés, et dit sur combien elle porte", () => {
    const [a, b] = unit1.lessons as [LessonId, LessonId];
    const themes = themeMarks(content, scores([[a, 1], [b, 0.5]]));
    const first = themes.find((t) => t.unit === unit1.id)!;
    expect(first.mark).toBe(15);
    expect(first.done).toBe(2);
    expect(first.total).toBe(unit1.lessons.length);
    expect(first.level).toBe("solid");
  });

  it("tous les thèmes sont là, même intacts : l'écran ne change pas de hauteur", () => {
    const themes = themeMarks(content, new Map());
    expect(themes).toHaveLength(content.curriculum.units.length);
    expect(themes.every((t) => t.mark === null && t.level === null && t.done === 0)).toBe(true);
  });

  it("le niveau le plus faible du thème est désigné : c'est celui à refaire", () => {
    const [a, b, c] = unit1.lessons as [LessonId, LessonId, LessonId];
    const themes = themeMarks(content, scores([[a, 1], [b, 0.3], [c, 0.9]]));
    expect(themes.find((t) => t.unit === unit1.id)?.weakest?.lessonId).toBe(b);
  });
});

describe("moyenne générale", () => {
  it("moyenne des niveaux, pas des thèmes : un gros thème pèse plus qu'un petit", () => {
    const [a, b] = unit1.lessons as [LessonId, LessonId];
    const [c] = unit2.lessons as [LessonId];
    // Deux niveaux à 20/20 dans un thème, un à 5/20 dans l'autre : 15/20, pas 12,5/20.
    expect(overallMark(content, scores([[a, 1], [b, 1], [c, 0.25]])).mark).toBe(15);
  });

  it("rien de terminé : pas de moyenne inventée", () => {
    expect(overallMark(content, new Map())).toEqual({ mark: null, level: null, levels: 0 });
  });
});

describe("thèmes à reprendre", () => {
  it("seuls les thèmes vraiment faibles, du plus faible au moins faible", () => {
    const [a, b] = unit1.lessons as [LessonId, LessonId];
    const [c, d] = unit2.lessons as [LessonId, LessonId];
    const themes = themeMarks(content, scores([[a, 0.2], [b, 0.3], [c, 0.5], [d, 0.5]]));
    expect(weakestThemes(themes).map((t) => t.unit)).toEqual([unit1.id, unit2.id]);
  });

  it("un thème à peine entamé n'est pas un point faible : un seul niveau ne juge rien", () => {
    const [a] = unit1.lessons as [LessonId];
    expect(weakestThemes(themeMarks(content, scores([[a, 0.1]])))).toEqual([]);
  });

  it("un thème qui tient n'y figure pas", () => {
    const [a, b] = unit1.lessons as [LessonId, LessonId];
    expect(weakestThemes(themeMarks(content, scores([[a, 0.9], [b, 0.8]])))).toEqual([]);
  });
});
