import {
  BADGE_CODES,
  capDurationMs,
  capSessionTotals,
  completedWorlds,
  completeLesson,
  countKnownWords,
  emptyStreak,
  evaluateBadges,
  isEmptySession,
  isLessonMastered,
  isLessonUnlocked,
  isPracticeRun,
  isUnitPassed,
  isUnitTestPassed,
  lessonBriefing,
  lessonsBefore,
  lessonScore,
  localDay,
  makeEvent,
  markTaught,
  mergeCards,
  newCard,
  nextLesson,
  normalizeSkillStats,
  placementCards,
  planSession,
  pushSouthResult,
  pushToneResult,
  recordActivity,
  recordResult,
  recordSkillAnswer,
  recordReviewResult,
  resolveEntryLesson,
  reviewConcept,
  reviewedConcepts,
  scorePlacement,
  sessionCounters,
  sessionMisses,
  sessionPhase,
  sessionScore,
  sessionTally,
  startSessionRun,
  TONE_EXERCISE_TYPES,
  uuidv7,
  XP_SESSION_BONUS,
  type BadgeCode,
  type Briefing,
  type ConceptId,
  type Counters,
  type Localized,
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
  type SessionTally,
  type SkillStats,
  type SrsCard,
  type StepType,
  type Streak,
  type UnitId,
} from "@parlo/core";
import { ensureSessionContent } from "./content.ts";
import { db, getKv, LEGACY_SNAPSHOT_KEY, setDb, setKv, withoutPack, type ParloDB, type Profile, type SessionSnapshot, type StoredSrsCard, type Totals } from "./db.ts";
import { playableSteps } from "./media.ts";
import { readGuideIds } from "./review/guides-read.ts";
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
  /** Code de badge du pack, ou badge de défi `challenge_*` attribué par le serveur. */
  code: BadgeCode | (string & {});
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

/**
 * Profil et totaux sont **ramenés à leur forme complète** à la lecture.
 *
 * Ils viennent d'IndexedDB, et donc parfois d'une version plus ancienne de l'application, d'un
 * transfert d'appareil (contrat phase17 §1) ou d'une restauration serveur. Un champ ajouté depuis
 * manquerait alors, et l'accueil tombait dessus sans filet — un `totals` sans série suffisait à
 * faire écran blanc. Fusionner avec les valeurs par défaut coûte une ligne et supprime la classe
 * entière de ces pannes.
 */
export const getProfile = async (): Promise<Profile> => ({ ...DEFAULT_PROFILE, ...(await getKv<Partial<Profile>>("profile", {})) });
export const saveProfile = (profile: Profile) => setKv("profile", profile);
export const getTotals = async (): Promise<Totals> => {
  const stored = await getKv<Partial<Totals>>("totals", {});
  return { ...DEFAULT_TOTALS, ...stored, streak: { ...emptyStreak(), ...(stored.streak ?? {}) } };
};
export const getBadges = () => getKv<EarnedBadge[]>("badges", []);
export const getPlacement = () => getKv<PlacementRecord | null>("placement", null);
/** Agrégat de compétences du pack (contrat phase7 §3) : toujours ramené à la forme attendue. */
export const getSkillStats = async (pack?: string): Promise<SkillStats> =>
  normalizeSkillStats(pack === undefined ? await getKv<unknown>("stats", null) : (await db().kv.get(scopedKey("stats", pack)))?.value);
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
  await d.snapshot.put({
    key: pack, packCode: pack, session, savedAt: now.toISOString(),
    ...(session.contentVersion !== undefined ? { contentVersion: session.contentVersion } : {}),
  });
}

// ---------------------------------------------------------------------------
// Planification

export interface Planning {
  completed: Set<LessonId>;
  /** Terminées + sautées grâce au placement : sert aux prérequis. */
  unlocked: Set<LessonId>;
  /** Tests d'unité réussis (meilleur score ≥ 0,7) + leçons sautées au placement. */
  passed: Set<LessonId>;
  /** Meilleur score obtenu par leçon terminée (0 à 1) : la note affichée sur le parcours. */
  scores: Map<LessonId, number>;
  /** Leçons ouvertes (graphe d'unités, prérequis intra-unité) : carte du parcours et garde de lien profond. */
  open: Set<LessonId>;
  cards: SrsCard[];
  next: Lesson | null;
  daily: SessionPlan;
  review: SessionPlan;
  dueCount: number;
}

