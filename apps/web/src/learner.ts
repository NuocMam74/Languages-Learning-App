import {
  BADGE_CODES,
  completeLesson,
  countKnownWords,
  emptyStreak,
  evaluateBadges,
  lessonsBefore,
  lessonScore,
  localDay,
  makeEvent,
  mergeCards,
  newCard,
  nextLesson,
  placementCards,
  planSession,
  pushToneResult,
  recordActivity,
  recordResult,
  recordReviewResult,
  resolveEntryLesson,
  reviewConcept,
  reviewedConcepts,
  scorePlacement,
  sessionPhase,
  startSessionRun,
  TONE_EXERCISE_TYPES,
  uuidv7,
  XP_SESSION_BONUS,
  type BadgeCode,
  type ConceptId,
  type ContentIndex,
  type Evaluation,
  type Exercise,
  type Lesson,
  type LessonId,
  type LessonRun,
  type ParloEvent,
  type PlacementAnswer,
  type PlacementResult,
  type PlacementSpec,
  type SessionPlan,
  type SessionRun,
  type SessionSource,
  type SrsCard,
  type Streak,
} from "@parlo/core";
import { db, getKv, setDb, setKv, type Profile, type SessionSnapshot, type Totals } from "./db.ts";

/**
 * Progression de l'apprenant, 100 % locale (mode invité compris).
 * Chaque changement d'état écrit son événement dans `outbox` dans la même
 * transaction : rien n'est perdu, tout sera synchronisé (ADR 0004).
 */

export const DEFAULT_PROFILE: Profile = {
  motivation: null,
  entourage: null,
  selfLevel: null,
  dailyGoalMin: 5,
  reminder: null,
  onboardedAt: null,
};

const DEFAULT_TOTALS: Totals = { xp: 0, streak: emptyStreak() };

/** Absence déclarée maximale (« je pars quelques jours »). */
export const MAX_FREEZE_DAYS = 14;

export interface EarnedBadge {
  code: BadgeCode;
  earnedAt: string;
}

export interface PlacementRecord {
  levelEstimate: number;
  entryLessonId: LessonId;
  completedAt: string;
}

export interface DailyActivity {
  date: string;
  seconds: number;
}

export const getProfile = () => getKv<Profile>("profile", DEFAULT_PROFILE);
export const saveProfile = (profile: Profile) => setKv("profile", profile);
export const getTotals = () => getKv<Totals>("totals", DEFAULT_TOTALS);
export const getBadges = () => getKv<EarnedBadge[]>("badges", []);
export const getPlacement = () => getKv<PlacementRecord | null>("placement", null);
export const getLanguageInterest = () => getKv<Record<string, boolean>>("langInterest", {});
export const setLanguageInterest = (value: Record<string, boolean>) => setKv("langInterest", value);

export async function completedLessons(): Promise<Set<LessonId>> {
  return new Set((await db().lessonProgress.toArray()).map((r) => r.lessonId));
}

function toOutbox(event: ParloEvent) {
  return { id: event.id, occurredAt: event.occurredAt, event };
}

// ---------------------------------------------------------------------------
// Planification

export interface Planning {
  completed: Set<LessonId>;
  /** Terminées + sautées grâce au placement : sert aux prérequis. */
  unlocked: Set<LessonId>;
  cards: SrsCard[];
  next: Lesson | null;
  daily: SessionPlan;
  review: SessionPlan;
  dueCount: number;
}

export async function planning(content: ContentIndex, profile: Profile, now = new Date()): Promise<Planning> {
  const [completed, cards, placement] = await Promise.all([completedLessons(), db().srsCards.toArray(), getPlacement()]);
  const unlocked = new Set([...completed, ...(placement ? lessonsBefore(content.curriculum, placement.entryLessonId) : [])]);
  const next = nextLesson(content.curriculum, content.lessons, unlocked, profile.motivation);
  const daily = planSession({ targetMinutes: profile.dailyGoalMin, cards, nextLesson: next, now });
  const review = planSession({ targetMinutes: profile.dailyGoalMin, cards, nextLesson: null, now });
  const reviewBlock = review.blocks.find((b) => b.kind === "review");
  const dueCount = reviewBlock?.kind === "review" ? reviewBlock.conceptIds.length + reviewBlock.deferred : 0;
  return { completed, unlocked, cards, next, daily, review, dueCount };
}

