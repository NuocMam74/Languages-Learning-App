import { GRADED_STEPS_PER_LESSON, markOutOf20 } from "./practice.ts";
import type { ContentIndex, LessonId, Localized, UnitId } from "./types.ts";

/**
 * Notes du parcours (contrat phase21 §4) : un niveau vaut une note sur 20, un thème la moyenne de
 * ses niveaux, et le parcours la moyenne de tous.
 *
 * Pourquoi une note, alors que la spec §5.1 dit de rendre la progression visible « sans compter les
 * points » : ce n'est pas un score de jeu, c'est un **diagnostic**. Un pourcentage par leçon ne se
 * compare pas d'une leçon à l'autre tant que le barème bouge ; une fois les niveaux à 20 exercices
 * (contrat phase21 §1), la moyenne par thème dit quelque chose de vrai — « les chiffres ne rentrent
 * pas, la famille est acquise » — et désigne quoi refaire. C'est la seule chose qu'on en fait :
 * aucune note n'ouvre ni ne ferme un niveau, le déverrouillage reste la maîtrise (contrat phase10 §3).
 *
 * La note vient du **meilleur essai** (`lessonProgress.bestScore`), comme le reste de la
 * progression : refaire un niveau améliore sa note, ne jamais la dégrader. Sinon personne ne
 * retenterait un thème faible — exactement ce qu'on veut encourager.
 */

export const MARK_MAX = GRADED_STEPS_PER_LESSON;

/**
 * Seuils de lecture, repris de ceux des compétences (`skills.ts`) pour que les deux écrans disent
 * la même chose du même résultat : 60 % et 85 %, soit 12/20 et 17/20.
 */
export const MARK_FRAGILE_BELOW = 12;
export const MARK_STRONG_FROM = 17;

export type MarkLevel = "fragile" | "solid" | "strong";

export function markLevel(mark: number): MarkLevel {
  if (mark < MARK_FRAGILE_BELOW) return "fragile";
  return mark < MARK_STRONG_FROM ? "solid" : "strong";
}

/** Moyenne arrondie au dixième ; `null` si rien n'a encore été noté. */
function average(marks: readonly number[]): number | null {
  if (marks.length === 0) return null;
  return Math.round((marks.reduce((sum, m) => sum + m, 0) / marks.length) * 10) / 10;
}

export interface LevelMark {
  lessonId: LessonId;
  title: Localized;
  mark: number;
}

export interface ThemeMark {
  unit: UnitId;
  title: Localized;
  /** Moyenne des niveaux notés du thème ; `null` tant qu'aucun n'a été fait. */
  mark: number | null;
  level: MarkLevel | null;
  /** Niveaux notés / niveaux du thème : une moyenne sur 1 niveau sur 8 se lit autrement. */
  done: number;
  total: number;
  /** Le niveau le moins réussi du thème : celui à refaire en premier. */
  weakest: LevelMark | null;
}

/**
 * Note de chaque thème du parcours — une unité, un thème (« La famille », « Les chiffres »), dans
 * l'ordre du cursus. Tous les thèmes sont présents, même vides : l'écran ne change pas de hauteur
 * quand un résultat arrive, et on voit ce qui reste à faire.
 */
export function themeMarks(content: ContentIndex, scores: ReadonlyMap<LessonId, number>): ThemeMark[] {
  return content.curriculum.units.map((unit) => {
    const marks: LevelMark[] = [];
    for (const lessonId of unit.lessons) {
      const score = scores.get(lessonId);
      const lesson = content.lessons.get(lessonId);
      if (score === undefined || !lesson) continue;
      marks.push({ lessonId, title: lesson.title, mark: markOutOf20(score) });
    }
    const mark = average(marks.map((m) => m.mark));
    // À égalité, le premier du cursus : on reprend le fil là où il s'est cassé, pas au hasard.
    const weakest = marks.reduce<LevelMark | null>((worst, m) => (worst === null || m.mark < worst.mark ? m : worst), null);
    return {
      unit: unit.id,
      title: unit.title,
      mark,
      level: mark === null ? null : markLevel(mark),
      done: marks.length,
      total: unit.lessons.length,
      weakest,
    };
  });
}

export interface OverallMark {
  /** Moyenne générale sur 20 ; `null` tant qu'aucun niveau n'a été noté. */
  mark: number | null;
  level: MarkLevel | null;
  /** Niveaux notés — ce sur quoi la moyenne porte. */
  levels: number;
}

/**
 * Moyenne générale : celle des **niveaux**, pas celle des thèmes. Un thème de huit niveaux pèse
 * huit fois plus qu'un thème d'un seul, parce qu'on y a travaillé huit fois plus.
 */
export function overallMark(content: ContentIndex, scores: ReadonlyMap<LessonId, number>): OverallMark {
  const marks = content.curriculum.units
    .flatMap((unit) => unit.lessons)
    .flatMap((lessonId) => {
      const score = scores.get(lessonId);
      return score === undefined || !content.lessons.has(lessonId) ? [] : [markOutOf20(score)];
    });
  const mark = average(marks);
  return { mark, level: mark === null ? null : markLevel(mark), levels: marks.length };
}

/**
 * Thèmes à reprendre, du plus faible au moins faible. Un thème à peine entamé n'y figure pas :
 * une moyenne sur un seul niveau ne dit pas qu'un thème résiste, seulement qu'on vient d'y entrer.
 */
export const WEAK_THEME_MIN_LEVELS = 2;

export function weakestThemes(themes: readonly ThemeMark[], max = 3): ThemeMark[] {
  return themes
    .filter((t) => t.mark !== null && t.done >= WEAK_THEME_MIN_LEVELS && t.level === "fragile")
    .sort((a, b) => (a.mark ?? 0) - (b.mark ?? 0))
    .slice(0, max);
}