export interface ProgressState {
  completed: Set<LessonId>;
  unlocked: Set<LessonId>;
  passed: Set<LessonId>;
  /** Meilleur score par leçon terminée (0 à 1). Une leçon sautée au placement n'en a pas. */
  scores: Map<LessonId, number>;
}

/** Progression du pack : terminées, sautées au placement, tests d'unité réussis (contrat phase5 §2). */
export async function progressState(content: ContentIndex, d: ParloDB = db()): Promise<ProgressState> {
  const pack = content.pack.code;
  const [rows, placement] = await Promise.all([
    d.lessonProgress.where("packCode").equals(pack).toArray(),
    packKv<PlacementRecord | null>(d, pack, "placement", null),
  ]);
  const skipped = placement ? lessonsBefore(content.curriculum, placement.entryLessonId) : [];
  const completed = new Set(rows.map((r) => r.lessonId));
  const unlocked = new Set([...completed, ...skipped]);
  // « Réussi » (contrat phase10 §3) : une leçon ordinaire doit être **maîtrisée** — tous ses
  // exercices notés réussis, réessais compris — et un test d'unité doit passer son seuil. Terminer
  // en se trompant laisse la leçon ouverte à refaire, sans ouvrir la suivante.
  const passed = new Set([
    ...rows
      .filter((r) => (content.lessons.get(r.lessonId)?.kind === "unit_test" ? isUnitTestPassed(r.bestScore) : r.mastered === true))
      .map((r) => r.lessonId),
    ...skipped,
  ]);
  return { completed, unlocked, passed, scores: new Map(rows.map((r) => [r.lessonId, r.bestScore])) };
}

export function openLessons(content: ContentIndex, progress: ProgressState): Set<LessonId> {
  const sets = { completed: progress.unlocked, passed: progress.passed };
  return new Set([...content.lessons.keys()].filter((id) => isLessonUnlocked(content.curriculum, content.lessons, id, sets)));
}

/** Garde de lien profond : la leçon est-elle ouverte ? */
export async function isLessonOpen(content: ContentIndex, lessonId: LessonId): Promise<boolean> {
  const progress = await progressState(content);
  return isLessonUnlocked(content.curriculum, content.lessons, lessonId, { completed: progress.unlocked, passed: progress.passed });
}

export async function planning(content: ContentIndex, profile: Profile, now = new Date()): Promise<Planning> {
  const pack = content.pack.code;
  const [progress, cards] = await Promise.all([progressState(content), packCards(pack)]);
  const { completed, unlocked, passed, scores } = progress;
  const next = nextLesson(content.curriculum, content.lessons, unlocked, profile.motivation, passed);
  const daily = planSession({ targetMinutes: profile.dailyGoalMin, cards, nextLesson: next, now });
  const review = planSession({ targetMinutes: profile.dailyGoalMin, cards, nextLesson: null, now });
  const reviewBlock = review.blocks.find((b) => b.kind === "review");
  const dueCount = reviewBlock?.kind === "review" ? reviewBlock.conceptIds.length + reviewBlock.deferred : 0;
  return { completed, unlocked, passed, scores, open: openLessons(content, progress), cards, next, daily, review, dueCount };
}

/** Une séance a-t-elle quelque chose à faire (au-delà du bilan) ? */
export function hasWork(plan: SessionPlan): boolean {
  return plan.blocks.some((b) => b.kind !== "recap" && b.kind !== "warmup");
}

// ---------------------------------------------------------------------------
// Séance

/**
 * `practice` : rejouer une leçon déjà terminée depuis la bibliothèque « Réviser » (contrat phase8 §2).
 * Même déroulé, mais la progression n'est pas recomptée — voir `SessionMode` dans @parlo/core.
 */
