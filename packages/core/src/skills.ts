import { EXAM_SKILLS, type ExamSkill } from "./exams.ts";
import type { StepType } from "./types.ts";

/**
 * Compétences de l'apprenant (contrat phase7 §3) : écoute, lecture, vocabulaire, production orale.
 *
 * Même découpage que les sections d'examen (`EXAM_SKILLS`) : le profil additionne les réponses de
 * séance et les résultats d'examen sans jamais traduire d'un vocabulaire à l'autre.
 *
 * Tout est calculé à partir d'un agrégat local durable (`stats`, une valeur `kv` par pack) tenu à
 * jour à chaque réponse notée : aucun événement supplémentaire, aucune donnée personnelle nouvelle,
 * rien n'est envoyé au serveur (il a déjà les événements).
 */

export const SKILLS = EXAM_SKILLS;
export type Skill = ExamSkill;

/**
 * Compétence d'un type d'exercice. Chaque type appartient à **une** compétence (contrat §3) :
 * - écoute : on répond à partir de ce qu'on entend ;
 * - lecture : on répond à partir d'un texte écrit (consigne ou phrase à lire) ;
 * - vocabulaire : on relie une forme à son sens ;
 * - oral : on produit de la parole.
 *
 * `game` (mini-jeu joué dans une leçon) travaille l'association forme/sens : vocabulaire.
 */
export const SKILL_OF_STEP: Record<StepType, Skill> = {
  // Écoute
  listen_pick_text: "listening",
  listen_transcribe: "listening",
  listen_gist: "listening",
  tone_identify: "listening",
  tone_minimal_pair: "listening",
  // Lecture
  fill_gap: "reading",
  translate_to_fr: "reading",
  spot_the_south: "reading",
  build_sentence: "reading",
  // Vocabulaire
  match_pairs: "vocabulary",
  listen_pick_image: "vocabulary",
  translate_to_vi: "vocabulary",
  culture_card: "vocabulary",
  game: "vocabulary",
  // Production orale
  speak_repeat: "speaking",
  speak_answer: "speaking",
  speak_roleplay: "speaking",
  tone_produce: "speaking",
  dialogue_choice: "speaking",
};

export function skillOfStep(type: StepType): Skill {
  return SKILL_OF_STEP[type];
}

/** Fenêtre glissante des compétences : au-delà, les jours sont oubliés (taille bornée). */
export const SKILL_WINDOW_DAYS = 60;

/** En dessous de ce volume sur la fenêtre, la compétence est « en cours » : pas encore de verdict. */
export const SKILL_MIN_ITEMS = 10;

export interface SkillCounts {
  correct: number;
  total: number;
}

/**
 * Agrégat local d'une langue (`kv` `<pack>:stats`).
 * `bySkill` : cumul depuis toujours (volume total affiché) ; `byDay` : les `SKILL_WINDOW_DAYS`
 * derniers jours locaux, d'où sort le taux de réussite récent.
 */
export interface SkillStats {
  bySkill: Partial<Record<Skill, SkillCounts>>;
  byDay: Record<string, Partial<Record<Skill, SkillCounts>>>;
}

export function emptySkillStats(): SkillStats {
  return { bySkill: {}, byDay: {} };
}

/** Une valeur lue en base peut venir d'une version antérieure : on la ramène toujours à la forme attendue. */
export function normalizeSkillStats(value: unknown): SkillStats {
  const raw = (value ?? {}) as Partial<SkillStats>;
  const bySkill: Partial<Record<Skill, SkillCounts>> = {};
  for (const skill of SKILLS) {
    const counts = raw.bySkill?.[skill];
    if (counts) bySkill[skill] = { correct: Math.max(0, counts.correct | 0), total: Math.max(0, counts.total | 0) };
  }
  const byDay: SkillStats["byDay"] = {};
  for (const [day, perSkill] of Object.entries(raw.byDay ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !perSkill) continue;
    const kept: Partial<Record<Skill, SkillCounts>> = {};
    for (const skill of SKILLS) {
      const counts = perSkill[skill];
      if (counts) kept[skill] = { correct: Math.max(0, counts.correct | 0), total: Math.max(0, counts.total | 0) };
    }
    if (Object.keys(kept).length > 0) byDay[day] = kept;
  }
  return { bySkill, byDay };
}

const add = (counts: SkillCounts | undefined, correct: boolean): SkillCounts => ({
  correct: (counts?.correct ?? 0) + (correct ? 1 : 0),
  total: (counts?.total ?? 0) + 1,
});

