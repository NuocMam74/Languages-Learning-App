import { GRADED_STEPS_PER_LESSON, markOutOf20 } from "./practice.ts";
import type { SrsCard } from "./srs.ts";
import type { ConceptId, ContentIndex, LessonId, Localized, UnitId } from "./types.ts";

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

/* ------------------------------------------------------------ Fiche d'un thème */

/** Un niveau du thème, noté ou pas encore fait (`mark: null` : ce n'est pas un zéro). */
export interface ThemeLevel {
  lessonId: LessonId;
  title: Localized;
  kind: "lesson" | "review" | "unit_test";
  mark: number | null;
}

/** Un mot du thème qui résiste : oublié en révision au moins une fois. */
export interface ResistingConcept {
  conceptId: ConceptId;
  lapses: number;
}

export interface ThemeDetail {
  mark: ThemeMark;
  levels: ThemeLevel[];
  /** Concepts que les niveaux du thème font entrer en révision. */
  concepts: number;
  /** Ceux dont la carte a quitté l'état « nouveau » : vus, et revus au moins une fois. */
  acquired: number;
  /** Révisions notées et oublis sur les cartes du thème. */
  reviews: number;
  lapses: number;
  /** Part des révisions tenues (sans oubli), `null` tant qu'aucune carte n'a été revue. */
  retention: number | null;
  /** Les mots les plus souvent oubliés, du plus au moins fragile. */
  resisting: ResistingConcept[];
}

/** Au-delà, la liste des mots qui résistent devient un inventaire : on n'en reprend pas dix. */
export const RESISTING_MAX = 5;

/**
 * Fiche d'un thème (contrat phase26 §7) : sa note, celle de chacun de ses niveaux, ce qu'il a fait
 * entrer en mémoire et ce qui n'y tient pas.
 *
 * Les mots viennent des cartes de révision, pas des réponses : la carte garde **toute** l'histoire
 * d'un mot — ses oublis compris — là où les journaux de réponses ne gardent que soixante jours et ne
 * savent pas à quel thème une réponse appartenait. `null` si le thème n'existe pas dans ce pack.
 */
export function themeDetail(
  content: ContentIndex,
  unitId: UnitId,
  scores: ReadonlyMap<LessonId, number>,
  cards: readonly SrsCard[],
  max = RESISTING_MAX,
): ThemeDetail | null {
  const unit = content.curriculum.units.find((u) => u.id === unitId);
  const mark = themeMarks(content, scores).find((m) => m.unit === unitId);
  if (!unit || !mark) return null;

  const levels: ThemeLevel[] = unit.lessons.flatMap((lessonId) => {
    const lesson = content.lessons.get(lessonId);
    if (!lesson) return [];
    const score = scores.get(lessonId);
    return [{ lessonId, title: lesson.title, kind: lesson.kind ?? "lesson", mark: score === undefined ? null : markOutOf20(score) }];
  });

  const introduced = new Set<ConceptId>(unit.lessons.flatMap((id) => content.lessons.get(id)?.review.srsIntroduce ?? []));
  const own = cards.filter((card) => introduced.has(card.conceptId));
  const reviews = own.reduce((sum, card) => sum + card.reps, 0);
  const lapses = own.reduce((sum, card) => sum + card.lapses, 0);
  const resisting = own
    .filter((card) => card.lapses > 0)
    // À égalité d'oublis, la carte la plus difficile selon FSRS : c'est elle qui reviendra le plus.
    .sort((a, b) => b.lapses - a.lapses || b.difficulty - a.difficulty || a.conceptId.localeCompare(b.conceptId))
    .slice(0, max)
    .map((card) => ({ conceptId: card.conceptId, lapses: card.lapses }));

  return {
    mark,
    levels,
    concepts: introduced.size,
    acquired: own.filter((card) => card.state !== "new").length,
    reviews,
    lapses,
    retention: reviews > 0 ? Math.max(0, reviews - lapses) / reviews : null,
    resisting,
  };
}