export type SessionRequest =
  | { source: "daily" }
  | { source: "review" }
  /**
   * Une leçon. `steps` restreint la séance à certaines étapes — les exercices mis en favori
   * (contrat phase18 §3). Toujours en entraînement : on rejoue par goût, rien n'est recompté.
   */
  | { source: "lesson"; lessonId: LessonId; practice?: boolean; steps?: readonly number[] };

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
  // Une séance d'entraînement et la même leçon « pour de vrai » ne se reprennent pas l'une l'autre.
  if (request.source === "lesson") {
    if (run.source !== "lesson" || run.lesson?.lessonId !== request.lessonId) return false;
    if (isPracticeRun(run) !== (request.practice === true)) return false;
    // Une sélection d'étapes ne reprend pas une séance qui en jouait d'autres (contrat phase18 §3).
    const wanted = request.steps ? [...request.steps].sort((a, b) => a - b).join(",") : null;
    const running = run.lesson ? run.lesson.queue.map((item) => item.stepIndex).sort((a, b) => a - b).join(",") : "";
    return wanted === null || wanted === running;
  }
  return run.source === request.source && !isPracticeRun(run);
}

export async function currentSession(content: ContentIndex): Promise<SessionRun | null> {
  const saved = await readSnapshot(db(), content.pack.code);
  return saved ? sessionOf(saved, content) : null;
}

/** Chemin de reprise d'une séance sauvegardée. */
export function sessionPath(run: SessionRun): string {
  // Une leçon rejouée en entraînement reprend sur sa propre route (contrat phase8 §2).
  if (run.source === "lesson" && run.lesson) return `/lecon/${run.lesson.lessonId}${isPracticeRun(run) ? "/entrainement" : ""}`;
  return run.source === "review" ? "/revision" : "/seance";
}

/**
 * Y a-t-il quelque chose à faire ? `empty` : révision sans carte due ou séance du jour sans travail,
 * et aucune séance correspondante à reprendre — l'écran « Rien à réviser » remplace la séance, donc
 * ni XP ni jour de série (contrat phase5 §3).
 */
export async function sessionAvailability(content: ContentIndex, request: SessionRequest, now = new Date()): Promise<"resume" | "work" | "empty"> {
  const saved = await readSnapshot(db(), content.pack.code);
  const resumed = saved ? sessionOf(saved, content) : null;
  if (resumed && matches(resumed, request)) return "resume";
  if (request.source === "lesson") return "work";
  const plans = await planning(content, await getProfile(), now);
  return hasWork(request.source === "daily" ? plans.daily : plans.review) ? "work" : "empty";
}

/**
 * Leçons et concepts d'une séance (reprise ou nouvelle) : leurs unités sont chargées avant de construire
 * le moindre exercice (le moteur reste synchrone).
 */
function sessionNeeds(content: ContentIndex, request: SessionRequest, plans: { daily: SessionPlan; review: SessionPlan } | null, saved: SessionSnapshot | null): { lessonIds: LessonId[]; conceptIds: ConceptId[] } {
  const lessonIds: LessonId[] = [];
  const conceptIds: ConceptId[] = [];
  const resumed = saved ? sessionOf(saved, content) : null;
  if (resumed && matches(resumed, request)) {
    if (resumed.lesson) lessonIds.push(resumed.lesson.lessonId);
    conceptIds.push(...resumed.reviewQueue.map((item) => item.conceptId));
    return { lessonIds, conceptIds };
  }
  if (request.source === "lesson") return { lessonIds: [request.lessonId], conceptIds };
  const plan = plans ? (request.source === "daily" ? plans.daily : plans.review) : null;
  for (const block of plan?.blocks ?? []) {
    if (block.kind === "new") lessonIds.push(block.lessonId);
    if ("conceptIds" in block) conceptIds.push(...block.conceptIds);
  }
  return { lessonIds, conceptIds };
}

/** Reprend la séance sauvegardée si elle correspond à la demande, sinon en démarre une. */
/**
 * Ce que l'apprenant a déjà rencontré : les mots (cartes SRS et leçons terminées), les formats
 * d'exercice croisés, les fiches conseils lues. C'est la base de la fiche de préparation
 * (contrat phase16 §2) — on ne présente pas deux fois la même chose, et on ne laisse rien passer.
 */
interface PriorKnowledge {
  concepts: Set<ConceptId>;
  formats: Set<StepType>;
  guides: Set<string>;
}

