import {
  CA_PHE_DEFAULTS,
  caPheNext,
  caPheOrder,
  caPhePool,
  caPheResult,
  generateCaPheOrders,
  isCaPheOver,
  nextCaPhe,
  serveCaPhe,
  startCaPhe,
  type CaPheOrder,
  type CaPheResult,
  type Concept,
  type ContentIndex,
  type Exercise,
  type ExerciseResponse,
  type GameResult,
} from "@parlo/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playConcept, ttsAllowed, type PlaybackSource } from "../audio.ts";
import { Button, Vi } from "../components/ui.tsx";
import { Icon } from "../design/index.ts";
import { l, t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";
import { GameEmpty, GameIntro, GameLayout, GameResultScreen, ReplayButton, SourceMarker } from "./GameShell.tsx";
import { playChime, preloadConceptAudio } from "./platform.ts";

/**
 * Cà phê sữa đá (contrat phase9 §7) — interface. Le client commande, on sert **dans l'ordre**.
 *
 * L'ordre est la difficulté : c'est ce qu'aucun autre jeu ne travaille. Une erreur termine la
 * commande, jamais la partie (spec §3.3) — le client suivant arrive, et on voit ce qu'il fallait
 * servir.
 *
 * Mode silencieux (ou audio absent) : la commande s'affiche en sens, dans l'ordre — on lit au lieu
 * d'écouter, mais l'exercice d'ordre reste entier.
 */

/** Écart entre deux articles de la commande : `playConcept` rend la main au démarrage, pas à la fin. */
const ITEM_GAP_MS = 950;
const WRONG_PAUSE_MS = 1400;
const END_PAUSE_MS = 700;
const TEST_ID = "ca-phe";

type Mode = "audio" | "gloss";

export function prepareCaPhe(concepts: readonly Concept[], silent: boolean): { pool: Concept[]; mode: Mode } {
  if (!silent) {
    const pool = caPhePool(concepts, { requireNative: !ttsAllowed(false) });
    if (pool.length >= CA_PHE_DEFAULTS.minPool) return { pool, mode: "audio" };
  }
  const seen = new Set<string>();
  const pool = concepts.filter((concept) => {
    if (!concept.vi || seen.has(concept.vi)) return false;
    seen.add(concept.vi);
    return true;
  });
  return { pool, mode: "gloss" };
}

interface CaPheProps {
  content: ContentIndex;
  concepts: readonly Concept[];
  seed: string;
  onSkip?: () => void;
  onStart?: () => void;
  onFinish?: (result: CaPheResult) => void;
  resultActions: (result: GameResult, replay: () => void) => ReactNode;
  introExtra?: ReactNode;
  resultExtra?: ReactNode;
}

type Phase = { name: "intro" } | { name: "playing" } | { name: "result"; result: CaPheResult };

export function CaPhe({ content, concepts, seed, onSkip, onStart, onFinish, resultActions, introExtra, resultExtra }: CaPheProps) {
  const silent = usePrefs((s) => s.silent);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const { pool, mode } = useMemo(() => prepareCaPhe(concepts, silent), [concepts, silent]);
  const orders = useMemo(() => generateCaPheOrders(pool, `${seed}:${attempt}`), [pool, seed, attempt]);

  if (orders.length === 0) return <GameEmpty testId={TEST_ID} message={t("caPhe.notEnough")} onSkip={onSkip} />;

  if (phase.name === "intro") {
    return (
      <GameIntro
        testId={TEST_ID}
        name="Cà phê sữa đá"
        tagline={t(mode === "audio" ? "caPhe.tagline" : "caPhe.taglineGloss")}
        rules={t(mode === "audio" ? "caPhe.rules" : "caPhe.rulesGloss")}
        art={<CaPheArt className="w-28 self-end" />}
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
        title={t("caPhe.resultTitle")}
        result={phase.result}
        actions={resultActions(phase.result, replay)}
        extra={
          <>
            <p className="text-phu-sa">{t("caPhe.resultItems", { n: phase.result.items })}</p>
            {resultExtra}
          </>
        }
      />
    );
  }

  return (
    <CaPhePlay
      key={attempt}
      content={content}
      orders={orders}
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

function CaPhePlay({ content, orders, mode, onSkip, onDone }: {
  content: ContentIndex;
  orders: CaPheOrder[];
  mode: Mode;
  onSkip: (() => void) | undefined;
  onDone: (result: CaPheResult) => void;
}) {
  const [state, setState] = useState(() => startCaPhe(orders));
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const timers = useRef<number[]>([]);
  const order = caPheOrder(state);
  const expected = caPheNext(state);

  useEffect(() => {
    for (const order of orders) {
      for (const id of order.choices) {
        const concept = content.concepts.get(id);
        if (concept && mode === "audio") preloadConceptAudio(content, concept);
      }
    }
  }, [orders, content, mode]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  /** Dit la commande, article par article, espacés — sinon tout se joue en même temps. */
  const speak = useCallback(
    (items: readonly string[]) => {
      if (mode !== "audio") return;
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = items.map((id, i) =>
        window.setTimeout(() => {
          const concept = content.concepts.get(id);
          if (concept) void playConcept(content, concept, { allowTts: ttsAllowed(false) }).then(setSource);
        }, i * ITEM_GAP_MS),
      );
    },
    [content, mode],
  );

  // Nouvelle commande : le client parle.
  useEffect(() => {
    if (order && !state.wrong) speak(order.items);
    // `state.index` suffit : c'est le seul changement qui vaut une nouvelle commande.
  }, [state.index, state.wrong, order, speak]);

  // Commande ratée : on montre ce qu'il fallait, puis le client suivant arrive.
  useEffect(() => {
    if (!state.wrong) return;
    const id = window.setTimeout(() => setState((s) => (s.wrong ? nextCaPhe(s) : s)), WRONG_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [state.wrong]);

  // Fin de partie : une respiration, puis le bilan.
  useEffect(() => {
    if (!isCaPheOver(state)) return;
    const id = window.setTimeout(() => onDoneRef.current(caPheResult(state)), END_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  const serve = (id: string) => {
    if (expected === null) return;
    if (id === expected) playChime();
    setState((s) => serveCaPhe(s, id));
  };

  if (!order) return <GameLayout testId={TEST_ID}><div /></GameLayout>;

  const done = state.served.length;
  return (
    <GameLayout
      testId={TEST_ID}
      attrs={{ "data-order": state.index, "data-served": done, "data-done": state.done, "data-failed": state.failed, "data-mode": mode }}
    >
      <div className="flex items-baseline justify-between gap-4 pb-3">
        <p className="text-sm text-phu-sa tabular-nums">{t("caPhe.progress", { done: state.index + 1, n: orders.length })}</p>
        <p className="text-sm font-semibold text-ngoc tabular-nums">{t("caPhe.served", { n: state.done })}</p>
      </div>

      {/* Le client. En mode audio : la voix et les jetons de ce qui reste à servir, pas les mots. */}
      <div className="flex items-center gap-4 rounded-card border border-line bg-surface px-4 py-3" data-testid="ca-phe-order">
        <CustomerArt className="w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-phu-sa">{t("caPhe.customer")}</p>
          {mode === "audio" ? (
            <ul className="flex flex-wrap items-center gap-1.5 pt-1">
              {order.items.map((id, i) => (
                <li
                  key={`${id}:${i}`}
                  aria-label={i < done ? t("caPhe.slot.served", { i: i + 1 }) : t("caPhe.slot.waiting", { i: i + 1 })}
                  className={`grid size-7 place-items-center rounded-full border-2 text-sm font-semibold tabular-nums ${
                    i < done ? "border-ngoc bg-ngoc text-nuoc" : "border-line-strong text-phu-sa"
                  }`}
                >
                  {i < done ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}
                </li>
              ))}
            </ul>
          ) : (
            <ol className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-1">
              {order.items.map((id, i) => {
                const concept = content.concepts.get(id);
                return (
                  <li key={`${id}:${i}`} className={`text-lg ${i < done ? "text-phu-sa line-through" : "font-semibold"}`}>
                    {i > 0 && <span className="pr-1 text-phu-sa">·</span>}
                    {concept ? l(concept.gloss) : ""}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {mode === "audio" && <ReplayButton label={t("caPhe.replay")} size="md" onClick={() => speak(order.items)} />}
      </div>

      {/* Le comptoir. */}
      <div role="group" aria-label={t("caPhe.counter")} className="grid grid-cols-2 gap-2 pt-4 sm:grid-cols-3">
        {order.choices.map((id) => {
          const concept = content.concepts.get(id);
          const wasWrong = state.wrong && expected === null;
          const isAnswer = wasWrong && order.items[state.served.length] === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => serve(id)}
              disabled={state.wrong}
              data-choice={id}
              data-answer={isAnswer || undefined}
              className={`grid min-h-[4.5rem] place-items-center rounded-card border-2 px-2 py-2 transition-[background-color,border-color,transform] disabled:opacity-70 motion-safe:active:scale-[.98] ${
                isAnswer ? "border-ngoc bg-ngoc-sang" : "border-line-strong bg-surface"
              }`}
            >
              <Vi size="2xl" className="text-center leading-snug break-words">{concept?.vi ?? ""}</Vi>
            </button>
          );
        })}
      </div>

      <p className="min-h-7 pt-3 text-center font-semibold" role="status" aria-live="polite">
        {state.wrong ? t("caPhe.wrong") : done > 0 ? t("caPhe.good") : ""}
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

/** Affiche du jeu : le verre de café glacé et sa cuillère. */
export function CaPheArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <path d="M38 16h44l-6 56H44z" fill="var(--color-surface)" stroke="var(--color-phu-sa)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M40 36h40l-4 36H44z" fill="var(--color-phu-sa)" opacity="0.75" />
      <path d="M42 46h36" stroke="var(--color-surface)" strokeWidth="3" opacity="0.8" />
      <path d="M66 10v34" stroke="var(--color-ngoc)" strokeWidth="3" strokeLinecap="round" />
      <path d="M86 26c10 0 10 14 0 14" fill="none" stroke="var(--color-nghe)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Le client : une silhouette au trait, jamais un visage reconnaissable. */
function CustomerArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <g fill="none" stroke="var(--color-ngoc)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="24" cy="16" r="8" />
        <path d="M8 44c2-9 8-14 16-14s14 5 16 14" />
        <path d="M12 12L24 4l12 8z" fill="var(--color-nghe)" stroke="var(--color-nghe)" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Bloc 4 d'une séance : étape `game` avec `game: "ca_phe"`

export function CaPheExercise({ exercise, content, onAnswer, locked }: {
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
    <CaPhe
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
