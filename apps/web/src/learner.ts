import {
  completeLesson,
  emptyStreak,
  lessonScore,
  localDay,
  makeEvent,
  mergeCards,
  recordActivity,
  recordResult,
  startLesson,
  uuidv7,
  XP_SESSION_BONUS,
  type ConceptId,
  type ContentIndex,
  type Evaluation,
  type Exercise,
  type LessonId,
  type LessonRun,
  type ParloEvent,
  type Streak,
} from "@parlo/core";
import { db, getKv, setKv, type Profile, type Totals } from "./db.ts";

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

export const getProfile = () => getKv<Profile>("profile", DEFAULT_PROFILE);
export const saveProfile = (profile: Profile) => setKv("profile", profile);
export const getTotals = () => getKv<Totals>("totals", DEFAULT_TOTALS);

export async function completedLessons(): Promise<Set<LessonId>> {
  return new Set((await db().lessonProgress.toArray()).map((r) => r.lessonId));
}

function toOutbox(event: ParloEvent) {
  return { id: event.id, occurredAt: event.occurredAt, event };
}

/** Reprend la séance sauvegardée si elle porte sur cette leçon, sinon en démarre une. */
export async function openLesson(content: ContentIndex, lessonId: LessonId, now = new Date()): Promise<LessonRun> {
  const lesson = content.lessons.get(lessonId);
  if (!lesson) throw new Error(`Leçon inconnue : ${lessonId}`);

  const d = db();
  return d.transaction("rw", d.snapshot, d.outbox, async () => {
    const saved = await d.snapshot.get("current");
    if (saved && saved.run.lessonId === lessonId && saved.packCode === content.pack.code) return saved.run;

    const run = startLesson(lesson, uuidv7(now), now);
    const event = makeEvent("session_started", { sessionId: run.sessionId, source: "lesson", plannedSeconds: lesson.estimatedMinutes * 60 }, now);
    await d.snapshot.put({ key: "current", packCode: content.pack.code, run, savedAt: now.toISOString() });
    await d.outbox.put(toOutbox(event));
    return run;
  });
}

export async function currentSnapshot() {
  return db().snapshot.get("current");
}

export async function submitAnswer(
  packCode: string,
  run: LessonRun,
  exercise: Exercise,
  evaluation: Evaluation,
  responseMs: number,
  now = new Date(),
): Promise<LessonRun> {
  const item = run.queue[run.cursor];
  const next = recordResult(run, exercise, evaluation, responseMs);
  const d = db();
  await d.transaction("rw", d.snapshot, d.outbox, async () => {
    await d.snapshot.put({ key: "current", packCode, run: next, savedAt: now.toISOString() });
    if (item && evaluation.graded) {
      const event = makeEvent(
        "answer_submitted",
        {
          sessionId: run.sessionId,
          lessonId: run.lessonId,
          stepIndex: item.stepIndex,
          exerciseType: exercise.type === "unsupported" ? exercise.stepType : exercise.type,
          conceptIds: exercise.conceptIds,
          correct: evaluation.correct,
          nearMiss: evaluation.nearMiss,
          responseMs: Math.round(responseMs),
          attempt: item.attempt,
        },
        now,
      );
      await d.outbox.put(toOutbox(event));
    }
  });
  return next;
}

export interface LessonRecap {
  lessonId: LessonId;
  xp: number;
  learned: ConceptId[];
  score: number;
  streak: Streak;
}

export async function finishLesson(content: ContentIndex, run: LessonRun, now = new Date()): Promise<LessonRecap> {
  const lesson = content.lessons.get(run.lessonId);
  if (!lesson) throw new Error(`Leçon inconnue : ${run.lessonId}`);
  const d = db();

  return d.transaction("rw", [d.srsCards, d.lessonProgress, d.kv, d.outbox, d.snapshot], async () => {
    const existing = new Map((await d.srsCards.bulkGet(lesson.review.srsIntroduce)).flatMap((c) => (c ? [[c.conceptId, c] as const] : [])));
    const outcome = completeLesson(lesson, run, existing, now);
    const score = lessonScore(run);
    const durationMs = now.getTime() - Date.parse(run.startedAt);
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

    const xp = outcome.xp + XP_SESSION_BONUS;
    const totals = ((await d.kv.get("totals"))?.value as Totals | undefined) ?? DEFAULT_TOTALS;
    const today = localDay(now);
    const streak = recordActivity(totals.streak, today);
    await d.kv.put({ key: "totals", value: { xp: totals.xp + xp, streak } satisfies Totals });

    events.push(makeEvent("lesson_completed", { sessionId: run.sessionId, lessonId: lesson.id, score, durationMs }, now));
    events.push(
      makeEvent("session_completed", { sessionId: run.sessionId, xpGained: xp, itemsCount: run.results.length, durationMs, localDate: today }, now),
    );
    await d.outbox.bulkPut(events.map(toOutbox));
    await d.snapshot.delete("current");

    return { lessonId: lesson.id, xp, learned: outcome.learned, score, streak };
  });
}