/** Jours conservés : les `SKILL_WINDOW_DAYS` derniers (le jour du jour compris), rien d'antérieur. */
export function pruneSkillStats(stats: SkillStats, today: string): SkillStats {
  const days = Object.keys(stats.byDay).sort();
  // Fenêtre par nombre de jours *écrits*, jamais par écart de dates : un agrégat reste borné même si
  // l'horloge de l'appareil recule, et une longue absence ne vide pas l'historique récent.
  const future = days.filter((d) => d > today);
  const past = days.filter((d) => d <= today);
  const keep = new Set([...future, ...past.slice(-SKILL_WINDOW_DAYS)]);
  if (keep.size === days.length) return stats;
  const byDay: SkillStats["byDay"] = {};
  for (const day of days) if (keep.has(day)) byDay[day] = stats.byDay[day] as Partial<Record<Skill, SkillCounts>>;
  return { bySkill: stats.bySkill, byDay };
}

/** Enregistre une réponse notée (fonction pure : l'appelant écrit le résultat dans la même transaction). */
export function recordSkillAnswer(stats: SkillStats, type: StepType, correct: boolean, day: string): SkillStats {
  const skill = skillOfStep(type);
  const dayCounts = stats.byDay[day] ?? {};
  const next: SkillStats = {
    bySkill: { ...stats.bySkill, [skill]: add(stats.bySkill[skill], correct) },
    byDay: { ...stats.byDay, [day]: { ...dayCounts, [skill]: add(dayCounts[skill], correct) } },
  };
  return pruneSkillStats(next, day);
}

/** Résultat d'examen pris en compte : score d'une section (0..1) et nombre d'items notés. */
export interface ExamSkillScore {
  skill: Skill;
  /** Part d'items réussis, entre 0 et 1. */
  score: number;
  /** Items notés de la section (défaut : 1 — un examen pèse alors autant qu'un item de séance). */
  items?: number;
}

/** Verdict lisible d'une compétence. `none` : jamais travaillée ; `new` : trop peu d'items pour juger. */
export type SkillLevel = "none" | "new" | "fragile" | "solid" | "strong";

export const SKILL_FRAGILE_BELOW = 0.6;
export const SKILL_STRONG_FROM = 0.85;

export interface SkillSummary {
  skill: Skill;
  /** Réponses justes sur la fenêtre (examens compris). */
  correct: number;
  total: number;
  /** `correct / total`, null si rien n'a été travaillé. */
  ratio: number | null;
  level: SkillLevel;
  /** Volume depuis toujours : « tu as fait N exercices d'écoute ». */
  lifetime: number;
}

export function skillLevel(counts: SkillCounts): SkillLevel {
  if (counts.total === 0) return "none";
  if (counts.total < SKILL_MIN_ITEMS) return "new";
  const ratio = counts.correct / counts.total;
  if (ratio < SKILL_FRAGILE_BELOW) return "fragile";
  return ratio < SKILL_STRONG_FROM ? "solid" : "strong";
}

/**
 * Résumé des quatre compétences, toujours dans l'ordre de `SKILLS` (aucune ligne n'apparaît ni ne
 * disparaît selon les données : la hauteur de l'écran ne bouge pas).
 *
 * `exams` : sections d'examen déjà passées, ajoutées au même dénominateur.
 */
export function skillSummary(stats: SkillStats, exams: readonly ExamSkillScore[] = []): SkillSummary[] {
  const window = new Map<Skill, SkillCounts>(SKILLS.map((skill) => [skill, { correct: 0, total: 0 }]));
  for (const perSkill of Object.values(stats.byDay)) {
    for (const skill of SKILLS) {
      const counts = perSkill[skill];
      if (!counts) continue;
      const acc = window.get(skill) as SkillCounts;
      acc.correct += counts.correct;
      acc.total += counts.total;
    }
  }
  for (const exam of exams) {
    const acc = window.get(exam.skill);
    if (!acc) continue;
    const items = Math.max(1, Math.round(exam.items ?? 1));
    acc.correct += Math.round(Math.max(0, Math.min(1, exam.score)) * items);
    acc.total += items;
  }
  return SKILLS.map((skill) => {
    const counts = window.get(skill) as SkillCounts;
    return {
      skill,
      correct: counts.correct,
      total: counts.total,
      ratio: counts.total > 0 ? counts.correct / counts.total : null,
      level: skillLevel(counts),
      lifetime: stats.bySkill[skill]?.total ?? 0,
    };
  });
}

/** Jours locaux où au moins une réponse a été notée (compteur « jours actifs » du profil). */
export function activeDays(stats: SkillStats): number {
  return Object.values(stats.byDay).filter((perSkill) => SKILLS.some((skill) => (perSkill[skill]?.total ?? 0) > 0)).length;
}
