import { isDue, isMastered, type SrsCard } from "./srs.ts";
import type { ConceptId, Curriculum, Lesson, LessonId, Unit, UnitId } from "./types.ts";

/**
 * Planification d'une séance (spec §4.3) :
 *   Réveil (30 s) → Rappel espacé → Nouveau → Mise en pratique → Bilan (20 s)
 * La durée annoncée est un plafond : les révisions en trop glissent au lendemain.
 */

export const WARMUP_SECONDS = 30;
export const RECAP_SECONDS = 20;
export const WARMUP_ITEMS = 3;
/** Durée moyenne d'un item de révision, feedback compris. */
export const REVIEW_ITEM_SECONDS = 15;
/** Tolérance de dépassement de la durée annoncée (critère d'acceptation : ±20 %). */
export const OVERRUN_TOLERANCE = 0.2;

export type SessionBlock =
  | { kind: "warmup"; conceptIds: ConceptId[] }
  | { kind: "review"; conceptIds: ConceptId[]; deferred: number }
  | { kind: "new"; lessonId: LessonId }
  | { kind: "recap" };

export interface SessionPlan {
  blocks: SessionBlock[];
  estimatedSeconds: number;
}

export interface PlanInput {
  targetMinutes: number;
  cards: readonly SrsCard[];
  nextLesson: Lesson | null;
  now: Date;
}

/** Nombre de révisions dues à partir duquel la séance ne propose pas de nouveau (la moitié du budget). */
export function reviewDayThreshold(budgetSeconds: number): number {
  return Math.max(8, Math.floor((budgetSeconds * 0.5) / REVIEW_ITEM_SECONDS));
}

