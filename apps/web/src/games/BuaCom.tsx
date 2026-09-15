import {
  answerBuaCom,
  buaComResult,
  isBuaComOver,
  startBuaCom,
  type BuaComRound,
  type BuaComVerdict,
  type ContentIndex,
  type GameResult,
} from "@parlo/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playConcept, ttsAllowed, type PlaybackSource } from "../audio.ts";
import { Button, Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { GameEmpty, GameIntro, GameResultScreen, ReplayButton, SourceMarker } from "./GameShell.tsx";
import { playChime, preloadConceptAudio, useReducedMotion } from "./platform.ts";

/**
 * Bữa cơm — interface. Logique (phrases, pièges, jugement, score) dans @parlo/core.
 * Chrono doux sans boucle JS : la vapeur est une couche HTML animée en CSS
 * (transform/opacity) dont l'opacité s'éteint par une seule transition longue.
 * Mouvement réduit : vapeur figée + barre de chaleur mise à jour chaque seconde.
 */

const TEST_ID = "bua-com";
const RIGHT_PAUSE_MS = 900;

interface BuaComProps {
  content: ContentIndex;
  /** Manches d'une partie (nouvelle graine à chaque essai). */
  makeRounds: (attempt: number) => BuaComRound[];
  onSkip?: () => void;
  onStart?: () => void;
  onFinish?: (result: GameResult) => void;
  resultActions: (result: GameResult, replay: () => void) => ReactNode;
  introExtra?: ReactNode;
  resultExtra?: ReactNode;
}

type Phase = { name: "intro" } | { name: "playing" } | { name: "result"; result: GameResult };

export function BuaCom({ content, makeRounds, onSkip, onStart, onFinish, resultActions, introExtra, resultExtra }: BuaComProps) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const rounds = useMemo(() => makeRounds(attempt), [makeRounds, attempt]);

  if (rounds.length === 0) return <GameEmpty testId={TEST_ID} message={t("games.buaCom.notEnough")} onSkip={onSkip} />;

  if (phase.name === "intro") {
    return (
      <GameIntro
        testId={TEST_ID}
        name="Bữa cơm"
        tagline={t("games.buaCom.tagline")}
        rules={t("games.buaCom.rules")}
        art={<Dish className="w-40 self-end" />}
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
    return <GameResultScreen testId={TEST_ID} title={t("games.buaCom.resultTitle")} result={phase.result} actions={resultActions(phase.result, replay)} extra={resultExtra} />;
  }

  return (
    <BuaComPlay
      key={attempt}
      content={content}
      rounds={rounds}
      onSkip={onSkip}
      onDone={(result) => {
        onFinish?.(result);
        setPhase({ name: "result", result });
      }}
    />
  );
}

// ---------------------------------------------------------------------------

function BuaComPlay({ content, rounds, onSkip, onDone }: {
  content: ContentIndex;
  rounds: BuaComRound[];
  onSkip: (() => void) | undefined;
  onDone: (result: GameResult) => void;
}) {
  const reduced = useReducedMotion();
  const [game, setGame] = useState(() => startBuaCom(rounds));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<BuaComVerdict | null>(null);
  const [cold, setCold] = useState(false);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const startedAt = useRef(performance.now());
  const pending = useRef<number | undefined>(undefined);

  const round = rounds[index] ?? rounds[0]!;
  const byId = useMemo(() => new Map(round.tokens.map((tok) => [tok.id, tok])), [round]);
  const audio = round.source.audioConcept ? content.concepts.get(round.source.audioConcept) ?? null : null;

  // Nouvelle manche : plat chaud, chrono remis à zéro ; le froid n'arrive qu'une fois.
  useEffect(() => {
    startedAt.current = performance.now();
    setCold(false);
    setPicked([]);
    setVerdict(null);
    setSource(null);
    const timer = window.setTimeout(() => setCold(true), round.hotMs);
    const nextAudio = rounds[index + 1]?.source.audioConcept;
    const next = nextAudio ? content.concepts.get(nextAudio) : undefined;
    if (next) preloadConceptAudio(content, next);
    return () => window.clearTimeout(timer);
  }, [index]);

  useEffect(() => () => window.clearTimeout(pending.current), []);

  const advance = (state = game) => {
    window.clearTimeout(pending.current);
    if (isBuaComOver(state)) onDone(buaComResult(state));
    else setIndex((i) => i + 1);
  };

  const serve = () => {
    if (verdict !== null || picked.length === 0) return;
    const next = answerBuaCom(game, picked, performance.now() - startedAt.current);
    const v = next.answers.at(-1)?.verdict ?? "wrong";
    setGame(next);
    setVerdict(v);
    if (v === "correct") {
      playChime();
      pending.current = window.setTimeout(() => advance(next), RIGHT_PAUSE_MS);
    }
  };

  const points = buaComResult(game).points;
  const last = index + 1 >= rounds.length;
  const feedback =
    verdict === "correct" ? t("games.buaCom.right")
      : verdict === "near" ? t("games.buaCom.near", { target: round.source.target })
        : verdict === "wrong" ? t("games.buaCom.wrong", { target: round.source.target })
          : "";

  return (
    <div className="flex flex-1 flex-col" data-testid={TEST_ID} data-round={index} data-phase={verdict ? "feedback" : "building"} data-verdict={verdict ?? ""}>
      <div className="flex items-baseline justify-between gap-4 pb-2">
        <p className="text-sm text-phu-sa">{t("games.buaCom.round", { i: index + 1, n: rounds.length })}</p>
        <p className="text-sm font-semibold text-ngoc">{t("games.choNoi.score", { n: points })}</p>
      </div>

      <div className="flex items-end gap-4">
        <SteamingDish key={index} hotMs={round.hotMs} reduced={reduced} frozen={verdict !== null} cold={cold} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 pb-2">
          <p className="text-lg">{l(round.source.translation)}</p>
          {audio && (
            <div className="flex items-center gap-2">
              <ReplayButton
                size="md"
                label={t("games.buaCom.listen")}
                onClick={() => void playConcept(content, audio, { allowTts: ttsAllowed(false) }).then(setSource)}
              />
              <SourceMarker source={source} />
            </div>
          )}
        </div>
      </div>
      <p className="min-h-6 text-sm text-phu-sa" aria-live="polite">{cold && verdict === null ? t("games.buaCom.cold") : ""}</p>

      <div
        role="group"
        aria-label={t("games.buaCom.answer")}
        className={`mt-2 flex min-h-20 flex-wrap content-start gap-2 border-b-2 pb-3 ${
          verdict === "correct" ? "border-nghe" : verdict ? "border-son-mai/50" : "border-phu-sa/20"
        }`}
      >
        {picked.map((id, i) => {
          const text = byId.get(id)?.text ?? "";
          return (
            <button
              key={id}
              type="button"
              disabled={verdict !== null}
              aria-label={t("games.buaCom.remove", { word: text })}
              onClick={() => setPicked(picked.filter((_, k) => k !== i))}
              className="min-h-12 rounded-xl bg-ngoc px-4 py-1 text-nuoc"
            >
              <Vi size="2xl">{text}</Vi>
            </button>
          );
        })}
      </div>

      <p className="min-h-7 pt-2 text-center font-semibold" role="status" aria-live="polite">{feedback}</p>
      {verdict && verdict !== "correct" && round.source.explain && <p className="text-center text-sm text-phu-sa">{l(round.source.explain)}</p>}

      <div className="flex-1" />

      <div role="group" aria-label={t("games.buaCom.tokens")} className="flex flex-wrap justify-center gap-2 pt-3">
        {round.tokens.map((tok) => {
          const used = picked.includes(tok.id);
          return (
            <button
              key={tok.id}
              type="button"
              disabled={used || verdict !== null}
              onClick={() => setPicked([...picked, tok.id])}
              className={`min-h-12 touch-manipulation rounded-xl border-2 px-4 py-1 ${used ? "border-dashed border-phu-sa/20 text-transparent" : "border-nghe/60 bg-white/80"}`}
            >
              <Vi size="2xl">{tok.text}</Vi>
            </button>
          );
        })}
      </div>

      <div className="sticky bottom-0 flex flex-col gap-2 bg-nuoc pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {verdict === null ? (
          <>
            <Button disabled={picked.length === 0} onClick={serve}>{t("games.buaCom.serve")}</Button>
            <div className="flex justify-between">
              <button type="button" disabled={picked.length === 0} onClick={() => setPicked([])} className="min-h-11 px-3 text-ngoc underline-offset-4 hover:underline disabled:text-phu-sa/40">
                {t("games.buaCom.clear")}
              </button>
              {onSkip && (
                <button type="button" onClick={onSkip} className="min-h-11 px-3 text-ngoc underline-offset-4 hover:underline">
                  {t("games.skip")}
                </button>
              )}
            </div>
          </>
        ) : verdict !== "correct" ? (
          <Button onClick={() => advance()}>{last ? t("games.buaCom.finish") : t("games.buaCom.next")}</Button>
        ) : (
          <div className="min-h-14" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STEAM_CSS = `
@keyframes buaSteam {
  0% { transform: translate3d(0, 10px, 0) scaleY(0.9); opacity: 0; }
  30% { opacity: 0.9; }
  100% { transform: translate3d(0, -26px, 0) scaleY(1.15); opacity: 0; }
}`;

/**
 * Chén cơm fumant. La vapeur s'éteint en `hotMs` (une transition d'opacité) ;
 * en mouvement réduit elle est figée et une barre montre la chaleur restante.
 */
function SteamingDish({ hotMs, reduced, frozen, cold }: { hotMs: number; reduced: boolean; frozen: boolean; cold: boolean }) {
  const [lit, setLit] = useState(true);
  const [warmth, setWarmth] = useState(1);
  const layer = useRef<HTMLDivElement>(null);
  const started = useRef(performance.now());

  useEffect(() => {
    started.current = performance.now();
    if (reduced) {
      const id = window.setInterval(() => setWarmth(Math.max(0, 1 - (performance.now() - started.current) / hotMs)), 1000);
      return () => window.clearInterval(id);
    }
    // Deux images : l'opacité de départ est peinte avant de lancer la transition.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setLit(false));
    });
    return () => cancelAnimationFrame(raf);
  }, [hotMs, reduced]);

  // Réponse donnée : la vapeur se fige là où elle en est (pas de saut).
  useEffect(() => {
    const el = layer.current;
    if (!frozen || !el) return;
    const current = getComputedStyle(el).opacity;
    el.style.transition = "none";
    el.style.opacity = current;
  }, [frozen]);

  const ratio = reduced ? warmth : cold ? 0 : 1;
  return (
    <div className="relative w-32 shrink-0" aria-label={t(cold ? "games.buaCom.cold" : "games.buaCom.hot")} role="img">
      <style>{STEAM_CSS}</style>
      <div
        ref={layer}
        className="absolute inset-x-0 top-0 flex h-14 justify-center gap-3"
        style={reduced ? { opacity: 0.25 + 0.75 * warmth } : { opacity: lit ? 1 : 0.06, transition: `opacity ${hotMs}ms linear` }}
        aria-hidden
      >
        {[0, 1, 2].map((i) => (
          <svg
            key={i}
            viewBox="0 0 12 40"
            className="h-12 w-3 will-change-transform"
            style={reduced ? undefined : { animation: `buaSteam 2.6s ease-in-out ${i * 0.7}s infinite` }}
          >
            <path d="M6 38c-4-6 4-10 0-17s4-11 0-19" fill="none" stroke="var(--color-phu-sa)" strokeOpacity="0.45" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        ))}
      </div>
      <Dish className="mt-12 w-full" />
      {reduced && (
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-phu-sa/10" title={t("games.buaCom.warmth")} aria-hidden>
          <div className="h-full origin-left bg-nghe" style={{ transform: `scaleX(${ratio})` }} />
        </div>
      )}
    </div>
  );
}

/** Chén cơm laqué : bol sơn mài, liseré curcuma, riz, baguettes. */
export function Dish({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 70" className={className} aria-hidden>
      <path d="M20 22 Q60 6 100 22 Z" fill="#fbfbf6" />
      <circle cx="44" cy="17" r="2" fill="#e9e7dc" />
      <circle cx="62" cy="13" r="2" fill="#e9e7dc" />
      <circle cx="78" cy="17" r="2" fill="#e9e7dc" />
      <path d="M12 22h96q-4 32-48 34Q16 54 12 22z" fill="var(--color-son-mai)" />
      <path d="M16 30q44 8 88 0" fill="none" stroke="var(--color-nghe)" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 56h28l-3 8H49z" fill="var(--color-son-mai)" />
      <path d="M82 4L116 28M88 2l30 22" stroke="var(--color-phu-sa)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
