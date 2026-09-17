import {
  generateLoToCard,
  isLoToMarked,
  isLoToOver,
  loToCall,
  loToLines,
  loToPool,
  loToResult,
  markLoTo,
  skipLoToCall,
  startLoTo,
  type Concept,
  type ContentIndex,
  type Exercise,
  type ExerciseResponse,
  type GameResult,
  type LoToCard,
  type LoToResult,
} from "@parlo/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playConcept, ttsAllowed, type PlaybackSource } from "../audio.ts";
import { Button, Vi } from "../components/ui.tsx";
import { ProgressBar } from "../design/index.ts";
import { l, t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";
import { GameEmpty, GameIntro, GameLayout, GameResultScreen, ReplayButton, SourceMarker } from "./GameShell.tsx";
import { playChime, preloadConceptAudio } from "./platform.ts";

/**
 * Lô tô (contrat phase9 §7) — interface. Une grille de mots, une voix qui appelle, une case à
 * toucher. Tout en DOM : aucune animation pendant qu'on cherche, seule la barre de temps bouge.
 *
 * Mode silencieux (ou audio absent) : c'est le **sens** qui est appelé, en langue d'interface —
 * l'exercice reste un exercice (mot ↔ sens) au lieu de devenir injouable (spec §13).
 */

/** Temps d'un appel. Large : on cherche dans une grille, ce n'est pas un test de réflexes. */
export const LO_TO_CALL_MS = 9000;
const TICK_MS = 250;
const END_PAUSE_MS = 700;
const TEST_ID = "lo-to";

type Mode = "audio" | "gloss";

/** Pool et mode : à l'oreille si on peut, au sens sinon. */
export function prepareLoTo(concepts: readonly Concept[], silent: boolean): { pool: Concept[]; mode: Mode } {
  if (!silent) {
    const pool = loToPool(concepts, { requireNative: !ttsAllowed(false) });
    if (pool.length >= 6) return { pool, mode: "audio" };
  }
  // Au sens : n'importe quel concept avec une forme écrite fait l'affaire.
  const seen = new Set<string>();
  const pool = concepts.filter((concept) => {
    if (!concept.vi || seen.has(concept.vi)) return false;
    seen.add(concept.vi);
    return true;
  });
  return { pool, mode: "gloss" };
}

interface LoToProps {
  content: ContentIndex;
  concepts: readonly Concept[];
  seed: string;
  onSkip?: () => void;
  onStart?: () => void;
  onFinish?: (result: LoToResult) => void;
  resultActions: (result: GameResult, replay: () => void) => ReactNode;
  introExtra?: ReactNode;
  resultExtra?: ReactNode;
}

type Phase = { name: "intro" } | { name: "playing" } | { name: "result"; result: LoToResult };

export function LoTo({ content, concepts, seed, onSkip, onStart, onFinish, resultActions, introExtra, resultExtra }: LoToProps) {
  const silent = usePrefs((s) => s.silent);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const { pool, mode } = useMemo(() => prepareLoTo(concepts, silent), [concepts, silent]);
  const card = useMemo(() => generateLoToCard(pool, `${seed}:${attempt}`), [pool, seed, attempt]);

  if (card.cells.length === 0) return <GameEmpty testId={TEST_ID} message={t("loTo.notEnough")} onSkip={onSkip} />;

  if (phase.name === "intro") {
    return (
      <GameIntro
        testId={TEST_ID}
        name="Lô tô"
        tagline={t(mode === "audio" ? "loTo.tagline" : "loTo.taglineGloss")}
        rules={t(mode === "audio" ? "loTo.rules" : "loTo.rulesGloss")}
        art={<LoToArt className="w-28 self-end" />}
        onPlay={() => {
          onStart?.();
          setPhase({ name: "playing" });
        }}
        onSkip={onSkip}
        extra={introExtra}
      />
    );
  }

  if (phase.name === "result") {
    const replay = () => {
      onStart?.();
      setAttempt((a) => a + 1);
      setPhase({ name: "playing" });
    };
    return (
      <GameResultScreen
        testId={TEST_ID}
        title={t("loTo.resultTitle")}
        result={phase.result}
        actions={resultActions(phase.result, replay)}
        extra={
          <>
            <p className="text-phu-sa">{t("loTo.resultLines", { n: phase.result.lines })}</p>
            {phase.result.fullCard && <p className="font-semibold text-nghe-ecrit">{t("loTo.fullCard")}</p>}
            {resultExtra}
          </>
        }
      />
    );
  }

  return (
    <LoToPlay
      key={attempt}
      content={content}
      card={card}
      mode={mode}
      onSkip={onSkip}
      onDone={(result) => {
        onFinish?.(result);
        setPhase({ name: "result", result });
      }}
    />
  );
}

// ---------------------------------------------------------------------------

function LoToPlay({ content, card, mode, onSkip, onDone }: {
  content: ContentIndex;
  card: LoToCard;
  mode: Mode;
  onSkip: (() => void) | undefined;
  onDone: (result: LoToResult) => void;
}) {
  const [state, setState] = useState(() => startLoTo(card));
  const [left, setLeft] = useState(LO_TO_CALL_MS);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [feedback, setFeedback] = useState<"hit" | "miss" | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const call = loToCall(state);
  const called = call ? content.concepts.get(call) : undefined;

  useEffect(() => {
    for (const id of card.cells) {
      const concept = content.concepts.get(id);
      if (concept && mode === "audio") preloadConceptAudio(content, concept);
    }
  }, [card, content, mode]);

  // Nouvel appel : on le joue, et le temps repart. Un seul effet pour les deux — ils vont ensemble.
  useEffect(() => {
    if (!called) return;
    setLeft(LO_TO_CALL_MS);
    if (mode === "audio") void playConcept(content, called, { allowTts: ttsAllowed(false) }).then(setSource);
  }, [called, content, mode]);

  // Le sablier. Un intervalle qui ne fait que décompter : pas d'animation CSS (c'est une
  // information, elle doit rester juste en mouvement réduit) et **aucun effet de bord dans un
  // updater** — React peut les rejouer, un appel serait sauté deux fois.
  useEffect(() => {
    if (!called) return;
    const id = window.setInterval(() => setLeft((ms) => Math.max(0, ms - TICK_MS)), TICK_MS);
    return () => window.clearInterval(id);
  }, [called]);

  // Temps écoulé : l'appel est manqué, le suivant arrive. Personne n'est puni (spec §3.3).
  useEffect(() => {
    if (left > 0 || !called) return;
    setFeedback("miss");
    setState((s) => (loToCall(s) === null ? s : skipLoToCall(s)));
  }, [left, called]);

  // Fin de partie : une respiration, puis le bilan.
  useEffect(() => {
    if (!isLoToOver(state)) return;
    const id = window.setTimeout(() => onDoneRef.current(loToResult(state)), END_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  const touch = (index: number) => {
    if (!call || isLoToMarked(state, index)) return;
    const hit = state.cells[index] === call;
    setFeedback(hit ? "hit" : "miss");
    if (hit) playChime();
    setState((s) => markLoTo(s, index));
  };

  const lines = loToLines(state);
  const inLine = new Set(lines.flat());
  const replay = () => {
    if (called && mode === "audio") void playConcept(content, called, { allowTts: ttsAllowed(false) }).then(setSource);
  };

  return (
    <GameLayout
      testId={TEST_ID}
      attrs={{ "data-found": state.found.length, "data-missed": state.missed.length, "data-mode": mode, "data-call": state.index }}
    >
      <div className="flex items-baseline justify-between gap-4 pb-2">
        <p className="text-sm text-phu-sa tabular-nums">{t("loTo.progress", { done: state.index, n: state.calls.length })}</p>
        <p className="text-sm font-semibold text-ngoc tabular-nums">{t("loTo.lines", { n: lines.length })}</p>
      </div>
      <ProgressBar value={left} max={LO_TO_CALL_MS} size="sm" tone="nghe" label={t("loTo.timeLeft")} className="mb-4" />

      {/* L'appel : la voix, ou le sens en mode silencieux. Jamais le mot écrit — ce serait la réponse. */}
      <div className="flex items-center justify-center gap-4 pb-4" data-testid="lo-to-call">
        {mode === "audio" ? (
          <>
            <ReplayButton label={t("loTo.replay")} onClick={replay} />
            <p className="text-phu-sa">{t("loTo.listen")}</p>
          </>
        ) : (
          <p className="text-center text-lg font-semibold">{called ? l(called.gloss) : ""}</p>
        )}
      </div>

      <div role="group" aria-label={t("loTo.grid")} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${card.cols}, minmax(0, 1fr))` }}>
        {state.cells.map((id, index) => {
          const concept = content.concepts.get(id);
          const found = state.found.includes(id);
          const missed = state.missed.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => touch(index)}
              disabled={found || missed}
              data-cell={index}
              data-state={found ? "found" : missed ? "missed" : "open"}
              aria-label={t("loTo.cell", { word: concept?.vi ?? "" })}
              className={`grid aspect-[4/3] min-h-11 place-items-center rounded-card border-2 px-1 transition-[background-color,border-color,transform] motion-safe:active:scale-[.98] ${
                found
                  ? inLine.has(index)
                    ? "border-nghe bg-nghe/20"
                    : "border-ngoc bg-ngoc-sang"
                  : missed
                    ? "border-line bg-surface-2 opacity-60"
                    : "border-line-strong bg-surface"
              }`}
            >
              <Vi size="2xl" className="text-center leading-snug break-words">{concept?.vi ?? ""}</Vi>
            </button>
          );
        })}
      </div>

      <p className="min-h-7 pt-3 text-center font-semibold" role="status" aria-live="polite">
        {feedback === "hit" ? t("loTo.hit") : feedback === "miss" ? t("loTo.miss") : ""}
      </p>
      <div className="flex items-center justify-between gap-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SourceMarker source={source} />
        {onSkip && (
          <button type="button" onClick={onSkip} className="min-h-11 px-3 text-ngoc underline-offset-4 hover:underline">
            {t("games.skip")}
          </button>
        )}
      </div>
    </GameLayout>
  );
}

/** Affiche du jeu : un carton de loto et deux jetons. */
export function LoToArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect x="10" y="10" width="76" height="56" rx="8" fill="var(--color-surface)" stroke="var(--color-ngoc)" strokeWidth="3" />
      <path d="M10 29h76M10 48h76M35 10v56M61 10v56" stroke="var(--color-ngoc)" strokeWidth="2" opacity="0.7" />
      <circle cx="23" cy="19.5" r="7" fill="var(--color-nghe)" />
      <circle cx="73" cy="57" r="7" fill="var(--color-nghe)" />
      <circle cx="99" cy="26" r="11" fill="none" stroke="var(--color-son-mai)" strokeWidth="3" />
      <circle cx="99" cy="26" r="4" fill="var(--color-son-mai)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Bloc 4 d'une séance : étape `game` avec `game: "lo_to"`

export function LoToExercise({ exercise, content, onAnswer, locked }: {
  exercise: Extract<Exercise, { type: "game" }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}) {
  const concepts = useMemo(
    () =>
      exercise.conceptIds.flatMap((id): Concept[] => {
        const concept = content.concepts.get(id);
        return concept ? [concept] : [];
      }),
    [exercise, content],
  );
  const [seed] = useState(() => `${exercise.stepIndex}:${Date.now()}`);
  return (
    <LoTo
      content={content}
      concepts={concepts}
      seed={seed}
      onSkip={() => onAnswer({ kind: "skip" })}
      resultActions={(result) => (
        <Button disabled={locked} onClick={() => onAnswer(result.total > 0 ? { kind: "game", correct: result.correct, total: result.total } : { kind: "skip" })}>
          {t("games.continue")}
        </Button>
      )}
    />
  );
}