export function planSession({ targetMinutes, cards, nextLesson, now }: PlanInput): SessionPlan {
  const budget = targetMinutes * 60;
  const blocks: SessionBlock[] = [];
  let used = RECAP_SECONDS;

  const due = cards.filter((c) => isDue(c, now)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const dueIds = new Set(due.map((c) => c.conceptId));

  const warmup = cards
    .filter((c) => isMastered(c) && !dueIds.has(c.conceptId))
    .sort((a, b) => b.stability - a.stability)
    .slice(0, WARMUP_ITEMS)
    .map((c) => c.conceptId);
  if (warmup.length > 0) {
    blocks.push({ kind: "warmup", conceptIds: warmup });
    used += WARMUP_SECONDS;
  }

  const lessonSeconds = nextLesson ? nextLesson.estimatedMinutes * 60 : 0;
  // Trop de révisions en retard : journée de révision, pas de nouveau (sinon le SRS n'est jamais servi
  // quand la leçon remplit à elle seule l'objectif de 5 min).
  const reviewDay = due.length >= reviewDayThreshold(budget);
  // Le nouveau n'entre que s'il tient dans le budget (avec tolérance), ou s'il n'y a rien à réviser.
  const includeLesson =
    nextLesson !== null && (due.length === 0 || (!reviewDay && used + lessonSeconds <= budget * (1 + OVERRUN_TOLERANCE)));

  // Avec une leçon, les révisions prennent la marge de tolérance ; seules, elles tiennent dans l'objectif.
  const reviewBudget = includeLesson
    ? Math.max(0, budget * (1 + OVERRUN_TOLERANCE) - used - lessonSeconds)
    : Math.max(0, budget - used);
  const reviewCount = Math.min(due.length, Math.floor(reviewBudget / REVIEW_ITEM_SECONDS));
  if (reviewCount > 0) {
    blocks.push({ kind: "review", conceptIds: due.slice(0, reviewCount).map((c) => c.conceptId), deferred: due.length - reviewCount });
    used += reviewCount * REVIEW_ITEM_SECONDS;
  }

  if (includeLesson && nextLesson) {
    blocks.push({ kind: "new", lessonId: nextLesson.id });
    used += lessonSeconds;
  }

  blocks.push({ kind: "recap" });
  return { blocks, estimatedSeconds: used };
}

/** Score minimal (meilleur score) d'un test d'unité réussi (contrat phase5 §2). */
export const UNIT_TEST_PASS_SCORE = 0.7;

export function isUnitTestPassed(bestScore: number): boolean {
  return bestScore >= UNIT_TEST_PASS_SCORE - 1e-9;
}

export interface ProgressSets {
  /** Leçons terminées (ou sautées au placement). */
  completed: ReadonlySet<LessonId>;
  /** Tests d'unité réussis (ou sautés au placement). Défaut : `completed`. */
  passed?: ReadonlySet<LessonId>;
}

/** Unités requises : `requires` explicite, sinon l'unité précédente dans la liste. */
export function unitRequires(curriculum: Curriculum, unitId: UnitId): UnitId[] {
  const index = curriculum.units.findIndex((u) => u.id === unitId);
  const unit = curriculum.units[index];
  if (!unit) return [];
  if (unit.requires) return [...unit.requires];
  const previous = curriculum.units[index - 1];
  return previous ? [previous.id] : [];
}

/** Test(s) d'unité (`kind: "unit_test"`) ; sans test, toutes les leçons de l'unité en tiennent lieu. */
function unitGate(unit: Unit, lessons: ReadonlyMap<LessonId, Lesson>): { tests: LessonId[]; all: LessonId[] } {
  return { tests: unit.lessons.filter((id) => lessons.get(id)?.kind === "unit_test"), all: unit.lessons };
}

/** Unité réussie : chaque test d'unité réussi (sans test : toutes les leçons terminées). */
export function isUnitPassed(curriculum: Curriculum, lessons: ReadonlyMap<LessonId, Lesson>, unitId: UnitId, progress: ProgressSets): boolean {
  const unit = curriculum.units.find((u) => u.id === unitId);
  if (!unit || unit.lessons.length === 0) return false;
  const passed = progress.passed ?? progress.completed;
  const { tests, all } = unitGate(unit, lessons);
  return tests.length > 0 ? tests.every((id) => passed.has(id)) : all.every((id) => progress.completed.has(id));
}

/** Unité disponible : publiée, et chaque unité requise existante réussie (ou sautée au placement). */
export function isUnitAvailable(curriculum: Curriculum, lessons: ReadonlyMap<LessonId, Lesson>, unitId: UnitId, progress: ProgressSets): boolean {
  const unit = curriculum.units.find((u) => u.id === unitId);
  if (!unit || unit.status !== "available") return false;
  return unitRequires(curriculum, unitId).every(
    (req) => !curriculum.units.some((u) => u.id === req) || isUnitPassed(curriculum, lessons, req, progress),
  );
}

/**
 * Leçon faite pour le parcours : **réussie**, pas seulement terminée.
 *
 * C'est la même exigence que `isLessonUnlocked` (contrat phase10 §3), et elles doivent s'accorder.
 * Tant qu'elles divergeaient, une leçon terminée avec une erreur créait un cul-de-sac : elle
 * comptait comme faite, donc la séance du jour passait à la suivante — qui, elle, restait fermée
 * faute de prérequis réussi. Résultat, le parcours affichait « à refaire » pendant que l'accueil
 * n'offrait plus aucun bouton et que la séance du jour était vide.
 *
 * Avec cette règle, la leçon à refaire **est** la prochaine étape proposée : le chemin ne se coupe
 * jamais.
 *
 * Le serveur (`apps/api/app/services/progression.py`) garde volontairement la règle plus permissive
 * : il ne reçoit jamais la maîtrise, seulement des scores. Sa version de `next_lesson` ne sert
 * qu'au pointeur d'inscription et au bilan hebdomadaire ; la séance, elle, se décide ici. La
 * divergence est documentée des deux côtés — ne pas la « corriger » en copiant l'une sur l'autre.
 */
function lessonDone(lesson: Lesson, progress: ProgressSets): boolean {
  return (progress.passed ?? progress.completed).has(lesson.id);
}

/**
 * Leçon ouverte : unité disponible et prérequis intra-unité **réussis** (contrat phase10 §3) — les
 * prérequis inter-unités sont ignorés, le graphe d'unités les remplace.
 *
 * « Réussis », pas « terminés » : arriver au bout d'une leçon en se trompant ne l'ouvre pas pour
 * autant la suivante. Une leçon déjà commencée reste toujours accessible, justement pour pouvoir
 * la refaire.
 */
export function isLessonUnlocked(curriculum: Curriculum, lessons: ReadonlyMap<LessonId, Lesson>, lessonId: LessonId, progress: ProgressSets): boolean {
  const lesson = lessons.get(lessonId);
  if (!lesson) return false;
  if (progress.completed.has(lessonId)) return true;
  const unit = curriculum.units.find((u) => u.lessons.includes(lessonId));
  if (!unit || !isUnitAvailable(curriculum, lessons, unit.id, progress)) return false;
  const inUnit = new Set(unit.lessons);
  const passed = progress.passed ?? progress.completed;
  return lesson.prerequisites.every((p) => !inUnit.has(p) || passed.has(p));
}

/**
 * Prochaine leçon : dans les unités disponibles (graphe `requires`), la première leçon non faite
 * dont les prérequis intra-unité sont remplis. Le parcours du profil (famille, voyage…) trie les
 * unités disponibles par tags : un seul corpus, plusieurs chemins (spec §6.2). Un test d'unité
 * terminé sous le seuil reste à refaire.
 */
export function nextLesson(
  curriculum: Curriculum,
  lessons: ReadonlyMap<LessonId, Lesson>,
  completed: ReadonlySet<LessonId>,
  path: string | null,
  passed?: ReadonlySet<LessonId>,
): Lesson | null {
  const progress: ProgressSets = passed ? { completed, passed } : { completed };
  const boost = new Set(path ? (curriculum.paths[path]?.boostTags ?? []) : []);
  const units = curriculum.units
    .map((unit, order) => ({ unit, order, boosted: (unit.tags ?? []).some((t) => boost.has(t)) }))
    .filter(({ unit }) => isUnitAvailable(curriculum, lessons, unit.id, progress));

  // Unités boostées d'abord parmi les disponibles : le graphe empêche de sauter le socle.
  units.sort((a, b) => Number(b.boosted) - Number(a.boosted) || a.order - b.order);

  for (const { unit } of units) {
    const inUnit = new Set(unit.lessons);
    for (const lessonId of unit.lessons) {
      const lesson = lessons.get(lessonId);
      if (!lesson || lessonDone(lesson, progress)) continue;
      // Prérequis réussis (contrat phase10 §3) : la prochaine étape proposée est celle qu'on peut
      // réellement ouvrir. `lessonDone` renvoie déjà vers une leçon à refaire.
      if (lesson.prerequisites.every((p) => !inUnit.has(p) || (passed ?? completed).has(p))) return lesson;
    }
  }
  return null;
}