/** Une séance a-t-elle quelque chose à faire (au-delà du bilan) ? */
export function hasWork(plan: SessionPlan): boolean {
  return plan.blocks.some((b) => b.kind !== "recap" && b.kind !== "warmup");
}

// ---------------------------------------------------------------------------
// Séance

export type SessionRequest = { source: "daily" } | { source: "review" } | { source: "lesson"; lessonId: LessonId };

function lessonPlan(lesson: Lesson): SessionPlan {
  return { blocks: [{ kind: "new", lessonId: lesson.id }, { kind: "recap" }], estimatedSeconds: lesson.estimatedMinutes * 60 };
}

/** Snapshot de la Phase 0 (leçon seule) converti en séance. */
function sessionOf(snapshot: SessionSnapshot, content: ContentIndex): SessionRun | null {
  if (snapshot.session) return snapshot.session;
  const run = snapshot.run;
  const lesson = run ? content.lessons.get(run.lessonId) : undefined;
  if (!run || !lesson) return null;
  return {
    sessionId: run.sessionId, source: "lesson", plan: lessonPlan(lesson), reviewQueue: [], reviewCursor: 0, reviewResults: [],
    knownAtStart: [], lesson: run, lessonSaved: false, learned: [], xp: 0, startedAt: run.startedAt,
  };
}

function matches(run: SessionRun, request: SessionRequest): boolean {
  if (request.source === "lesson") return run.source === "lesson" && run.lesson?.lessonId === request.lessonId;
  return run.source === request.source;
}

export async function currentSession(content: ContentIndex): Promise<SessionRun | null> {
  const saved = await db().snapshot.get("current");
  return saved && saved.packCode === content.pack.code ? sessionOf(saved, content) : null;
}

/** Chemin de reprise d'une séance sauvegardée. */
export function sessionPath(run: SessionRun): string {
  if (run.source === "lesson" && run.lesson) return `/lecon/${run.lesson.lessonId}`;
  return run.source === "review" ? "/revision" : "/seance";
}

/** Reprend la séance sauvegardée si elle correspond à la demande, sinon en démarre une. */
export async function openSession(content: ContentIndex, request: SessionRequest, now = new Date()): Promise<SessionRun> {
  const d = db();
  const profile = await getProfile();
  const plans = request.source === "lesson" ? null : await planning(content, profile, now);

  return d.transaction("rw", d.snapshot, d.outbox, async () => {
    const saved = await d.snapshot.get("current");
    const resumed = saved && saved.packCode === content.pack.code ? sessionOf(saved, content) : null;
    if (resumed && matches(resumed, request)) return resumed;

    let plan: SessionPlan;
    let lesson: Lesson | null = null;
    if (request.source === "lesson") {
      lesson = content.lessons.get(request.lessonId) ?? null;
      if (!lesson) throw new Error(`Leçon inconnue : ${request.lessonId}`);
      plan = lessonPlan(lesson);
    } else if (plans) {
      plan = request.source === "daily" ? plans.daily : plans.review;
      const newBlock = plan.blocks.find((b) => b.kind === "new");
      lesson = newBlock?.kind === "new" ? (content.lessons.get(newBlock.lessonId) ?? null) : null;
    } else {
      throw new Error("planification absente");
    }

    const sessionId = uuidv7(now);
    const source: SessionSource = request.source;
    const known = (plans?.cards ?? []).map((c) => c.conceptId);
    const run = startSessionRun({ plan, sessionId, source, lesson, known, now });
    const event = makeEvent("session_started", { sessionId, source, plannedSeconds: plan.estimatedSeconds }, now);
    await d.snapshot.put({ key: "current", packCode: content.pack.code, session: run, savedAt: now.toISOString() });
    await d.outbox.put(toOutbox(event));
    return run;
  });
}

