import {
  canFlipNhoMat,
  flipNhoMat,
  generateNhoMatDeck,
  hideNhoMat,
  isNhoMatOver,
  NHO_MAT_DEFAULTS,
  nhoMatColumns,
  nhoMatMismatch,
  nhoMatPool,
  nhoMatResult,
  startNhoMat,
  type Concept,
  type ContentIndex,
  type Exercise,
  type ExerciseResponse,
  type GameResult,
  type NhoMatCard,
  type NhoMatMode,
  type NhoMatResult,
} from "@parlo/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playConcept, ttsAllowed, type PlaybackSource } from "../audio.ts";
import { Button, Vi } from "../components/ui.tsx";
import { mediaUrl } from "../content.ts";
import { l, t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";
import { GameEmpty, GameIntro, GameLayout, GameResultScreen, SourceMarker } from "./GameShell.tsx";
import { playChime, preloadConceptAudio, useReducedMotion } from "./platform.ts";

/**
 * Nhớ mặt (mémoire, spec §5.6.6) — interface. Grille de cartes en DOM, retournement
 * en CSS 3D (transform) ; mouvement réduit : simple fondu. Logique dans @parlo/core.
 * Mode silencieux (ou pas assez d'audio) : paires image ↔ mot écrit.
 */

const MISMATCH_MS = 1100;
const END_PAUSE_MS = 700;
const TEST_ID = "nho-mat";

/** Pool et mode : audio si possible (pas un exercice de tons : synthèse tolérée et signalée), sinon mot écrit. */
export function prepareNhoMat(concepts: readonly Concept[], silent: boolean): { pool: Concept[]; mode: NhoMatMode } {
  if (!silent) {
    const pool = nhoMatPool(concepts, { mode: "audio", requireNative: !ttsAllowed(false) });
    if (pool.length >= NHO_MAT_DEFAULTS.minPairs) return { pool, mode: "audio" };
  }
  return { pool: nhoMatPool(concepts, { mode: "text" }), mode: "text" };
}

/** Mots illustrés des leçons terminées ; complétés par ceux du début du parcours jusqu'à 8 paires. */
export function nhoMatStandalonePool(content: ContentIndex, completed: ReadonlySet<string>): { concepts: Concept[]; fromCompleted: boolean } {
  const lessonIds = content.curriculum.units.flatMap((u) => (u.status === "available" ? u.lessons : []));
  const illustrated = (ids: readonly string[]) => {
    const seen = new Set<string>();
    return ids.flatMap((id) => content.lessons.get(id)?.concepts ?? []).flatMap((id): Concept[] => {
      const c = content.concepts.get(id);
      if (!c?.image || seen.has(id)) return [];
      seen.add(id);
      return [c];
    });
  };
  const done = illustrated(lessonIds.filter((id) => completed.has(id)));
  if (done.length >= NHO_MAT_DEFAULTS.pairs) return { concepts: done, fromCompleted: true };
  const extra = illustrated(lessonIds).filter((c) => !done.some((d) => d.id === c.id));
  return { concepts: [...done, ...extra].slice(0, Math.max(done.length, NHO_MAT_DEFAULTS.pairs * 2)), fromCompleted: false };
}

interface NhoMatProps {
  content: ContentIndex;
  concepts: readonly Concept[];
  seed: string;
  onSkip?: () => void;
  onStart?: () => void;
  onFinish?: (result: NhoMatResult) => void;
  resultActions: (result: GameResult, replay: () => void) => ReactNode;
  introExtra?: ReactNode;
  resultExtra?: ReactNode;
}

type Phase = { name: "intro" } | { name: "playing" } | { name: "result"; result: NhoMatResult };

export function NhoMat({ content, concepts, seed, onSkip, onStart, onFinish, resultActions, introExtra, resultExtra }: NhoMatProps) {
  const silent = usePrefs((s) => s.silent);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const { pool, mode } = useMemo(() => prepareNhoMat(concepts, silent), [concepts, silent]);
  const deck = useMemo(() => generateNhoMatDeck(pool, `${seed}:${attempt}`, mode), [pool, seed, attempt, mode]);

  if (deck.length === 0) return <GameEmpty testId={TEST_ID} message={t("nhoMat.notEnough")} onSkip={onSkip} />;

  if (phase.name === "intro") {
    return (
      <GameIntro
        testId={TEST_ID}
        name="Nhớ mặt"
        tagline={t(mode === "audio" ? "nhoMat.tagline" : "nhoMat.taglineText")}
        rules={t(mode === "audio" ? "nhoMat.rules" : "nhoMat.rulesText")}
        art={<CardsArt className="w-28 self-end" />}
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
        title={t("nhoMat.resultTitle")}
        result={phase.result}
        actions={resultActions(phase.result, replay)}
        extra={
          <>
            <p className="text-phu-sa">{t("nhoMat.resultMoves", { n: phase.result.moves })}</p>
            {resultExtra}
          </>
        }
      />
    );
  }

  return (
    <NhoMatPlay
      key={attempt}
      content={content}
      deck={deck}
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

function NhoMatPlay({ content, deck, mode, onSkip, onDone }: {
  content: ContentIndex;
  deck: NhoMatCard[];
  mode: NhoMatMode;
  onSkip: (() => void) | undefined;
  onDone: (result: NhoMatResult) => void;
}) {
  const reduced = useReducedMotion();
  const [state, setState] = useState(() => startNhoMat(deck));
  const [feedback, setFeedback] = useState<"match" | "miss" | null>(null);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  /** Cartes son dont l'audio manque : le mot s'affiche (jamais de carte muette injouable). */
  const [spelled, setSpelled] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef<number | undefined>(undefined);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const cols = nhoMatColumns(deck.length);

  useEffect(() => {
    if (mode !== "audio") return;
    for (const card of deck) {
      const c = content.concepts.get(card.conceptId);
      if (card.face === "audio" && c) preloadConceptAudio(content, c);
    }
  }, [deck, mode, content]);

  useEffect(() => () => window.clearTimeout(pending.current), []);

  const play = (card: NhoMatCard) => {
    const concept = content.concepts.get(card.conceptId);
    if (!concept) return;
    void playConcept(content, concept, { allowTts: ttsAllowed(false) }).then((s) => {
      setSource(s);
      if (s === "missing") setSpelled((prev) => new Set(prev).add(card.key));
    });
  };

  const flip = (index: number) => {
    const card = state.cards[index];
    if (!card) return;
    // Carte son déjà ouverte : on la réécoute.
    if (card.face === "audio" && (state.open.includes(index) || state.matched.includes(card.conceptId))) {
      play(card);
      return;
    }
    if (!canFlipNhoMat(state, index)) return;
    const next = flipNhoMat(state, index);
    setState(next);
    if (card.face === "audio") play(card);
    if (next.open.length === 0 && next.matched.length > state.matched.length) {
      playChime();
      setFeedback("match");
      if (isNhoMatOver(next)) pending.current = window.setTimeout(() => onDoneRef.current(nhoMatResult(next)), END_PAUSE_MS);
    } else if (nhoMatMismatch(next)) {
      setFeedback("miss");
      pending.current = window.setTimeout(() => {
        setState((s) => hideNhoMat(s));
        setFeedback(null);
      }, MISMATCH_MS);
    } else {
      setFeedback(null);
    }
  };

  const pairs = deck.length / 2;
  return (
    <GameLayout testId={TEST_ID} attrs={{ "data-moves": state.moves, "data-matched": state.matched.length, "data-open": state.open.length, "data-mode": mode }}>
      <div className="flex items-baseline justify-between gap-4 pb-3">
        <p className="text-sm text-phu-sa">{t("nhoMat.progress", { m: state.matched.length, n: pairs })}</p>
        <p className="text-sm font-semibold text-ngoc">{t("nhoMat.moves", { n: state.moves })}</p>
      </div>

      <div role="group" aria-label={t("nhoMat.grid")} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {state.cards.map((card, index) => {
          const matched = state.matched.includes(card.conceptId);
          const up = matched || state.open.includes(index);
          const concept = content.concepts.get(card.conceptId);
          return (
            <CardButton
              key={card.key}
              index={index}
              card={card}
              concept={concept}
              content={content}
              up={up}
              matched={matched}
              spelled={matched || spelled.has(card.key)}
              reduced={reduced}
              onFlip={() => flip(index)}
            />
          );
        })}
      </div>

      <p className="min-h-7 pt-3 text-center font-semibold" role="status" aria-live="polite">
        {feedback === "match" ? t("nhoMat.match") : feedback === "miss" ? t("nhoMat.miss") : ""}
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

function CardButton({ index, card, concept, content, up, matched, spelled, reduced, onFlip }: {
  index: number;
  card: NhoMatCard;
  concept: Concept | undefined;
  content: ContentIndex;
  up: boolean;
  matched: boolean;
  spelled: boolean;
  reduced: boolean;
  onFlip: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const i = index + 1;
  const word = concept?.vi ?? "";
  const label = !up
    ? t("nhoMat.card.hidden", { i })
    : card.face === "image"
      ? t("nhoMat.card.image", { i, gloss: concept ? l(concept.gloss) : "" })
      : card.face === "text"
        ? t("nhoMat.card.text", { i, word })
        : spelled
          ? t("nhoMat.card.audioWord", { i, word })
          : t("nhoMat.card.audio", { i });

  const front = (
    <span className={`absolute inset-0 grid place-items-center overflow-visible rounded-xl border-2 p-1 ${matched ? "border-nghe bg-nghe/15" : "border-ngoc bg-white"}`}>
      {card.face === "image" ? (
        concept?.image && !imageFailed ? (
          <img src={mediaUrl(content, concept.image)} alt="" draggable={false} onError={() => setImageFailed(true)} className="size-full object-contain" />
        ) : (
          <span className="text-center text-sm leading-tight">{concept ? l(concept.gloss) : ""}</span>
        )
      ) : card.face === "text" || spelled ? (
        <Vi size="2xl" className="px-0.5 text-center leading-snug break-words">{word}</Vi>
      ) : (
        <svg viewBox="0 0 24 24" className="size-9 text-ngoc" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
        </svg>
      )}
    </span>
  );
  const back = (
    <span className="absolute inset-0 grid place-items-center rounded-xl bg-ngoc">
      <CardBack />
    </span>
  );

  return (
    <button
      type="button"
      onClick={onFlip}
      aria-label={label}
      aria-pressed={up}
      data-card={index}
      data-up={up ? "true" : "false"}
      data-concept={up ? card.conceptId : undefined}
      className="relative aspect-square min-h-11 w-full touch-manipulation [perspective:700px]"
    >
      {reduced ? (
        <>
          <span className={`absolute inset-0 transition-opacity duration-200 ${up ? "opacity-0" : "opacity-100"}`}>{back}</span>
          <span className={`absolute inset-0 transition-opacity duration-200 ${up ? "opacity-100" : "opacity-0"}`}>{front}</span>
        </>
      ) : (
        <span
          className="absolute inset-0 transition-transform duration-300 ease-out [transform-style:preserve-3d]"
          style={{ transform: up ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          <span className="absolute inset-0 [backface-visibility:hidden]">{back}</span>
          <span className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">{front}</span>
        </span>
      )}
    </button>
  );
}

/** Dos de carte : losange curcuma sur laque jade (pas de dégradé). */
function CardBack() {
  return (
    <svg viewBox="0 0 40 40" className="size-1/2" aria-hidden>
      <path d="M20 6 34 20 20 34 6 20Z" fill="none" stroke="#E5A21B" strokeWidth="2" />
      <path d="M20 14 26 20 20 26 14 20Z" fill="#E5A21B" />
    </svg>
  );
}

export function CardsArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect x="6" y="14" width="44" height="58" rx="8" fill="#0E5E55" transform="rotate(-8 28 43)" />
      <path d="M28 32 38 43 28 54 18 43Z" fill="none" stroke="#E5A21B" strokeWidth="2" transform="rotate(-8 28 43)" />
      <rect x="62" y="8" width="44" height="58" rx="8" fill="#fff" stroke="#0E5E55" strokeWidth="3" transform="rotate(7 84 37)" />
      <path d="M74 32h6l7-6v22l-7-6h-6z" fill="#0E5E55" transform="rotate(7 84 37)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Bloc 4 d'une séance : étape `game` avec `game: "nho_mat"`

export function NhoMatExercise({ exercise, content, onAnswer, locked }: {
  exercise: Extract<Exercise, { type: "game" }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}) {
  const concepts = useMemo(
    () => exercise.conceptIds.flatMap((id): Concept[] => {
      const c = content.concepts.get(id);
      return c ? [c] : [];
    }),
    [exercise, content],
  );
  const [seed] = useState(() => `${exercise.stepIndex}:${Date.now()}`);
  return (
    <NhoMat
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