async function priorKnowledge(content: ContentIndex): Promise<PriorKnowledge> {
  const [state, cards, guides] = await Promise.all([progressState(content), packCards(content.pack.code), readGuideIds()]);
  const concepts = new Set<ConceptId>(cards.map((c) => c.conceptId));
  const formats = new Set<StepType>();
  for (const lessonId of state.completed) {
    const done = content.lessons.get(lessonId);
    if (!done) continue;
    // Une leçon terminée a présenté ses mots : ils n'ont pas à l'être une seconde fois.
    for (const id of done.review.srsIntroduce) concepts.add(id);
    for (const step of done.steps) formats.add(step.type);
  }
  return { concepts, formats, guides };
}

function briefingFor(content: ContentIndex, lesson: Lesson | null, prior: PriorKnowledge, playable: readonly number[] | undefined): Briefing | undefined {
  if (!lesson) return undefined;
  return lessonBriefing(content, lesson, {
    known: prior.concepts,
    seenFormats: prior.formats,
    readGuides: prior.guides,
    // Les étapes retirées de la séance (pas d'enregistrement natif) ne préparent rien.
    ...(playable ? { playable } : {}),
  });
}

export async function openSession(content: ContentIndex, request: SessionRequest, now = new Date()): Promise<SessionRun> {
  const d = db();
  const profile = await getProfile();
  const plans = request.source === "lesson" ? null : await planning(content, profile, now);
  await ensureSessionContent(content, sessionNeeds(content, request, plans, await readSnapshot(d, content.pack.code)));
  // Lu hors transaction : Dexie referme la sienne dès qu'on attend une promesse qui n'en vient pas.
  const prior = await priorKnowledge(content);

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
    const allPlayable = lesson ? playableSteps(content, lesson) : undefined;
    // Sélection d'étapes : on garde l'intersection avec ce qui est jouable — un favori posé sur un
    // exercice devenu injouable (enregistrement manquant) ne ressuscite pas l'exercice.
    const wanted = request.source === "lesson" ? request.steps : undefined;
    const playable = wanted ? allPlayable?.filter((i) => wanted.includes(i)) : allPlayable;
    const practice = request.source === "lesson" && request.practice === true;
    // La fiche de préparation est figée au démarrage, comme `knownAtStart` : une reprise retrouve
    // exactement la même (contrat phase16 §2). Inutile en entraînement — on y rejoue du connu.
    const briefing = practice ? undefined : briefingFor(content, lesson, prior, playable);
    const run = startSessionRun({
      plan, sessionId, source, lesson, known, now, contentVersion: content.pack.version,
      ...(playable ? { playable } : {}), ...(practice ? { mode: "practice" as const } : {}),
      ...(briefing ? { briefing } : {}),
    });
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
        // Entraînement (contrat phase8 §2) : la leçon ne sera pas réenregistrée, mais le SRS profite
        // quand même des réponses — noté au premier essai, sans jamais créer de carte (les concepts
        // d'une leçon déjà terminée en ont une ; en introduire ici doublerait la leçon).
        if (isPracticeRun(run) && item.attempt === 1) {
          for (const conceptId of exercise.conceptIds) {
            const prior = await d.srsCards.get(conceptId);
            if (!prior) continue;
            const { card } = reviewConcept(withoutPack(prior), { correct: evaluation.correct, nearMiss: evaluation.nearMiss, responseMs, format: exerciseType }, now);
            events.push(makeEvent("srs_card_updated", { card: await putCard(d, pack, card) }, now));
          }
        }
      }
    } else {
      return run;
    }

    // Compétences (contrat phase7 §3) : agrégat local borné, écrit dans la transaction de la réponse.
    // Aucun événement, aucun envoi : le serveur a déjà `answer_submitted`.
    if (evaluation.graded) {
      const stats = normalizeSkillStats(await packKv<unknown>(d, pack, "stats", null));
      await setPackKv(d, pack, "stats", recordSkillAnswer(stats, exerciseType, evaluation.correct, localDay(now)));
    }
    if (evaluation.graded && TONE_EXERCISE_TYPES.has(exerciseType)) {
      const log = await packKv<boolean[]>(d, pack, "toneLog", []);
      await setPackKv(d, pack, "toneLog", pushToneResult(log, evaluation.correct));
    }
    // Badges « Sans accent du Nord » et « Explorateur de culture » (contrat phase5 §3).
    if (evaluation.graded && exerciseType === "spot_the_south") {
      const log = await packKv<boolean[]>(d, pack, "southLog", []);
      await setPackKv(d, pack, "southLog", pushSouthResult(log, evaluation.correct));
    }
    if (exercise.type === "culture_card" && evaluation.correct) {
      const cards = await packKv<string[]>(d, pack, "cultureCards", []);
      if (!cards.includes(exercise.card.id)) await setPackKv(d, pack, "cultureCards", [...cards, exercise.card.id]);
    }
    await writeSnapshot(d, pack, next, now);
    await d.outbox.bulkPut(events.map(toOutbox));
    return next;
  });
}

