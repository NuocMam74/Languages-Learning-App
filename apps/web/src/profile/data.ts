import {
  countKnownWords,
  emptyStreak,
  isUnitPassed,
  localDay,
  skillSummary,
  streakAt,
  type ContentIndex,
  type ExamSkillScore,
  type GameBest,
  type GameId,
  type SkillSummary,
  type Streak,
} from "@parlo/core";
import { db, type Totals } from "../db.ts";
import { getLocalAttempts } from "../exams/exam-files.ts";
import { getBadges, getSkillStats, packCards, progressState, type EarnedBadge } from "../learner.ts";
import { activePackCode, scopedKey } from "../packs/active.ts";

/**
 * Données du profil (contrat phase7 §3). Tout se lit en local : le profil doit être complet en
 * mode invité, hors ligne. Le serveur (`/me`, `/certificates`) ne fait que compléter.
 */

/** Poids d'une section d'examen dans le calcul des compétences (items notés d'une section). */
const EXAM_SECTION_WEIGHT = 4;

/** Mini-jeux dont le record est affiché, dans l'ordre de la spec. */
export const PROFILE_GAMES: GameId[] = ["cho_noi", "xe_om", "bua_com", "nho_mat"];

/** Même clé que l'onglet Jeux (`games/GamesPage.tsx`), recopiée ici : le profil n'embarque pas les jeux. */
const bestKey = (game: GameId) => `games.${game}.best`;

export interface AcquiredCounts {
  words: number;
  structures: number;
  lessons: number;
  units: number;
  /** Réponses de production orale notées (volume de parole réellement mesurable en local). */
  speaking: number;
  activeDays: number;
  certificates: number;
}

export interface ProfileLanguage {
  code: string;
  skills: SkillSummary[];
}

/** Sections d'examen déjà passées, converties en volume comparable à des items de séance. */
export async function examScores(): Promise<ExamSkillScore[]> {
  const attempts = await getLocalAttempts();
  return Object.values(attempts).flatMap((attempt) =>
    Object.entries(attempt.scores).flatMap(([skill, score]) =>
      typeof score === "number" ? [{ skill, score, items: EXAM_SECTION_WEIGHT } as ExamSkillScore] : [],
    ),
  );
}

/** Compétences d'une langue : agrégat local + résultats d'examen de cette langue. */
export async function languageSkills(code: string): Promise<ProfileLanguage> {
  const stats = await getSkillStats(code);
  // Les tentatives d'examen sont déjà propres au pack (clé `exams.attempts` scopée).
  const exams = code === activePackCode() ? await examScores() : [];
  return { code, skills: skillSummary(stats, exams) };
}

export interface StreakView extends Streak {
  /** Gel encore actif aujourd'hui. */
  frozen: boolean;
}

export async function streakView(pack: string = activePackCode(), now = new Date()): Promise<StreakView> {
  const row = await db().kv.get(scopedKey("totals", pack));
  const totals = (row?.value as Totals | undefined) ?? { xp: 0, streak: emptyStreak() };
  const today = localDay(now);
  const streak = streakAt(totals.streak, today);
  return { ...streak, frozen: streak.frozenUntil !== null && streak.frozenUntil >= today };
}

/** « Acquis » de la langue active : ce qui est réellement mesuré sur l'appareil. */
export async function acquired(content: ContentIndex, certificates: number, now = new Date()): Promise<AcquiredCounts> {
  const pack = content.pack.code;
  const [cards, progress, stats] = await Promise.all([packCards(pack), progressState(content), getSkillStats(pack)]);
  const wordIds = new Set([...content.concepts.values()].filter((c) => c.type === "word").map((c) => c.id));
  const structureIds = new Set([...content.concepts.values()].filter((c) => c.type === "structure").map((c) => c.id));
  const units = content.curriculum.units.filter((u) =>
    isUnitPassed(content.curriculum, content.lessons, u.id, { completed: progress.unlocked, passed: progress.passed }),
  );
  const days = Object.keys(stats.byDay).filter((d) => d <= localDay(now)).length;
  return {
    words: countKnownWords(cards, wordIds),
    structures: countKnownWords(cards, structureIds),
    lessons: progress.completed.size,
    units: units.length,
    speaking: stats.bySkill.speaking?.total ?? 0,
    activeDays: days,
    certificates,
  };
}

/** Meilleurs scores des mini-jeux (clé `games.<id>.best`, propre au pack). */
export async function gameBests(): Promise<{ game: GameId; best: GameBest }[]> {
  const rows = await Promise.all(
    PROFILE_GAMES.map(async (game) => ({ game, best: ((await db().kv.get(scopedKey(bestKey(game))))?.value as GameBest | undefined) ?? null })),
  );
  return rows.flatMap((row) => (row.best ? [{ game: row.game, best: row.best }] : []));
}

export const earnedBadges = (): Promise<EarnedBadge[]> => getBadges();

/** Certificats obtenus : examens certifiants réussis, d'après les tentatives gardées localement. */
export async function certificateCount(): Promise<number> {
  return Object.values(await getLocalAttempts()).filter((attempt) => attempt.passed).length;
}
