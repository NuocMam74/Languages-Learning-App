import {
  answerChoNoi,
  choNoiBoatProgress,
  choNoiPool,
  contentMedia,
  choNoiResult,
  choNoiRoundDeadlineMs,
  generateChoNoiRounds,
  hasFeature,
  isChoNoiOver,
  startChoNoi,
  type ChoNoiOptions,
  type ChoNoiResult,
  type ChoNoiRound,
  type Concept,
  type ContentIndex,
} from "@parlo/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playConcept, ttsAllowed, type PlaybackSource } from "../audio.ts";
import { Button, Vi } from "../components/ui.tsx";
import { t } from "../i18n/index.ts";
import { BoatHull, Ripples } from "./Boat.tsx";
import { playChime, preloadConceptAudio, useReducedMotion } from "./platform.ts";

/**
 * Chợ nổi — interface. DOM + transforms CSS pilotés par requestAnimationFrame :
 * aucune re-rendu React par image, uniquement `style.transform` (translate3d).
 * Toute la logique (manches, distracteurs, score) vit dans @parlo/core.
 */

const BOAT_W = 160;
const BOAT_H = 104;
const RIGHT_PAUSE_MS = 650;
const MISS_PAUSE_MS = 1300;
/** Sans mouvement : minuterie plus douce que la traversée. */
const STATIC_TIME_FACTOR = 1.5;

/** Pool jouable (audio natif exigé hors développement pour un pack tonal, §7.4) → manches. */
export function prepareChoNoi(content: ContentIndex, concepts: readonly Concept[], seed: string, options: Partial<ChoNoiOptions> = {}): ChoNoiRound[] {
  // Pack tonal : items sans audio natif présent retirés (sauf repli de synthèse, contrat phase5 §1).
  const pool = choNoiPool(concepts, { requireNative: !ttsAllowed(hasFeature(content.pack, "tones")), media: contentMedia(content) });
  return generateChoNoiRounds(pool, seed, options, content.pack.toneSystem?.heardClasses);
}

interface ChoNoiProps {
  content: ContentIndex;
  concepts: readonly Concept[];
  seed: string;
  options?: Partial<ChoNoiOptions>;
  /** Passer le jeu (séance) : absent en jeu libre. */
  onSkip?: () => void;
  /** Appelé au début de chaque partie (Jouer, Rejouer). */
  onStart?: () => void;
  /** Appelé une fois à la fin de chaque partie. */
  onFinish?: (result: ChoNoiResult) => void;
  /** Actions de l'écran de résultat ; `replay` relance une partie. */
  resultActions: (result: ChoNoiResult, replay: () => void) => ReactNode;
  introExtra?: ReactNode;
  resultExtra?: ReactNode;
  /**
   * Mode chronométré (défi express) : affiche le temps de jeu restant
   * (`options.durationMs`) au lieu du numéro de barque. Facultatif, absent = comportement habituel.
   */
  timed?: boolean;
}

type Phase = { name: "intro" } | { name: "playing" } | { name: "result"; result: ChoNoiResult };

