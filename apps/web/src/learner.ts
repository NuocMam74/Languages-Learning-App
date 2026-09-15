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
import { db, getKv, LEGACY_SNAPSHOT_KEY, setDb, setKv, withoutPack, type ParloDB, type Profile, type SessionSnapshot, type StoredSrsCard, type Totals } from "./db.ts";
import { activePackCode, scopedKey } from "./packs/active.ts";

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

/** Leçons terminées du pack (par défaut le pack actif) : chaque langue a sa progression (ADR 0006). */
export async function completedLessons(pack: string = activePackCode()): Promise<Set<LessonId>> {
  return new Set((await db().lessonProgress.where("packCode").equals(pack).toArray()).map((r) => r.lessonId));
}

/** Cartes SRS d'un pack, sans leur étiquette de stockage. */
export async function packCards(pack: string = activePackCode(), d: ParloDB = db()): Promise<SrsCard[]> {
  return (await d.srsCards.where("packCode").equals(pack).toArray()).map(withoutPack);
}

function toOutbox(event: ParloEvent) {
  return { id: event.id, occurredAt: event.occurredAt, event };
}

/** Écrit une carte rattachée à son pack ; l'événement porte la forme du contrat (sans packCode). */
async function putCard(d: ParloDB, pack: string, card: StoredSrsCard): Promise<SrsCard> {
  const plain = withoutPack(card);
  await d.srsCards.put({ ...plain, packCode: pack });
  return plain;
}

/** Séance en cours du pack (clé = code du pack ; ancienne clé « current » relue si elle lui appartient). */
async function readSnapshot(d: ParloDB, pack: string): Promise<SessionSnapshot | null> {
  const saved = await d.snapshot.get(pack);
  if (saved) return saved;
  const legacy = await d.snapshot.get(LEGACY_SNAPSHOT_KEY);
  return legacy && legacy.packCode === pack ? legacy : null;
}

/** Valeur `kv` d'un pack précis (utilisable dans une transaction). */
async function packKv<T>(d: ParloDB, pack: string, key: string, fallback: T): Promise<T> {
  const row = await d.kv.get(scopedKey(key, pack));
  return row ? (row.value as T) : fallback;
}

async function setPackKv<T>(d: ParloDB, pack: string, key: string, value: T): Promise<void> {
  await d.kv.put({ key: scopedKey(key, pack), value });
}