export async function submitSessionAnswer(
  content: ContentIndex,
  run: SessionRun,
  exercise: Exercise,
  evaluation: Evaluation,
  responseMs: number,
  now = new Date(),
): Promise<SessionRun> {
  const phase = sessionPhase(run, content);
  const exerciseType = exercise.type === "unsupported" ? exercise.stepType : exercise.type;
  const d = db();

  return d.transaction("rw", [d.snapshot, d.outbox, d.srsCards, d.kv], async () => {
    const events: ParloEvent[] = [];
    let next: SessionRun;

    if (phase.kind === "warmup" || phase.kind === "review") {
      next = recordReviewResult(run, exercise, evaluation, responseMs);
      if (evaluation.graded) {
        events.push(
          makeEvent("answer_submitted", {
            sessionId: run.sessionId, lessonId: null, stepIndex: phase.index, exerciseType, conceptIds: exercise.conceptIds,
            correct: evaluation.correct, nearMiss: evaluation.nearMiss, responseMs: Math.round(responseMs), attempt: phase.item.attempt,
          }, now),
        );
        // Le réveil ne touche pas au planning FSRS : seules les cartes dues sont notées, au premier essai.
        if (phase.kind === "review" && phase.item.attempt === 1) {
          const prior = (await d.srsCards.get(phase.item.conceptId)) ?? newCard(phase.item.conceptId, now);
          const { card } = reviewConcept(prior, { correct: evaluation.correct, nearMiss: evaluation.nearMiss, responseMs, format: exerciseType }, now);
          await d.srsCards.put(card);
          events.push(makeEvent("srs_card_updated", { card }, now));
        }
      }
    } else if ((phase.kind === "new" || phase.kind === "practice") && run.lesson) {
      const item = run.lesson.queue[run.lesson.cursor];
      next = { ...run, lesson: recordResult(run.lesson, exercise, evaluation, responseMs) };
      if (item && evaluation.graded) {
        events.push(
          makeEvent("answer_submitted", {
            sessionId: run.sessionId, lessonId: run.lesson.lessonId, stepIndex: item.stepIndex, exerciseType, conceptIds: exercise.conceptIds,
            correct: evaluation.correct, nearMiss: evaluation.nearMiss, responseMs: Math.round(responseMs), attempt: item.attempt,
          }, now),
        );
      }
    } else {
      return run;
    }

    if (evaluation.graded && TONE_EXERCISE_TYPES.has(exerciseType)) {
      const log = ((await d.kv.get("toneLog"))?.value as boolean[] | undefined) ?? [];
      await d.kv.put({ key: "toneLog", value: pushToneResult(log, evaluation.correct) });
    }
    await d.snapshot.put({ key: "current", packCode: content.pack.code, session: next, savedAt: now.toISOString() });
    await d.outbox.bulkPut(events.map(toOutbox));
    return next;
  });
}