/** Fin de la partie « Nouveau » : cartes SRS, progression de leçon, lesson_completed. */
/**
 * Fiche de découverte vue (contrat phase10 §1) : enregistré dans le snapshot comme n'importe quelle
 * avancée de séance, pour qu'une reprise ne la remontre pas. Aucun événement : rien ne s'est passé
 * côté pédagogie, on a seulement lu.
 */
export async function markSessionTaught(content: ContentIndex, run: SessionRun, now = new Date()): Promise<SessionRun> {
  const next = markTaught(run);
  if (next === run) return run;
  const d = db();
  await writeSnapshot(d, content.pack.code, next, now);
  return next;
}

export async function saveLessonPart(content: ContentIndex, run: SessionRun, now = new Date()): Promise<SessionRun> {
  const lessonRun: LessonRun | null = run.lesson;
  const lesson = lessonRun ? content.lessons.get(lessonRun.lessonId) : undefined;
  if (!lessonRun || !lesson || run.lessonSaved) return run;
  const d = db();
  // Entraînement (contrat phase8 §2) : rien à enregistrer — ni carte réintroduite, ni tentative de plus,
  // ni `lesson_completed`. Le SRS a déjà reçu chaque réponse (submitSessionAnswer).
  if (isPracticeRun(run)) {
    const next: SessionRun = { ...run, lessonSaved: true };
    await writeSnapshot(d, content.pack.code, next, now);
    return next;
  }

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
    // Maîtrise (contrat phase10 §3) : acquise dès qu'une tentative a tout réussi, et jamais reperdue
    // — comme `bestScore`, c'est le meilleur de toutes les tentatives.
    const mastered = (progress?.mastered ?? false) || isLessonMastered(lessonRun);
    await d.lessonProgress.put({
      lessonId: lesson.id,
      packCode: pack,
      status: "completed",
      bestScore: Math.max(progress?.bestScore ?? 0, score),
      mastered,
      attempts: (progress?.attempts ?? 0) + 1,
      completedAt: now.toISOString(),
    });
    events.push(makeEvent("lesson_completed", { sessionId: run.sessionId, lessonId: lesson.id, score, durationMs: capDurationMs(now.getTime() - Date.parse(lessonRun.startedAt)) }, now));

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
  /** Séance vide : ni XP, ni série, ni session_completed. */
  empty: boolean;
  /** Leçon rejouée en entraînement (contrat phase8 §2) : rien n'a été recompté. */
  practice: boolean;
  /** Concepts nouveaux réussis pendant la leçon (« Ce que tu sais dire »). */
  canSay: ConceptId[];
  /**
   * Ce qui a résisté (contrat phase13 §1) : les concepts ratés et pas rattrapés, et ceux ratés
   * puis réussis. Sans eux, on termine une séance sans savoir sur quoi on a buté.
   */
  missed: ConceptId[];
  recovered: ConceptId[];
  /** Test d'unité : score de cette tentative et réussite (seuil 0,7). */
  unitTest: { lessonId: LessonId; score: number; passed: boolean } | null;
  /**
   * Réussite de la séance entière au premier essai (révisions comprises), entre 0 et 1 ; `null`
   * quand rien n'était noté. C'est le pourcentage affiché au bilan — il répond à la seule question
   * qu'on se pose en arrivant là : « j'ai eu combien ? »
   */
  score: number | null;
  /** Détail du pourcentage : items notés joués, et réussis du premier coup. */
  tally: SessionTally;
  /** XP totale avant / après (montée de niveau). */
  xpBefore: number;
  xpAfter: number;
  /**
   * Compteurs de la séance (contrat phase9 §1) : lus par `rewards/store.ts` **après** la
   * transaction — les récompenses sont locales et n'ont pas à partager l'écriture pédagogique.
   * Vides pour une séance vide ou un entraînement : rien n'a été recompté.
   */
  counters: Counters;
  /** Jour local de la séance (le journal des missions est par jour). */
  localDate: string;
  /** Mots connus et meilleure série, pour les paliers de trophées. */
  knownWords: number;
  bestStreak: number;
  /**
   * Mondes du cursus terminés à cet instant (contrat phase11 §3). La liste complète, pas le delta :
   * c'est `rewards/store.ts` qui sait lesquels étaient déjà fêtés.
   */
  worlds: { id: string; title: Localized }[];
}