export function ChoNoi({ content, concepts, seed, options, onSkip, onStart, onFinish, resultActions, introExtra, resultExtra, timed = false }: ChoNoiProps) {
  const reduced = useReducedMotion();
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const rounds = useMemo(() => prepareChoNoi(content, concepts, `${seed}:${attempt}`, options), [content, concepts, seed, attempt, options]);

  if (rounds.length === 0) {
    return (
      <GameLayout action={onSkip && <Button onClick={onSkip}>{t("games.continue")}</Button>}>
        <p className="grid flex-1 place-items-center text-center text-lg text-phu-sa">{t("games.choNoi.notEnough")}</p>
      </GameLayout>
    );
  }

  if (phase.name === "intro") {
    return (
      <GameLayout
        action={
          <div className="flex flex-col gap-2">
            <Button onClick={() => { onStart?.(); setPhase({ name: "playing" }); }}>{t("games.play")}</Button>
            {onSkip && <Button variant="quiet" onClick={onSkip}>{t("games.skipIntro")}</Button>}
          </div>
        }
      >
        <div className="flex flex-1 flex-col justify-center gap-5">
          <Vi size="vi-xl" className="text-ngoc">Chợ nổi</Vi>
          <p className="text-lg">{t("games.choNoi.tagline")}</p>
          <p className="text-phu-sa">{reduced ? t("games.choNoi.rulesStatic") : t("games.choNoi.rules")}</p>
          <BoatHull className="w-40 self-end" />
          {introExtra}
        </div>
      </GameLayout>
    );
  }

  if (phase.name === "result") {
    const { result } = phase;
    const replay = () => {
      onStart?.();
      setAttempt((a) => a + 1);
      setPhase({ name: "playing" });
    };
    return (
      <GameLayout action={<div className="flex flex-col gap-2">{resultActions(result, replay)}</div>}>
        <div className="flex flex-1 flex-col justify-center gap-4" role="status">
          <h2 className="font-serif text-2xl">{t("games.choNoi.resultTitle")}</h2>
          <p className="text-vi-xl font-semibold text-ngoc motion-safe:animate-[rise_600ms_ease-out]">
            {t("games.choNoi.result", { correct: result.correct, total: result.total })}
          </p>
          <p className="text-lg text-phu-sa">{t("games.choNoi.points", { n: result.points })}</p>
          {resultExtra}
        </div>
      </GameLayout>
    );
  }

  return (
    <ChoNoiPlay
      key={attempt}
      content={content}
      rounds={rounds}
      durationMs={options?.durationMs}
      timed={timed}
      reduced={reduced}
      onSkip={onSkip}
      onDone={(result) => {
        onFinish?.(result);
        setPhase({ name: "result", result });
      }}
    />
  );
}