/** Fin de la partie « Nouveau » : cartes SRS, progression de leçon, lesson_completed. */
export async function saveLessonPart(content: ContentIndex, run: SessionRun, now = new Date()): Promise<SessionRun> {
  const lessonRun: LessonRun | null = run.lesson;
  const lesson = lessonRun ? content.lessons.get(lessonRun.lessonId) : undefined;
  if (!lessonRun || !lesson || run.lessonSaved) return run;
  const d = db();

  return d.transaction("rw", [d.srsCards, d.lessonProgress, d.outbox, d.snapshot], async () => {
    const existing = new Map((await d.srsCards.bulkGet(lesson.review.srsIntroduce)).flatMap((c) => (c ? [[c.conceptId, c] as const] : [])));
    const outcome = completeLesson(lesson, lessonRun, existing, now);
    const score = lessonScore(lessonRun);
    const events: ParloEvent[] = [];

    for (const card of outcome.cards) {
      const prior = existing.get(card.conceptId);
      const merged = prior ? mergeCards(prior, card) : card;
      await d.srsCards.put(merged);
      events.push(makeEvent("srs_card_updated", { card: merged }, now));
    }

    const progress = await d.lessonProgress.get(lesson.id);
    await d.lessonProgress.put({
      lessonId: lesson.id,
      status: "completed",
      bestScore: Math.max(progress?.bestScore ?? 0, score),
      attempts: (progress?.attempts ?? 0) + 1,
      completedAt: now.toISOString(),
    });
    events.push(makeEvent("lesson_completed", { sessionId: run.sessionId, lessonId: lesson.id, score, durationMs: now.getTime() - Date.parse(lessonRun.startedAt) }, now));

    const next: SessionRun = { ...run, lessonSaved: true, learned: outcome.learned, xp: run.xp + outcome.xp };
    await d.outbox.bulkPut(events.map(toOutbox));
    await d.snapshot.put({ key: "current", packCode: content.pack.code, session: next, savedAt: now.toISOString() });
    return next;
  });
}

export interface SessionRecap {
  source: SessionSource;
  lessonId: LessonId | null;
  xp: number;
  learned: ConceptId[];
  /** Concepts dus travaillés pendant le rappel espacé. */
  reviewed: ConceptId[];
  /** Parmi eux, réussis du premier coup. */
  reviewedWell: ConceptId[];
  streak: Streak;
  badges: BadgeCode[];
  /** Première leçon jamais terminée : moment de proposer un compte (spec §4.1.6). */
  firstLesson: boolean;
}