/** Bilan : XP, série, minutes du jour, badges, session_completed. */
export async function finishSession(content: ContentIndex, run: SessionRun, now = new Date()): Promise<SessionRecap> {
  const saved = run.lesson && !run.lessonSaved ? await saveLessonPart(content, run, now) : run;
  const d = db();

  return d.transaction("rw", [d.srsCards, d.lessonProgress, d.kv, d.outbox, d.snapshot], async () => {
    const pack = content.pack.code;
    const lesson = saved.lesson ? content.lessons.get(saved.lesson.lessonId) : undefined;
    const practice = isPracticeRun(saved);
    const lessonCompleted = !practice && saved.lessonSaved && lesson !== undefined;
    // Entraînement (contrat phase8 §2) : traité comme une séance vide pour les totaux — ni XP, ni
    // série, ni minutes, ni badges, ni `session_completed`. Les `answer_submitted` et les
    // `srs_card_updated` déjà écrits disent honnêtement ce qui s'est passé.
    const empty = practice || isEmptySession(saved, lessonCompleted);
    const totals = await packKv<Totals>(d, pack, "totals", DEFAULT_TOTALS);
    const today = localDay(now);
    const itemsCount = saved.reviewResults.length + (saved.lesson?.results.length ?? 0);
    const capped = capSessionTotals({ xpGained: saved.xp + XP_SESSION_BONUS, itemsCount, durationMs: now.getTime() - Date.parse(saved.startedAt) });
    const xp = empty ? 0 : capped.xpGained;
    const streak = empty ? totals.streak : recordActivity(totals.streak, today);
    const events: ParloEvent[] = [];

    if (!empty) {
      await setPackKv(d, pack, "totals", { xp: totals.xp + xp, streak } satisfies Totals);
      const activity = ((await d.kv.get("activity"))?.value as DailyActivity | undefined) ?? { date: today, seconds: 0 };
      // Une séance oubliée ouverte ne compte pas des heures : plafond à deux fois la durée prévue.
      const seconds = Math.min(capped.durationMs / 1000, Math.max(saved.plan.estimatedSeconds * 2, 60));
      await d.kv.put({ key: "activity", value: { date: today, seconds: (activity.date === today ? activity.seconds : 0) + seconds } satisfies DailyActivity });
      events.push(makeEvent("session_completed", { sessionId: saved.sessionId, xpGained: xp, itemsCount: capped.itemsCount, durationMs: capped.durationMs, localDate: today }, now));
    }

    const rows = await d.lessonProgress.where("packCode").equals(pack).toArray();
    const completed = new Set(rows.map((r) => r.lessonId));
    const placement = await packKv<PlacementRecord | null>(d, pack, "placement", null);
    const skipped = placement ? lessonsBefore(content.curriculum, placement.entryLessonId) : [];
    const passed = new Set([...rows.filter((r) => content.lessons.get(r.lessonId)?.kind !== "unit_test" || isUnitTestPassed(r.bestScore)).map((r) => r.lessonId), ...skipped]);
    const passedUnits = new Set<UnitId>(
      content.curriculum.units.filter((u) => isUnitPassed(content.curriculum, content.lessons, u.id, { completed: new Set([...completed, ...skipped]), passed })).map((u) => u.id),
    );
    const cards = await packCards(pack, d);
    const words = new Set([...content.concepts.values()].filter((c) => c.type === "word").map((c) => c.id));
    const knownWords = countKnownWords(cards, words);
    const [toneLog, southLog, cultureCards, earned] = await Promise.all([
      packKv<boolean[]>(d, pack, "toneLog", []),
      packKv<boolean[]>(d, pack, "southLog", []),
      packKv<string[]>(d, pack, "cultureCards", []),
      packKv<EarnedBadge[]>(d, pack, "badges", []),
    ]);
    const fresh = empty
      ? []
      : evaluateBadges(
          {
            curriculum: content.curriculum, completedLessons: completed, streak, knownWords, toneLog, southLog,
            cultureCardsPassed: cultureCards.length, passedUnits, features: content.pack.features,
          },
          new Set(earned.map((b) => b.code)),
        );
    if (fresh.length > 0) {
      await setPackKv(d, pack, "badges", [...earned, ...fresh.map((code) => ({ code, earnedAt: now.toISOString() }))]);
      for (const code of fresh) events.push(makeEvent("badge_earned", { badgeCode: code }, now));
    }

    await d.outbox.bulkPut(events.map(toOutbox));
    await d.snapshot.delete(pack);
    if ((await d.snapshot.get(LEGACY_SNAPSHOT_KEY))?.packCode === pack) await d.snapshot.delete(LEGACY_SNAPSHOT_KEY);
    if (!empty) {
      // Compteur local : les rappels ne sont proposés qu'après la 3e séance (spec §5.8).
      const sessionsCompleted = ((await d.kv.get("sessionsCompleted"))?.value as number | undefined) ?? 0;
      await d.kv.put({ key: "sessionsCompleted", value: sessionsCompleted + 1 });
    }

    const lessonId = saved.lesson?.lessonId ?? null;
    const lessonResults = saved.lesson?.results ?? [];
    const answeredWell = new Set(lessonResults.filter((r) => r.graded && r.correct).flatMap((r) => r.conceptIds));
    const score = saved.lesson ? lessonScore(saved.lesson) : 0;
    return {
      source: saved.source,
      lessonId,
      xp,
      learned: saved.learned,
      canSay: saved.learned.filter((id) => answeredWell.has(id)),
      ...sessionMisses(saved),
      reviewed: [...new Set(saved.reviewResults.filter((r) => r.graded && r.block === "review").map((r) => r.conceptId))],
      reviewedWell: reviewedConcepts(saved),
      streak,
      badges: fresh,
      firstLesson: !practice && lessonId !== null && completed.size === 1 && (await d.lessonProgress.get(lessonId))?.attempts === 1,
      empty,
      practice,
      // Un test d'unité rejoué en entraînement ne se réussit ni ne se rate : il est déjà acquis.
      unitTest: !practice && lesson?.kind === "unit_test" && lessonId ? { lessonId, score, passed: isUnitTestPassed(score) } : null,
      score: sessionScore(saved),
      tally: sessionTally(saved),
      xpBefore: totals.xp,
      xpAfter: totals.xp + xp,
      // Une séance vide ou un entraînement ne nourrit ni les missions ni les trophées : ils ne
      // comptent pas la progression, et une récompense sans progression serait une tricherie.
      counters: empty ? {} : sessionCounters({ run: saved, lesson, lessonCompleted, xp, itemsCount: capped.itemsCount, durationMs: capped.durationMs, learned: saved.learned }),
      localDate: today,
      knownWords,
      bestStreak: Math.max(streak.current, streak.longest),
      worlds: completedWorlds(content.curriculum, content.lessons, { completed: new Set([...completed, ...skipped]), passed })
        .map((id) => ({ id, title: content.curriculum.blocks.find((b) => b.id === id)?.title ?? { fr: id } })),
    };
  });
}

