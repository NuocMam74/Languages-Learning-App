import {
  buildExercise,
  buildReviewExercise,
  contentMedia,
  currentItem,
  evaluate,
  reviewFormats,
  reviewSeed,
  sessionPhase,
  TUTOR_NUDGE_AFTER,
  type ConceptId,
  type ContentIndex,
  type Evaluation,
  type Exercise,
  type ExerciseResponse,
  type Localized,
  type SessionPhase,
  type SessionRun,
} from "@parlo/core";
import { create } from "zustand";
import { ttsAllowed } from "./audio.ts";
import { UnitUnavailableError } from "./content.ts";
import { l, t, toneLabel } from "./i18n/index.ts";
import { finishSession, isLessonOpen, markSessionTaught, openSession, saveLessonPart, sessionAvailability, submitSessionAnswer, type SessionRecap, type SessionRequest } from "./learner.ts";
import { celebrate } from "./rewards/celebrate.ts";
import { awardSession } from "./rewards/store.ts";
import { syncEngine } from "./sync.ts";

/**
 * État de la séance en cours (éphémère, en mémoire). La source de vérité
 * durable est le snapshot IndexedDB écrit à chaque réponse.
 */

type Status = "idle" | "loading" | "answering" | "feedback" | "done" | "error" | "empty" | "locked";

interface SessionState {
  status: Status;
  content: ContentIndex | null;
  run: SessionRun | null;
  phase: SessionPhase | null;
  exercise: Exercise | null;
  shownAt: number;
  feedback: Evaluation | null;
  /** Réponse donnée, en texte (pour « Cô Mai, pourquoi ? »). */
  given: string;
  recap: SessionRecap | null;
  error: string | null;
  /**
   * Exercice plus facile proposé après 3 erreurs d'affilée sur un concept (spec §4.5) :
   * entraînement non noté, hors file de la leçon.
   */
  remedial: ConceptId | null;
  /** Concept pour lequel l'exercice plus facile sera proposé au prochain « Continuer ». */
  pendingRemedial: ConceptId | null;
  open: (content: ContentIndex, request: SessionRequest) => Promise<void>;
  answer: (response: ExerciseResponse) => Promise<void>;
  next: () => Promise<void>;
  /** Fiche de découverte lue : on passe aux exercices (contrat phase10 §1). */
  taught: () => Promise<void>;
  reset: () => void;
}

export function exerciseFor(content: ContentIndex, run: SessionRun, phase: SessionPhase): Exercise | null {
  // `teach` n'a pas d'exercice : c'est une présentation, l'écran la rend depuis `phase.conceptIds`.
  switch (phase.kind) {
    case "warmup":
    case "review":
      // Réveil : format le plus simple, pour commencer par gagner.
      return buildReviewExercise(content, phase.item.conceptId, reviewSeed(run, phase.index), phase.kind === "warmup" ? "listen_pick_text" : undefined, {
        known: run.knownAtStart,
        stepIndex: phase.index,
        allowTtsTone: ttsAllowed(true),
        // Formats riches (contrat phase6 §5) : les vues fill_gap et match_pairs existent (src/exercises).
        richFormats: true,
      });
    case "new":
    case "practice": {
      const item = currentItem(phase.lesson);
      const lesson = content.lessons.get(phase.lesson.lessonId);
      return item && lesson ? buildExercise(content, lesson, item.stepIndex, run.sessionId) : null;
    }
    default:
      return null;
  }
}

/** Exercice plus facile sur un concept : image si possible, sinon choix entre 2 options. null si rien de plus simple. */
export function easierExercise(content: ContentIndex, run: SessionRun, conceptId: ConceptId): Exercise | null {
  const known = run.knownAtStart;
  const media = contentMedia(content);
  const formats = reviewFormats(content, conceptId, { known, media });
  const hint = formats.includes("listen_pick_image") ? "listen_pick_image" : formats.includes("listen_pick_text") ? "listen_pick_text" : undefined;
  if (!hint && formats.length > 0) return null;
  try {
    return buildReviewExercise(content, conceptId, `${run.sessionId}:easier:${conceptId}`, hint, { known, media, maxOptions: 2, allowTtsTone: false, stepIndex: -1 });
  } catch {
    return null;
  }
}

export function givenText(exercise: Exercise, response: ExerciseResponse): string {
  if (response.kind === "choice" && "options" in exercise) {
    const option = exercise.options.find((o) => o.id === response.optionId);
    return option?.text ?? (option?.label ? l(option.label) : option?.tones ? toneLabel(option.tones) : "");
  }
  if (response.kind === "tokens" && exercise.type === "build_sentence") {
    const byId = new Map(exercise.tokens.map((t) => [t.id, t.text ?? ""]));
    return response.optionIds.map((id) => byId.get(id) ?? "").join(" ");
  }
  // Réponses du catalogue complet (contrat phase6) : ce que l'apprenant a dit, pour « Cô Mai, pourquoi ? ».
  if (response.kind === "text") return response.text;
  if (response.kind === "pairs" && exercise.type === "match_pairs") {
    const label = (options: readonly { id: string; text?: string; label?: Localized }[], id: string) => {
      const option = options.find((o) => o.id === id);
      return option?.text ?? (option?.label ? l(option.label) : id);
    };
    return response.pairs.map((p) => `${label(exercise.left, p.leftId)} → ${label(exercise.right, p.rightId)}`).join(" · ");
  }
  if (response.kind === "path" && exercise.type === "dialogue_choice") {
    const replies = new Map(exercise.turns.flatMap((turn) => turn.replies.map((r) => [r.id, r.vi ?? (r.label ? l(r.label) : r.id)] as const)));
    return response.turnIds.map((id) => replies.get(id) ?? id).join(" · ");
  }
  return "";
}