function GameLayout({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col" data-testid="cho-noi">
      <div className="flex flex-1 flex-col">{children}</div>
      {action && <div className="sticky bottom-0 bg-nuoc pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Feedback {
  chosen: string | null;
  correct: boolean;
}

function ChoNoiPlay({ content, rounds, durationMs, timed, reduced, onSkip, onDone }: {
  content: ContentIndex;
  rounds: ChoNoiRound[];
  durationMs: number | undefined;
  timed: boolean;
  reduced: boolean;
  onSkip: (() => void) | undefined;
  onDone: (result: ChoNoiResult) => void;
}) {
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [points, setPoints] = useState(0);
  const [source, setSource] = useState<PlaybackSource | null>(null);

  const game = useRef(startChoNoi(rounds, durationMs));
  // Horloge de jeu mutable, lue par la boucle d'animation (pas d'état React par image).
  const clock = useRef({ game: 0, round: 0, frozen: true, index: 0, width: 360 });
  const boats = useRef(new Map<string, HTMLElement>());
  const timer = useRef<HTMLDivElement>(null);
  const countdown = useRef<HTMLSpanElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pending = useRef<number | undefined>(undefined);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const round = rounds[index] ?? rounds[0]!;
  const target = content.concepts.get(round.targetId);
  const deadlineOf = (r: ChoNoiRound) => choNoiRoundDeadlineMs(r) * (reduced ? STATIC_TIME_FACTOR : 1);

  const resolve = (chosen: string | null) => {
    const c = clock.current;
    if (c.frozen) return;
    c.frozen = true;
    const next = answerChoNoi({ ...game.current, elapsedMs: c.game }, chosen, c.round);
    game.current = next;
    const correct = next.answers.at(-1)?.correct ?? false;
    if (correct) playChime();
    setFeedback({ chosen, correct });
    setPoints(choNoiResult(next).points);
    pending.current = window.setTimeout(() => {
      if (isChoNoiOver(next)) onDoneRef.current(choNoiResult(next));
      else {
        setFeedback(null);
        setIndex((i) => i + 1);
      }
    }, correct ? RIGHT_PAUSE_MS : MISS_PAUSE_MS);
  };
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  // Largeur de la rivière : mesurée hors boucle (pas de lecture de layout par image).
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    clock.current.width = el.clientWidth;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) clock.current.width = entry.contentRect.width;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Nouvelle manche : horloge remise à zéro, audio joué, manche suivante préchargée.
  useEffect(() => {
    const c = clock.current;
    c.index = index;
    c.round = 0;
    c.frozen = false;
    setSource(null);
    let live = true;
    if (target) void playConcept(content, target, { allowTts: ttsAllowed(true) }).then((s) => live && setSource(s));
    const upcoming = rounds[index + 1];
    const upcomingTarget = upcoming && content.concepts.get(upcoming.targetId);
    if (upcomingTarget) preloadConceptAudio(content, upcomingTarget);
    return () => {
      live = false;
    };
  }, [index]);

  useEffect(() => () => window.clearTimeout(pending.current), []);

  // Boucle d'animation.
  useEffect(() => {
    const first = rounds[0];
    const firstTarget = first && content.concepts.get(first.targetId);
    if (firstTarget) preloadConceptAudio(content, firstTarget);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      // Onglet caché ou saccade : on borne le pas, le jeu ne « saute » pas.
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      const c = clock.current;
      const r = rounds[c.index];
      if (r && !c.frozen) {
        c.game += dt;
        c.round += dt;
        if (c.game >= game.current.durationMs) {
          c.frozen = true;
          onDoneRef.current(choNoiResult(game.current));
          return;
        }
        if (c.round >= deadlineOf(r)) resolveRef.current(null);
        paint(r, c.round, c.width);
        const clockEl = countdown.current;
        if (clockEl) {
          const text = formatClock(game.current.durationMs - c.game);
          if (clockEl.textContent !== text) clockEl.textContent = text;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    const paint = (r: ChoNoiRound, elapsed: number, width: number) => {
      if (reduced) {
        const bar = timer.current;
        if (bar) bar.style.transform = `scaleX(${Math.max(0, 1 - elapsed / deadlineOf(r))})`;
        return;
      }
      for (const boat of r.boats) {
        const el = boats.current.get(`${r.index}:${boat.conceptId}`);
        if (!el) continue;
        const p = choNoiBoatProgress(boat, r, elapsed);
        const x = -BOAT_W + p * (width + BOAT_W);
        const bob = Math.sin(elapsed / 520 + boat.lane * 1.7) * 3;
        el.style.transform = `translate3d(${x.toFixed(1)}px,${bob.toFixed(1)}px,0)`;
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const replayAudio = () => {
    if (target) void playConcept(content, target, { allowTts: ttsAllowed(true) }).then(setSource);
  };

  const boatRef = (key: string) => (el: HTMLElement | null) => {
    if (!el) return;
    boats.current.set(key, el);
    return () => {
      boats.current.delete(key);
    };
  };

  const laneCount = round.boats.length;
  const statusText = feedback
    ? feedback.correct
      ? t("games.choNoi.right")
      : t("games.choNoi.missed", { word: target?.vi ?? "" })
    : "";

  return (
    <div className="flex flex-1 flex-col" data-testid="cho-noi" data-round={index} data-phase={feedback ? "feedback" : "boats"}>
      <div className="flex items-baseline justify-between gap-4 pb-2">
        {timed ? (
          <p className="text-sm text-phu-sa">
            <span className="sr-only">{t("social.express.timeLeft")} </span>
            <span ref={countdown} role="timer" className="font-semibold tabular-nums text-muc">{formatClock(game.current.durationMs)}</span>
          </p>
        ) : (
          <p className="text-sm text-phu-sa">{t("games.choNoi.round", { i: index + 1, n: rounds.length })}</p>
        )}
        <p className="text-sm font-semibold text-ngoc">{t("games.choNoi.score", { n: points })}</p>
      </div>

      {reduced ? (
        <div className="flex flex-1 flex-col justify-end gap-3 pb-2">
          <div className="h-2 overflow-hidden rounded-full bg-phu-sa/10" title={t("games.choNoi.timer")} aria-hidden>
            <div ref={timer} className="h-full origin-left bg-nghe" />
          </div>
          {[...round.boats].sort((a, b) => a.lane - b.lane).map((boat) => {
            const isTarget = boat.conceptId === round.targetId;
            const state = boatState(feedback, isTarget, boat.conceptId);
            return (
              <button
                key={`${round.index}:${boat.conceptId}`}
                type="button"
                aria-label={t("games.choNoi.boat", { word: boat.text })}
                disabled={feedback !== null}
                onPointerDown={() => resolve(boat.conceptId)}
                onClick={() => resolve(boat.conceptId)}
                className={`flex min-h-20 items-center justify-between gap-4 rounded-2xl border-2 bg-white/80 px-4 py-2 ${signClass(state)}`}
              >
                <Vi size="vi">{boat.text}</Vi>
                <BoatHull className="w-20 shrink-0" />
              </button>
            );
          })}
        </div>
      ) : (
        <div ref={stage} className="relative -mx-5 flex-1 overflow-x-clip bg-ngoc" style={{ minHeight: laneCount * BOAT_H + 48 }}>
          <Ripples />
          {round.boats.map((boat) => {
            const key = `${round.index}:${boat.conceptId}`;
            const isTarget = boat.conceptId === round.targetId;
            const state = boatState(feedback, isTarget, boat.conceptId);
            return (
              <button
                key={key}
                ref={boatRef(key)}
                type="button"
                aria-label={t("games.choNoi.boat", { word: boat.text })}
                disabled={feedback !== null}
                onPointerDown={() => resolve(boat.conceptId)}
                onClick={() => resolve(boat.conceptId)}
                className="absolute left-0 flex touch-manipulation flex-col items-center justify-end will-change-transform"
                style={{
                  width: BOAT_W,
                  height: BOAT_H,
                  // Couloirs dans le bas de la rivière : à portée de pouce.
                  top: `calc(${((boat.lane + 0.5) / laneCount) * 100}% - ${BOAT_H / 2}px)`,
                  transform: `translate3d(${-BOAT_W}px,0,0)`,
                }}
              >
                <span className={`-mb-1 rounded-lg border-2 bg-nuoc px-3 text-muc transition-transform duration-200 ${signClass(state)}`}>
                  <Vi size="2xl">{boat.text}</Vi>
                </span>
                <BoatHull className="w-full" />
              </button>
            );
          })}
        </div>
      )}

      <p className="min-h-7 pt-2 text-center font-semibold" role="status" aria-live="polite">
        {statusText}
      </p>
      <div className="flex items-center justify-between gap-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={replayAudio}
            aria-label={t("games.choNoi.replay")}
            className="grid size-16 place-items-center rounded-full bg-ngoc text-nuoc shadow-[0_5px_0_0_rgb(14_94_85/0.35)] active:translate-y-1 active:shadow-none"
          >
            <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
              <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
            </svg>
          </button>
          {source === "tts" && <span className="text-sm text-phu-sa/80">{t("audio.tts")}</span>}
          {source === "blocked" && <span className="text-sm font-semibold text-ngoc">{t("mobile.audio.tapToListen")}</span>}
        </div>
        {onSkip && (
          <button type="button" onClick={onSkip} className="min-h-11 px-3 text-ngoc underline-offset-4 hover:underline">
            {t("games.skip")}
          </button>
        )}
      </div>
    </div>
  );
}

/** « 0:42 » : temps de jeu restant, arrondi à la seconde supérieure. */
function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type BoatState = "idle" | "right" | "wrongPick" | "reveal";

function boatState(feedback: Feedback | null, isTarget: boolean, id: string): BoatState {
  if (!feedback) return "idle";
  if (isTarget) return feedback.correct ? "right" : "reveal";
  return feedback.chosen === id ? "wrongPick" : "idle";
}

function signClass(state: BoatState): string {
  switch (state) {
    case "right":
      return "scale-110 border-nghe bg-nghe/25";
    case "reveal":
      return "border-nghe";
    case "wrongPick":
      return "border-phu-sa/20 opacity-60";
    case "idle":
      return "border-nghe/60";
  }
}