/** Bilan : XP, série, minutes du jour, badges, session_completed. */
export async function finishSession(content: ContentIndex, run: SessionRun, now = new Date()): Promise<SessionRecap> {
  const saved = run.lesson && !run.lessonSaved ? await saveLessonPart(content, run, now) : run;
  const d = db();

  return d.transaction("rw", [d.srsCards, d.lessonProgress, d.kv, d.outbox, d.snapshot], async () => {
    const durationMs = Math.max(0, now.getTime() - Date.parse(saved.startedAt));
    const xp = saved.xp + XP_SESSION_BONUS;
    const totals = ((await d.kv.get("totals"))?.value as Totals | undefined) ?? DEFAULT_TOTALS;
    const today = localDay(now);
    const streak = recordActivity(totals.streak, today);
    await d.kv.put({ key: "totals", value: { xp: totals.xp + xp, streak } satisfies Totals });

    const activity = ((await d.kv.get("activity"))?.value as DailyActivity | undefined) ?? { date: today, seconds: 0 };
    // Une séance oubliée ouverte ne compte pas des heures : plafond à deux fois la durée prévue.
    const seconds = Math.min(durationMs / 1000, Math.max(saved.plan.estimatedSeconds * 2, 60));
    await d.kv.put({ key: "activity", value: { date: today, seconds: (activity.date === today ? activity.seconds : 0) + seconds } satisfies DailyActivity });

    const itemsCount = saved.reviewResults.length + (saved.lesson?.results.length ?? 0);
    const events: ParloEvent[] = [
      makeEvent("session_completed", { sessionId: saved.sessionId, xpGained: xp, itemsCount, durationMs, localDate: today }, now),
    ];

    const completed = new Set((await d.lessonProgress.toArray()).map((r) => r.lessonId));
    const cards = await d.srsCards.toArray();
    const words = new Set([...content.concepts.values()].filter((c) => c.type === "word").map((c) => c.id));
    const toneLog = ((await d.kv.get("toneLog"))?.value as boolean[] | undefined) ?? [];
    const earned = ((await d.kv.get("badges"))?.value as EarnedBadge[] | undefined) ?? [];
    const fresh = evaluateBadges(
      { curriculum: content.curriculum, completedLessons: completed, streak, knownWords: countKnownWords(cards, words), toneLog },
      new Set(earned.map((b) => b.code)),
    );
    if (fresh.length > 0) {
      await d.kv.put({ key: "badges", value: [...earned, ...fresh.map((code) => ({ code, earnedAt: now.toISOString() }))] });
      for (const code of fresh) events.push(makeEvent("badge_earned", { badgeCode: code }, now));
    }

    await d.outbox.bulkPut(events.map(toOutbox));
    await d.snapshot.delete("current");

    const lessonId = saved.lesson?.lessonId ?? null;
    return {
      source: saved.source,
      lessonId,
      xp,
      learned: saved.learned,
      reviewed: [...new Set(saved.reviewResults.filter((r) => r.graded && r.block === "review").map((r) => r.conceptId))],
      reviewedWell: reviewedConcepts(saved),
      streak,
      badges: fresh,
      firstLesson: lessonId !== null && completed.size === 1 && (await d.lessonProgress.get(lessonId))?.attempts === 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Placement

export async function savePlacement(content: ContentIndex, spec: PlacementSpec, answers: readonly PlacementAnswer[], now = new Date()): Promise<{ result: PlacementResult; entry: Lesson | null }> {
  const profile = await getProfile();
  const result = scorePlacement(spec, answers);
  const entry = resolveEntryLesson(content, result.levelEstimate, profile.motivation);
  const d = db();

  await d.transaction("rw", [d.srsCards, d.kv, d.outbox], async () => {
    const existing = new Set((await d.srsCards.toArray()).map((c) => c.conceptId));
    const cards = placementCards(result.knownConceptIds, existing, now);
    const events: ParloEvent[] = [];
    for (const card of cards) {
      await d.srsCards.put(card);
      events.push(makeEvent("srs_card_updated", { card }, now));
    }
    if (entry) {
      await d.kv.put({ key: "placement", value: { levelEstimate: result.levelEstimate, entryLessonId: entry.id, completedAt: now.toISOString() } satisfies PlacementRecord });
      events.push(
        makeEvent("placement_completed", {
          levelEstimate: result.levelEstimate, entryLessonId: entry.id, correct: result.correct, total: result.total, knownConceptIds: result.knownConceptIds,
        }, now),
      );
    }
    await d.outbox.bulkPut(events.map(toOutbox));
  });
  return { result, entry };
}

// ---------------------------------------------------------------------------
// Série, minutes du jour

/** « Je pars quelques jours » : gèle la série jusqu'à `days` jours (0 = annuler). */
export async function setFreeze(days: number, now = new Date()): Promise<Streak> {
  const d = db();
  return d.transaction("rw", d.kv, async () => {
    const totals = ((await d.kv.get("totals"))?.value as Totals | undefined) ?? DEFAULT_TOTALS;
    const n = Math.max(0, Math.min(MAX_FREEZE_DAYS, Math.round(days)));
    const until = new Date(now);
    until.setDate(until.getDate() + n);
    const streak: Streak = { ...totals.streak, frozenUntil: n === 0 ? null : localDay(until) };
    await d.kv.put({ key: "totals", value: { ...totals, streak } satisfies Totals });
    return streak;
  });
}

export async function todaySeconds(now = new Date()): Promise<number> {
  const activity = await getKv<DailyActivity | null>("activity", null);
  return activity && activity.date === localDay(now) ? activity.seconds : 0;
}

// ---------------------------------------------------------------------------
// Données locales (RGPD, spec §14)

export async function exportLocalData(now = new Date()) {
  const d = db();
  const [srsCards, lessonProgress, outbox, snapshot, kv, syncLog] = await Promise.all([
    d.srsCards.toArray(), d.lessonProgress.toArray(), d.outbox.toArray(), d.snapshot.toArray(), d.kv.toArray(), d.syncLog.toArray(),
  ]);
  return { app: "parlo", exportedAt: now.toISOString(), badgeCodes: BADGE_CODES, tables: { srsCards, lessonProgress, outbox, snapshot, kv, syncLog } };
}

export async function deleteLocalData(): Promise<void> {
  const d = db();
  await d.delete();
  setDb(null);
}