/**
 * Récompenses d'une séance terminée (contrat phase9 §5). Séparée du bilan : le bilan dit ce qu'on a
 * appris (XP, série, mots), les félicitations disent ce qu'on a **gagné** — deux moments, deux
 * responsabilités. Rien ici n'est nécessaire à la progression, donc tout y est facultatif.
 */
async function grantRewards(content: ContentIndex, recap: SessionRecap): Promise<void> {
  if (Object.keys(recap.counters).length === 0) return;
  const celebrations = await awardSession({
    xp: recap.xp,
    perfect: (recap.counters.perfectLessons ?? 0) > 0,
    counters: recap.counters,
    streakDays: recap.streak.current,
    bestStreak: recap.bestStreak,
    knownWords: recap.knownWords,
    pack: content.pack,
    day: recap.localDate,
  });
  celebrate(celebrations);
}

export const useSession = create<SessionState>((set, get) => {
  /** Avance jusqu'au prochain exercice jouable, en enregistrant leçon et bilan au passage. */
  async function advance(content: ContentIndex, start: SessionRun): Promise<void> {
    let run = start;
    for (;;) {
      const phase = sessionPhase(run, content);
      if (phase.kind === "save_lesson") {
        run = await saveLessonPart(content, run);
        continue;
      }
      if (phase.kind === "recap") {
        set({ status: "loading", run, remedial: null, pendingRemedial: null });
        const recap = await finishSession(content, run);
        set({ recap, status: "done", feedback: null, exercise: null, phase });
        // Fin de séance : l'outbox part tout de suite (contrat phase5 §4).
        void syncEngine.flush({ force: true }).catch(() => undefined);
        // Récompenses (contrat phase9 §5) : hors de la transaction pédagogique, et **après** que le
        // bilan est affiché — les cartes de félicitations se posent par-dessus, elles n'attendent
        // pas. Un échec de récompense ne doit jamais faire échouer une séance.
        void grantRewards(content, recap).catch(() => undefined);
        return;
      }
      set({ run, phase, exercise: exerciseFor(content, run, phase), feedback: null, given: "", shownAt: performance.now(), status: "answering", remedial: null });
      return;
    }
  }

  return {
    status: "idle",
    content: null,
    run: null,
    phase: null,
    exercise: null,
    shownAt: 0,
    feedback: null,
    given: "",
    recap: null,
    error: null,
    remedial: null,
    pendingRemedial: null,

    async open(content, request) {
      set({ status: "loading", content, run: null, exercise: null, recap: null, feedback: null, error: null, remedial: null, pendingRemedial: null });
      try {
        const availability = await sessionAvailability(content, request);
        if (availability === "empty") {
          set({ status: "empty" });
          return;
        }
        // Garde de lien profond : une leçon non débloquée renvoie au hub (contrat phase5 §2).
        if (request.source === "lesson" && availability !== "resume" && !(await isLessonOpen(content, request.lessonId))) {
          set({ status: "locked" });
          return;
        }
        await advance(content, await openSession(content, request));
      } catch (e) {
        // Leçon d'une unité ni chargée ni téléchargée, hors ligne (spec §8.1) : message clair plutôt qu'une erreur technique.
        const message = e instanceof UnitUnavailableError ? t("offline.unitUnavailable") : e instanceof Error ? e.message : String(e);
        set({ status: "error", error: message });
      }
    },

    async answer(response) {
      const { content, run, exercise, shownAt, status, remedial } = get();
      if (!content || !run || !exercise || status !== "answering") return;
      const evaluation = evaluate(exercise, response);
      if (remedial) {
        // Entraînement : ni événement ni SRS, seulement le retour.
        set({ feedback: { ...evaluation, graded: true }, given: givenText(exercise, response), status: "feedback" });
        return;
      }
      const next = await submitSessionAnswer(content, run, exercise, evaluation, performance.now() - shownAt);
      // Réussite : on enchaîne sans écran intermédiaire (spec §4.5). Non noté : idem.
      if (!evaluation.graded) {
        await advance(content, next);
        return;
      }
      const nudge = next.lesson?.tutorNudge ?? null;
      const pendingRemedial = !evaluation.correct && nudge && next.lesson?.errorStreaks[nudge] === TUTOR_NUDGE_AFTER ? nudge : null;
      set({ run: next, feedback: evaluation, given: givenText(exercise, response), status: "feedback", pendingRemedial });
    },

    async taught() {
      const { content, run, phase } = get();
      if (!content || !run || phase?.kind !== "teach") return;
      await advance(content, await markSessionTaught(content, run));
    },

    async next() {
      const { content, run, pendingRemedial, remedial } = get();
      if (!content || !run) return;
      if (pendingRemedial && !remedial) {
        const easier = easierExercise(content, run, pendingRemedial);
        if (easier) {
          set({ exercise: easier, remedial: pendingRemedial, pendingRemedial: null, feedback: null, given: "", shownAt: performance.now(), status: "answering" });
          return;
        }
      }
      set({ pendingRemedial: null });
      await advance(content, run);
    },

    reset() {
      set({ status: "idle", run: null, phase: null, exercise: null, feedback: null, recap: null, error: null, remedial: null, pendingRemedial: null });
    },
  };
});
