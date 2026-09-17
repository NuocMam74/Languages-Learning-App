import {
  emptyStreak,
  isDue,
  isUnitPassed,
  isUnitTestPassed,
  lessonsBefore,
  localDay,
  nextLesson as pickNextLesson,
  streakAt,
  type ContentIndex,
  type LessonId,
  type Localized,
  type UnitId,
} from "@parlo/core";
import { loadPack } from "../content.ts";
import { db, withoutPack, type LessonProgressRow, type Profile, type Totals } from "../db.ts";
import { DEFAULT_PROFILE, type PlacementRecord } from "../learner.ts";
import { availablePacks, scopedKey } from "../packs/active.ts";

/**
 * Résumé de progression d'une langue pour le tableau de bord (contrat phase7 §4).
 *
 * Règles : **`core.json` + IndexedDB seulement**, jamais un fichier d'unité (l'accueil ne doit pas
 * télécharger le contenu de quatre langues), et jamais un aller-retour réseau bloquant. Le résultat
 * est gardé en mémoire : revenir sur l'accueil affiche la carte à sa hauteur finale tout de suite.
 */

export interface NextLessonSummary {
  id: LessonId;
  title: Localized;
  minutes: number;
}

/** Unité en cours : sa barre de progression est la seule animation de l'accueil (§5). */
export interface UnitSummary {
  id: UnitId;
  title: Localized;
  done: number;
  total: number;
}

export interface PackSummary {
  code: string;
  /** Nom du pack (`pack.json`) ; null si le contenu n'est pas encore sur l'appareil. */
  name: Localized | null;
  lessonsDone: number;
  lessonsTotal: number;
  unitsPassed: number;
  unitsTotal: number;
  xp: number;
  /** Série du jour (0 si des jours manqués ne sont couverts ni par un gel ni par une protection). */
  streak: number;
  dueCount: number;
  /** Dernière leçon terminée (ISO), null si la langue n'a jamais été travaillée. */
  lastActiveAt: string | null;
  nextLesson: NextLessonSummary | null;
  unit: UnitSummary | null;
  /** L'onboarding de cette langue est fait : on reprend au lieu de le refaire. */
  onboarded: boolean;
  /** Quelque chose a déjà été fait ici (leçon terminée ou XP). */
  started: boolean;
  /** Le contenu de cette langue n'est pas disponible (jamais ouverte et hors ligne). */
  contentMissing: boolean;
}

const cache = new Map<string, PackSummary>();
const inflight = new Map<string, Promise<PackSummary>>();

/** Résumé déjà calculé (premier rendu sans attente au retour sur l'accueil). */
export function cachedPackSummary(code: string): PackSummary | null {
  return cache.get(code) ?? null;
}

/** À appeler quand la progression a changé (fin de séance, restauration, changement de langue). */
export function invalidatePackSummary(code?: string): void {
  if (code === undefined) cache.clear();
  else cache.delete(code);
}

function empty(code: string, name: Localized | null, contentMissing: boolean): PackSummary {
  return {
    code, name, lessonsDone: 0, lessonsTotal: 0, unitsPassed: 0, unitsTotal: 0, xp: 0, streak: 0, dueCount: 0,
    lastActiveAt: null, nextLesson: null, unit: null, onboarded: false, started: false, contentMissing,
  };
}

async function packKvValue<T>(key: string, pack: string, fallback: T): Promise<T> {
  const row = await db().kv.get(scopedKey(key, pack));
  return row ? (row.value as T) : fallback;
}

/** Lignes locales d'une langue : rien de tout cela n'a besoin du contenu. */
async function readLocal(code: string) {
  const d = db();
  const [rows, cards, totals, profile, placement] = await Promise.all([
    d.lessonProgress.where("packCode").equals(code).toArray(),
    d.srsCards.where("packCode").equals(code).toArray(),
    packKvValue<Totals>("totals", code, { xp: 0, streak: emptyStreak() }),
    packKvValue<Profile>("profile", code, DEFAULT_PROFILE),
    packKvValue<PlacementRecord | null>("placement", code, null),
  ]);
  return { rows, cards: cards.map(withoutPack), totals, profile, placement };
}