async function writeSnapshot(d: ParloDB, pack: string, session: SessionRun, now: Date): Promise<void> {
  await d.snapshot.put({ key: pack, packCode: pack, session, savedAt: now.toISOString() });
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
  const pack = content.pack.code;
  const [completed, cards, placement] = await Promise.all([
    completedLessons(pack),
    packCards(pack),
    packKv<PlacementRecord | null>(db(), pack, "placement", null),
  ]);
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
  const saved = await readSnapshot(db(), content.pack.code);
  return saved ? sessionOf(saved, content) : null;
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
    const saved = await readSnapshot(d, content.pack.code);
    const resumed = saved ? sessionOf(saved, content) : null;
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
    await writeSnapshot(d, content.pack.code, run, now);
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
  const pack = content.pack.code;

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
          const { card } = reviewConcept(withoutPack(prior), { correct: evaluation.correct, nearMiss: evaluation.nearMiss, responseMs, format: exerciseType }, now);
          events.push(makeEvent("srs_card_updated", { card: await putCard(d, pack, card) }, now));
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
      const log = await packKv<boolean[]>(d, pack, "toneLog", []);
      await setPackKv(d, pack, "toneLog", pushToneResult(log, evaluation.correct));
    }
    await writeSnapshot(d, pack, next, now);
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
    const pack = content.pack.code;
    const existing = new Map((await d.srsCards.bulkGet(lesson.review.srsIntroduce)).flatMap((c) => (c ? [[c.conceptId, withoutPack(c)] as const] : [])));
    const outcome = completeLesson(lesson, lessonRun, existing, now);
    const score = lessonScore(lessonRun);
    const events: ParloEvent[] = [];

    for (const card of outcome.cards) {
      const prior = existing.get(card.conceptId);
      const merged = prior ? mergeCards(prior, card) : card;
      events.push(makeEvent("srs_card_updated", { card: await putCard(d, pack, merged) }, now));
    }

    const progress = await d.lessonProgress.get(lesson.id);
    await d.lessonProgress.put({
      lessonId: lesson.id,
      packCode: pack,
      status: "completed",
      bestScore: Math.max(progress?.bestScore ?? 0, score),
      attempts: (progress?.attempts ?? 0) + 1,
      completedAt: now.toISOString(),
    });
    events.push(makeEvent("lesson_completed", { sessionId: run.sessionId, lessonId: lesson.id, score, durationMs: now.getTime() - Date.parse(lessonRun.startedAt) }, now));

    const next: SessionRun = { ...run, lessonSaved: true, learned: outcome.learned, xp: run.xp + outcome.xp };
    await d.outbox.bulkPut(events.map(toOutbox));
    await writeSnapshot(d, pack, next, now);
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
    const pack = content.pack.code;
    const durationMs = Math.max(0, now.getTime() - Date.parse(saved.startedAt));
    const xp = saved.xp + XP_SESSION_BONUS;
    const totals = await packKv<Totals>(d, pack, "totals", DEFAULT_TOTALS);
    const today = localDay(now);
    const streak = recordActivity(totals.streak, today);
    await setPackKv(d, pack, "totals", { xp: totals.xp + xp, streak } satisfies Totals);

    const activity = ((await d.kv.get("activity"))?.value as DailyActivity | undefined) ?? { date: today, seconds: 0 };
    // Une séance oubliée ouverte ne compte pas des heures : plafond à deux fois la durée prévue.
    const seconds = Math.min(durationMs / 1000, Math.max(saved.plan.estimatedSeconds * 2, 60));
    await d.kv.put({ key: "activity", value: { date: today, seconds: (activity.date === today ? activity.seconds : 0) + seconds } satisfies DailyActivity });

    const itemsCount = saved.reviewResults.length + (saved.lesson?.results.length ?? 0);
    const events: ParloEvent[] = [
      makeEvent("session_completed", { sessionId: saved.sessionId, xpGained: xp, itemsCount, durationMs, localDate: today }, now),
    ];

    const completed = new Set((await d.lessonProgress.where("packCode").equals(pack).toArray()).map((r) => r.lessonId));
    const cards = await packCards(pack, d);
    const words = new Set([...content.concepts.values()].filter((c) => c.type === "word").map((c) => c.id));
    const toneLog = await packKv<boolean[]>(d, pack, "toneLog", []);
    const earned = await packKv<EarnedBadge[]>(d, pack, "badges", []);
    const fresh = evaluateBadges(
      { curriculum: content.curriculum, completedLessons: completed, streak, knownWords: countKnownWords(cards, words), toneLog, features: content.pack.features },
      new Set(earned.map((b) => b.code)),
    );
    if (fresh.length > 0) {
      await setPackKv(d, pack, "badges", [...earned, ...fresh.map((code) => ({ code, earnedAt: now.toISOString() }))]);
      for (const code of fresh) events.push(makeEvent("badge_earned", { badgeCode: code }, now));
    }

    await d.outbox.bulkPut(events.map(toOutbox));
    await d.snapshot.delete(pack);
    if ((await d.snapshot.get(LEGACY_SNAPSHOT_KEY))?.packCode === pack) await d.snapshot.delete(LEGACY_SNAPSHOT_KEY);
    // Compteur local : les rappels ne sont proposés qu'après la 3e séance (spec §5.8).
    const sessionsCompleted = ((await d.kv.get("sessionsCompleted"))?.value as number | undefined) ?? 0;
    await d.kv.put({ key: "sessionsCompleted", value: sessionsCompleted + 1 });

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

  const pack = content.pack.code;
  await d.transaction("rw", [d.srsCards, d.kv, d.outbox], async () => {
    const existing = new Set((await packCards(pack, d)).map((c) => c.conceptId));
    const cards = placementCards(result.knownConceptIds, existing, now);
    const events: ParloEvent[] = [];
    for (const card of cards) {
      events.push(makeEvent("srs_card_updated", { card: await putCard(d, pack, card) }, now));
    }
    if (entry) {
      await setPackKv(d, pack, "placement", { levelEstimate: result.levelEstimate, entryLessonId: entry.id, completedAt: now.toISOString() } satisfies PlacementRecord);
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
  return d.transaction("rw", d.kv, d.outbox, async () => {
    const pack = activePackCode();
    const totals = await packKv<Totals>(d, pack, "totals", DEFAULT_TOTALS);
    const n = Math.max(0, Math.min(MAX_FREEZE_DAYS, Math.round(days)));
    const until = new Date(now);
    until.setDate(until.getDate() + n);
    const streak: Streak = { ...totals.streak, frozenUntil: n === 0 ? null : localDay(until) };
    await setPackKv(d, pack, "totals", { ...totals, streak } satisfies Totals);
    // Synchronisé (contrat phase2 §1). Annulation : gel ramené au dernier jour actif, qui ne couvre aucune absence.
    const localDate = localDay(now);
    const frozenUntil = streak.frozenUntil ?? totals.streak.lastActiveDate ?? localDate;
    await d.outbox.put(toOutbox(makeEvent("streak_frozen", { frozenUntil, localDate }, now)));
    return streak;
  });
}

// ---------------------------------------------------------------------------
// Prononciation (karaoké tonal) : le score seul, jamais l'audio (spec §8.3, §14)

export interface PronunciationRecord {
  sessionId: string | null;
  conceptId: ConceptId;
  score: number;
  exerciseType: "speak_repeat" | "tone_produce";
}

/** Écrit `pronunciation_scored` dans l'outbox pour chaque prise notée. */
export async function recordPronunciation(record: PronunciationRecord, now = new Date()): Promise<void> {
  const score = Math.max(0, Math.min(100, Math.round(record.score)));
  const event = makeEvent("pronunciation_scored", { ...record, score }, now);
  await db().outbox.put(toOutbox(event));
}

// ---------------------------------------------------------------------------
// Mini-jeux hors séance (onglet Jeux) : game_played, avec le jour local

type GamePlayed = Extract<ParloEvent, { type: "game_played" }>["payload"];

/** Écrit `game_played` dans l'outbox pour une partie libre terminée (les parties de séance passent par answer_submitted). */
export async function recordGamePlayed(game: GamePlayed["game"], result: { correct: number; total: number }, durationMs: number, now = new Date()): Promise<void> {
  if (result.total <= 0) return;
  const event = makeEvent("game_played", {
    game,
    correct: Math.max(0, Math.round(result.correct)),
    total: Math.round(result.total),
    durationMs: Math.max(0, Math.round(durationMs)),
    localDate: localDay(now),
  }, now);
  await db().outbox.put(toOutbox(event));
}

type ConversationTurn = Extract<ParloEvent, { type: "conversation_turn" }>["payload"];

/** Tour de conversation avec Cô Mai (contrat phase 3 §4) : jamais le contenu du message, seulement sa taille. */
export async function recordConversationTurn(turn: Omit<ConversationTurn, "localDate">, now = new Date()): Promise<void> {
  const event = makeEvent("conversation_turn", {
    conversationId: turn.conversationId,
    mode: turn.mode,
    words: Math.max(0, Math.round(turn.words)),
    responseMs: Math.max(0, Math.round(turn.responseMs)),
    localDate: localDay(now),
  }, now);
  await db().outbox.put(toOutbox(event));
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