// ---------------------------------------------------------------------------
// Bibliothèque « Réviser » (contrat phase8 §2)

/**
 * « Revoir maintenant » : rend un concept dû tout de suite, sans toucher à son historique FSRS
 * (stabilité, difficulté, répétitions, rechutes). Un concept encore sans carte en reçoit une, déjà
 * échue — `isDue` ignore l'état `new`, donc la carte forcée passe en `learning`.
 * Écrit la carte et son `srs_card_updated` dans la même transaction, comme toute écriture d'état.
 */
export async function forceDue(conceptId: ConceptId, pack: string = activePackCode(), now = new Date()): Promise<SrsCard> {
  const d = db();
  return d.transaction("rw", [d.srsCards, d.outbox], async () => {
    const prior = await d.srsCards.get(conceptId);
    const base = prior ? withoutPack(prior) : newCard(conceptId, now);
    const card: SrsCard = { ...base, due: now.toISOString(), state: base.state === "new" ? "learning" : base.state };
    const saved = await putCard(d, pack, card);
    await d.outbox.put(toOutbox(makeEvent("srs_card_updated", { card: saved }, now)));
    return saved;
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
    const localDate = localDay(now);
    // Le gel ne couvre que les jours à partir de la déclaration (contrat phase5 §3).
    const streak: Streak = n === 0 ? { ...totals.streak, frozenUntil: null, frozenFrom: null } : { ...totals.streak, frozenUntil: localDay(until), frozenFrom: localDate };
    await setPackKv(d, pack, "totals", { ...totals, streak } satisfies Totals);
    // Synchronisé ; annulation = frozenUntil null (accepté par l'API).
    await d.outbox.put(toOutbox(makeEvent("streak_frozen", { frozenUntil: streak.frozenUntil, localDate }, now)));
    return streak;
  });
}