function progressSets(content: ContentIndex, rows: readonly LessonProgressRow[], placement: PlacementRecord | null) {
  const skipped = placement ? lessonsBefore(content.curriculum, placement.entryLessonId) : [];
  const completed = new Set(rows.map((r) => r.lessonId));
  const unlocked = new Set<LessonId>([...completed, ...skipped]);
  const passed = new Set<LessonId>([
    ...rows.filter((r) => content.lessons.get(r.lessonId)?.kind !== "unit_test" || isUnitTestPassed(r.bestScore)).map((r) => r.lessonId),
    ...skipped,
  ]);
  return { completed, unlocked, passed };
}

async function build(code: string, now: Date): Promise<PackSummary> {
  const local = await readLocal(code);
  const streak = streakAt(local.totals.streak, localDay(now)).current;
  const lastActiveAt = local.rows.reduce<string | null>((best, r) => (best === null || r.completedAt > best ? r.completedAt : best), null);
  const dueCount = local.cards.filter((c) => isDue(c, now)).length;
  const base = {
    xp: local.totals.xp,
    streak,
    dueCount,
    lastActiveAt,
    onboarded: local.profile.onboardedAt !== null,
    started: local.rows.length > 0 || local.totals.xp > 0,
  };

  let content: ContentIndex;
  try {
    // `loadPack` lit IndexedDB d'abord (core.json précaché) : aucune unité, aucun blocage réseau.
    content = await loadPack(code);
  } catch {
    return { ...empty(code, null, true), ...base };
  }

  const { completed, unlocked, passed } = progressSets(content, local.rows, local.placement);
  const next = pickNextLesson(content.curriculum, content.lessons, unlocked, local.profile.motivation, passed);
  const units = content.curriculum.units;
  const unitsPassed = units.filter((u) => isUnitPassed(content.curriculum, content.lessons, u.id, { completed: unlocked, passed })).length;
  const currentUnit = next ? units.find((u) => u.id === next.unit) : undefined;

  return {
    ...base,
    code,
    name: content.pack.name,
    lessonsDone: completed.size,
    lessonsTotal: content.lessons.size,
    unitsPassed,
    unitsTotal: units.length,
    nextLesson: next ? { id: next.id, title: next.title, minutes: Math.max(1, next.estimatedMinutes) } : null,
    unit: currentUnit
      ? {
          id: currentUnit.id,
          title: currentUnit.title,
          done: currentUnit.lessons.filter((id) => unlocked.has(id)).length,
          total: currentUnit.lessons.length,
        }
      : null,
    contentMissing: false,
  };
}

export async function packSummary(code: string, now = new Date()): Promise<PackSummary> {
  const hit = cache.get(code);
  if (hit) return hit;
  return refreshPackSummary(code, now);
}

/** Recalcule (une seule lecture à la fois par langue) : appelé au retour sur l'accueil. */
export function refreshPackSummary(code: string, now = new Date()): Promise<PackSummary> {
  const running = inflight.get(code);
  if (running) return running;
  const task = build(code, now)
    .then((summary) => {
      cache.set(code, summary);
      return summary;
    })
    .finally(() => inflight.delete(code));
  inflight.set(code, task);
  return task;
}

/**
 * Résumés des langues **proposées** (la liste vient de `usePackChoices` : un pack en préparation
 * n'apparaît jamais sur l'accueil), la plus récemment travaillée en tête, les autres dans l'ordre
 * du manifeste. L'ordre ne dépend jamais de l'ordre d'arrivée des lectures.
 */
export async function allPackSummaries(codes: readonly string[] = availablePacks(), now = new Date(), refresh: readonly string[] = []): Promise<PackSummary[]> {
  const fresh = new Set(refresh);
  const summaries = await Promise.all(codes.map((code) => (fresh.has(code) ? refreshPackSummary(code, now) : packSummary(code, now))));
  const rank = new Map(codes.map((code, i) => [code, i]));
  return [...summaries].sort((a, b) => {
    if (a.lastActiveAt !== b.lastActiveAt) return (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "");
    return (rank.get(a.code) ?? 0) - (rank.get(b.code) ?? 0);
  });
}

/** Langue à reprendre : la dernière travaillée, sinon la langue active. */
export function resumePack(summaries: readonly PackSummary[], active: string): PackSummary | null {
  return summaries.find((s) => s.lastActiveAt !== null) ?? summaries.find((s) => s.code === active) ?? summaries[0] ?? null;
}
