import {
  currentXeOmInstruction,
  currentXeOmRoute,
  headingDegrees,
  isXeOmOver,
  moveXeOm,
  startXeOm,
  XE_OM_ACTIONS,
  xeOmHint,
  xeOmResult,
  xeOmShowTranscript,
  xeOmTargets,
  type ContentIndex,
  type GameResult,
  type XeOmAction,
  type XeOmData,
  type XeOmInstruction,
  type XeOmRoute,
  type XeOmState,
} from "@parlo/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playPath, ttsAllowed, type PlaybackSource } from "../audio.ts";
import { Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";
import { GameEmpty, GameIntro, GameResultScreen, ReplayButton, SourceMarker } from "./GameShell.tsx";
import { playChime, preloadMedia, useReducedMotion } from "./platform.ts";
import { Scooter, XeOmMapBase, xeOmPoint, xeOmViewBox } from "./XeOmArt.tsx";

/**
 * Xe ôm — interface. Toute la logique (itinéraire, validation, score) vit dans
 * @parlo/core. Rendu : carte SVG statique + moto sur une couche HTML déplacée
 * en translate3d/rotate avec une transition CSS (compositeur, aucune boucle JS).
 */

const TEST_ID = "xe-om";
const MOVE_MS = 520;
const ARRIVAL_PAUSE_MS = 1400;
const SCOOTER = 44;

interface XeOmProps {
  content: ContentIndex;
  data: XeOmData;
  /** Tire les itinéraires d'une partie (nouvelle graine à chaque essai). */
  pickRoutes: (attempt: number) => XeOmRoute[];
  onSkip?: () => void;
  onStart?: () => void;
  onFinish?: (result: GameResult) => void;
  resultActions: (result: GameResult, replay: () => void) => ReactNode;
  introExtra?: ReactNode;
  resultExtra?: ReactNode;
}

type Phase = { name: "intro" } | { name: "playing" } | { name: "result"; result: GameResult };

export function XeOm({ content, data, pickRoutes, onSkip, onStart, onFinish, resultActions, introExtra, resultExtra }: XeOmProps) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const routes = useMemo(() => pickRoutes(attempt), [pickRoutes, attempt]);

  if (routes.length === 0) return <GameEmpty testId={TEST_ID} message={t("games.xeOm.empty")} onSkip={onSkip} />;

  if (phase.name === "intro") {
    return (
      <GameIntro
        testId={TEST_ID}
        name="Xe ôm"
        tagline={t("games.xeOm.tagline")}
        rules={t("games.xeOm.rules")}
        art={<Scooter className="size-24 rotate-90 self-end" />}
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
    return <GameResultScreen testId={TEST_ID} title={t("games.xeOm.resultTitle")} result={phase.result} actions={resultActions(phase.result, replay)} extra={resultExtra} />;
  }

  return (
    <XeOmPlay
      key={attempt}
      content={content}
      data={data}
      routes={routes}
      onSkip={onSkip}
      onDone={(result) => {
        onFinish?.(result);
        setPhase({ name: "result", result });
      }}
    />
  );
}

// ---------------------------------------------------------------------------

type Status = { kind: "idle" } | { kind: "good" } | { kind: "wrong" } | { kind: "arrived"; place: string };

function XeOmPlay({ content, data, routes, onSkip, onDone }: {
  content: ContentIndex;
  data: XeOmData;
  routes: XeOmRoute[];
  onSkip: (() => void) | undefined;
  onDone: (result: GameResult) => void;
}) {
  const reduced = useReducedMotion();
  const silent = usePrefs((s) => s.silent);
  /** État affiché (retardé pendant la pause d'arrivée). */
  const [game, setGame] = useState<XeOmState>(() => startXeOm(routes));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [moves, setMoves] = useState(0);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [width, setWidth] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const pending = useRef<number | undefined>(undefined);
  const rotation = useRef({ heading: game.pose.heading, deg: headingDegrees(game.pose.heading), route: 0 });

  const route = currentXeOmRoute(game) ?? routes[0]!;
  const instruction = currentXeOmInstruction(game);
  const map = data.maps.find((m) => m.id === route.map) ?? data.maps[0]!;
  const box = xeOmViewBox(map);

  const play = (ins: XeOmInstruction | null) => {
    if (!ins) return;
    void playPath(content, ins.audio, ins.vi, ttsAllowed(false)).then(setSource);
  };

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Nouvelle consigne : on la dit (après le déplacement), on précharge la suivante.
  const stepKey = `${game.routeIndex}:${game.instructionIndex}`;
  useEffect(() => {
    if (isXeOmOver(game)) return;
    setSource(null);
    const next = route.instructions[game.instructionIndex + 1] ?? routes[game.routeIndex + 1]?.instructions[0];
    preloadMedia(content, next?.audio);
    if (silent) return;
    const delay = game.instructionIndex === 0 ? 150 : reduced ? 120 : MOVE_MS;
    const timer = window.setTimeout(() => play(instruction), delay);
    return () => window.clearTimeout(timer);
  }, [stepKey]);

  useEffect(() => {
    for (const r of routes) preloadMedia(content, r.instructions[0]?.audio);
    return () => window.clearTimeout(pending.current);
  }, []);

  const act = (action: XeOmAction) => {
    if (busy || !instruction) return;
    const { state: next, outcome } = moveXeOm(game, action);
    setMoves((m) => m + 1);
    if (outcome.kind === "wrong") {
      setGame(next);
      setStatus({ kind: "wrong" });
      if (!silent) play(instruction);
      return;
    }
    if (outcome.kind === "moved") {
      if (outcome.firstTry) playChime();
      setGame(next);
      setStatus({ kind: "good" });
      return;
    }
    if (outcome.kind === "arrived") {
      if (outcome.firstTry) playChime();
      const landmark = map.landmarks.find((lm) => lm.id === instruction.landmark);
      setStatus({ kind: "arrived", place: landmark?.vi ?? "" });
      // La moto reste au terminus un instant ; le score compte déjà la consigne.
      setGame({ ...game, misses: 0, answers: next.answers });
      setBusy(true);
      pending.current = window.setTimeout(() => {
        setBusy(false);
        setStatus({ kind: "idle" });
        if (isXeOmOver(next)) onDone(xeOmResult(next));
        else setGame(next);
      }, ARRIVAL_PAUSE_MS);
    }
  };

  // Rotation cumulée : jamais de demi-tour visuel de 270°.
  const rot = rotation.current;
  if (rot.route !== game.routeIndex) {
    rotation.current = { heading: game.pose.heading, deg: headingDegrees(game.pose.heading), route: game.routeIndex };
  } else if (rot.heading !== game.pose.heading) {
    const delta = ((headingDegrees(game.pose.heading) - headingDegrees(rot.heading) + 540) % 360) - 180;
    rotation.current = { heading: game.pose.heading, deg: rot.deg + delta, route: rot.route };
  }

  const scale = width > 0 ? width / box.width : 0;
  const at = xeOmPoint(game.pose.at);
  const targets = xeOmTargets(map, game.pose);
  const showTranscript = instruction !== null && xeOmShowTranscript(game, silent);
  const hint = xeOmHint(game);
  const points = xeOmResult(game).points;
  const trail = game.trail.map((c) => xeOmPoint(c)).map((p) => `${p.x},${p.y}`).join(" ");

  const statusText =
    status.kind === "good" ? t("games.xeOm.good")
      : status.kind === "wrong" ? (hint ? t("games.xeOm.hint") : showTranscript ? t("games.xeOm.wrongTranscript") : t("games.xeOm.wrong"))
        : status.kind === "arrived" ? t("games.xeOm.arrived", { place: status.place })
          : "";

  return (
    <div
      className="flex flex-1 flex-col"
      data-testid={TEST_ID}
      data-route={game.routeIndex}
      data-step={game.instructionIndex}
      data-misses={game.misses}
      data-moves={moves}
      data-phase={busy ? "arrived" : "driving"}
    >
      <div className="flex items-baseline justify-between gap-4 pb-2">
        <p className="text-sm text-phu-sa">
          {t("games.xeOm.route", { i: game.routeIndex + 1, n: routes.length })} · {t("games.xeOm.step", { i: game.instructionIndex + 1, n: route.instructions.length })}
        </p>
        <p className="text-sm font-semibold text-ngoc">{t("games.choNoi.score", { n: points })}</p>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div
          ref={stage}
          className="relative w-full"
          style={{ aspectRatio: `${box.width} / ${box.height}`, maxWidth: `calc(50dvh * ${box.width / box.height})` }}
        >
          <svg
            viewBox={`0 0 ${box.width} ${box.height}`}
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={t("games.xeOm.map", { x: game.pose.at[0] + 1, y: game.pose.at[1] + 1 })}
          >
            <XeOmMapBase map={map} />
            {game.trail.length > 1 && (
              <polyline points={trail} fill="none" stroke="var(--color-son-mai)" strokeOpacity="0.8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>

          {/* Toucher la carte : les carrefours voisins (doublon visuel des gros boutons, hors tabulation). */}
          {scale > 0 && !busy && XE_OM_ACTIONS.map((action) => {
            const cell = targets[action];
            if (!cell) return null;
            const p = xeOmPoint(cell);
            const size = 48;
            return (
              <button
                key={`${action}:${cell.join(",")}`}
                type="button"
                tabIndex={-1}
                aria-hidden
                data-map-action={action}
                onClick={() => act(action)}
                className="absolute top-0 left-0 grid touch-manipulation place-items-center rounded-full"
                style={{ width: size, height: size, transform: `translate3d(${p.x * scale - size / 2}px, ${p.y * scale - size / 2}px, 0)` }}
              >
                {action !== "stop" && <span className="size-4 rounded-full border-2 border-son-mai bg-nuoc/90" />}
              </button>
            );
          })}

          {scale > 0 && (
            <div
              key={game.routeIndex}
              className={`pointer-events-none absolute top-0 left-0 will-change-transform ${reduced ? "" : "transition-transform ease-out"}`}
              style={{
                width: SCOOTER,
                height: SCOOTER,
                transitionDuration: reduced ? undefined : `${MOVE_MS}ms`,
                transform: `translate3d(${at.x * scale - SCOOTER / 2}px, ${at.y * scale - SCOOTER / 2}px, 0) rotate(${rotation.current.deg}deg)`,
              }}
            >
              <Scooter className="size-full drop-shadow" />
            </div>
          )}
        </div>
      </div>

      <p className="min-h-7 pt-2 text-center font-semibold" role="status" aria-live="polite">{statusText}</p>

      <div className="flex min-h-16 items-center gap-3 pt-1">
        <ReplayButton label={t("games.xeOm.replay")} onClick={() => play(instruction)} size="md" />
        <div className="flex min-w-0 flex-1 flex-col">
          {showTranscript && instruction && (
            <p data-testid="xe-om-transcript">
              <span className="sr-only">{t("games.xeOm.transcript")} : </span>
              <Vi size="2xl">{instruction.vi}</Vi>
              {game.misses >= 2 && <span className="block text-sm text-phu-sa">{l(instruction.gloss)}</span>}
            </p>
          )}
          <SourceMarker source={source} />
        </div>
        {onSkip && (
          <button type="button" onClick={onSkip} className="min-h-11 shrink-0 px-3 text-ngoc underline-offset-4 hover:underline">
            {t("games.skip")}
          </button>
        )}
      </div>

      <div role="group" aria-label={t("games.xeOm.controls")} className="grid grid-cols-4 gap-2 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {XE_OM_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            disabled={busy}
            onClick={() => act(action)}
            aria-label={t(`games.xeOm.${action}`)}
            className={`flex min-h-18 touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl text-sm font-semibold transition-colors disabled:opacity-50 ${
              action === "stop" ? "bg-son-mai text-nuoc" : "bg-ngoc text-nuoc"
            } ${hint === action ? "ring-4 ring-nghe ring-offset-2 ring-offset-nuoc" : ""}`}
          >
            <DirectionIcon action={action} />
            <span aria-hidden>{t(`games.xeOm.${action}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DirectionIcon({ action }: { action: XeOmAction }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
      {action === "left" && <path {...common} d="M17 20v-7a4 4 0 0 0-4-4H6M10 5L6 9l4 4" />}
      {action === "right" && <path {...common} d="M7 20v-7a4 4 0 0 1 4-4h7M14 5l4 4-4 4" />}
      {action === "straight" && <path {...common} d="M12 20V5M7 10l5-5 5 5" />}
      {action === "stop" && <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />}
    </svg>
  );
}