// ---------------------------------------------------------------------------
// Prononciation (karaoké tonal) : le score seul, jamais l'audio (spec §8.3, §14)

export interface PronunciationRecord {
  sessionId: string | null;
  conceptId: ConceptId;
  score: number;
  /** Étape orale notée : répétition, ton produit, réponse libre ou jeu de rôle (contrat phase6 §3). */
  exerciseType: "speak_repeat" | "tone_produce" | "speak_answer" | "speak_roleplay";
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
    durationMs: capDurationMs(durationMs),
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
  // `notes` : local seulement, jamais synchronisé — mais il fait partie des données de l'appareil,
  // donc de l'export RGPD (contrat phase8 §3).
  const [srsCards, lessonProgress, outbox, snapshot, kv, syncLog, notes] = await Promise.all([
    d.srsCards.toArray(), d.lessonProgress.toArray(), d.outbox.toArray(), d.snapshot.toArray(), d.kv.toArray(), d.syncLog.toArray(), d.notes.toArray(),
  ]);
  return { app: "parlo", exportedAt: now.toISOString(), badgeCodes: BADGE_CODES, tables: { srsCards, lessonProgress, outbox, snapshot, kv, syncLog, notes } };
}

export async function deleteLocalData(): Promise<void> {
  const d = db();
  await d.delete();
  setDb(null);
}

/**
 * Déconnexion (contrat phase5 §4) : efface les données d'apprentissage de ce compte sur l'appareil
 * (progression, cartes, outbox, séance en cours, réglages de pack) ; packs en cache et langue
 * active conservés. Aucune fuite vers le compte suivant.
 */
export async function clearLearningData(): Promise<void> {
  const d = db();
  // Les notes personnelles ne partent jamais au serveur (contrat phase8 §3) : elles ne peuvent pas
  // être restaurées, mais les laisser les montrerait au compte suivant — on les efface (l'export de
  // la page Notes est là pour les emporter avant de se déconnecter).
  await d.transaction("rw", [d.srsCards, d.lessonProgress, d.outbox, d.snapshot, d.syncLog, d.kv, d.notes, d.favorites], async () => {
    // Les favoris partent avec les notes, et pour la même raison : ils ne remontent pas au serveur,
    // donc ils ne se restaureront pas — mais les laisser les montrerait au compte suivant.
    await Promise.all([d.srsCards.clear(), d.lessonProgress.clear(), d.outbox.clear(), d.snapshot.clear(), d.syncLog.clear(), d.notes.clear(), d.favorites.clear()]);
    const keys = (await d.kv.toCollection().primaryKeys()).filter((key) => key !== "activePack");
    await d.kv.bulkDelete(keys);
  });
}
