import {
  DOI_DAP_DEFAULTS,
  doiDapResult,
  estimateDoiDapFluency,
  turnTimer,
  type ContentIndex,
  type DoiDapTurn,
  type GameResult,
} from "@parlo/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api.ts";
import { Button, Vi } from "../components/ui.tsx";
import { getLocale, t } from "../i18n/index.ts";
import { useTutorAccess } from "../tutor/access.ts";
import { useCompactViewport, visibleHeight } from "../use-viewport.ts";
import { Composer, GateActions, MessageList, TutorGate } from "../tutor/ChatView.tsx";
import { endConversation, startConversation, type ConversationStart } from "../tutor/client.ts";
import { contentGlossary } from "../tutor/glossary.ts";
import { glossesFrom, messagesFromStart, useConversation } from "../tutor/use-conversation.ts";
import { GameLayout } from "./GameShell.tsx";

/**
 * Đối đáp (la répartie, spec §5.6.5) : 6 tours de conversation chronométrée
 * avec Cô Mai (mode `doi_dap`), 20 s par réponse, score de fluidité renvoyé par
 * `end`. En ligne et avec un compte uniquement ; sinon « Continuer sans jouer ».
 */

export interface DoiDapProps {
  content: ContentIndex;
  topicLessonId?: string | undefined;
  /** Séance : « Continuer sans jouer ». Absent sur /jeux. */
  onSkip?: (() => void) | undefined;
  onStart?: () => void;
  onFinish?: (result: GameResult) => void;
  introExtra?: ReactNode;
  resultActions: (result: GameResult, replay: () => void) => ReactNode;
}

type Phase =
  | { kind: "intro" }
  | { kind: "starting" }
  | { kind: "playing"; start: ConversationStart }
  | { kind: "result"; result: GameResult; estimated: boolean; summary: string | null };

export function DoiDap(props: DoiDapProps) {
  const access = useTutorAccess();
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [error, setError] = useState<"resting" | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);

  const play = async () => {
    setError(null);
    setPhase({ kind: "starting" });
    try {
      const start = await startConversation({ locale: getLocale(), mode: "doi_dap", ...(props.topicLessonId ? { topicLessonId: props.topicLessonId } : {}) });
      props.onStart?.();
      setAttempt((n) => n + 1);
      setPhase({ kind: "playing", start });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? "resting" : "error");
      setPhase({ kind: "intro" });
    }
  };

  if (phase.kind === "playing") {
    return (
      <DoiDapRound
        key={attempt}
        content={props.content}
        start={phase.start}
        onDone={(result, estimated, summary) => {
          props.onFinish?.(result);
          setPhase({ kind: "result", result, estimated, summary });
        }}
      />
    );
  }

  if (phase.kind === "result") {
    const { result, estimated, summary } = phase;
    return (
      <GameLayout testId="doi-dap" attrs={{ "data-phase": "result" }} action={<div className="flex flex-col gap-2">{props.resultActions(result, () => void play())}</div>}>
        <div className="flex flex-1 flex-col justify-center gap-4" role="status">
          <h2 className="font-serif text-2xl">{t("tutor.doiDap.result.title")}</h2>
          <p className="text-vi-xl font-semibold text-ngoc motion-safe:animate-[rise_600ms_ease-out]" data-testid="doi-dap-fluency">
            {t("tutor.doiDap.result.fluency", { n: result.points })}
          </p>
          <p className="text-lg text-phu-sa">{t(estimated ? "tutor.doiDap.result.estimated" : "tutor.doiDap.result.label")}</p>
          {summary && <p className="border-l-4 border-nghe pl-3 text-lg">{summary}</p>}
        </div>
      </GameLayout>
    );
  }

  const blocked = access !== "ok" && access !== "loading" ? access : null;
  return (
    <GameLayout
      testId="doi-dap"
      attrs={{ "data-phase": blocked ? "unavailable" : "intro" }}
      action={
        <div className="flex flex-col gap-2">
          {blocked ? (
            props.onSkip ? <Button onClick={props.onSkip}>{t("games.skipIntro")}</Button> : <GateActions reason={blocked} />
          ) : (
            <>
              <Button onClick={() => void play()} disabled={phase.kind === "starting" || access === "loading" || error === "resting"}>
                {phase.kind === "starting" ? t("tutor.thinking") : t("games.play")}
              </Button>
              {props.onSkip && <Button variant="quiet" onClick={props.onSkip}>{t("games.skipIntro")}</Button>}
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-1 flex-col justify-center gap-5">
        <Vi size="vi-xl" className="text-ngoc">{t("game.doi_dap")}</Vi>
        <p className="text-lg">{t("tutor.doiDap.tagline")}</p>
        <p className="text-phu-sa">{t("tutor.doiDap.rules", { turns: DOI_DAP_DEFAULTS.turns, seconds: DOI_DAP_DEFAULTS.answerMs / 1000 })}</p>
        {blocked && <TutorGate reason={blocked} />}
        {error === "resting" && <p className="border-l-4 border-nghe pl-3" role="status">{t("tutor.chat.resting")}</p>}
        {error === "error" && <p className="text-son-mai" role="alert">{t("tutor.start.error")}</p>}
        {!blocked && props.introExtra}
      </div>
    </GameLayout>
  );
}

/**
 * Clavier ouvert : ramène la dernière réplique de Cô Mai au-dessus de la barre de saisie
 * (la question reste lisible pendant que le chrono tourne).
 */
function revealLastQuestion(root: HTMLElement | null) {
  const messages = root?.querySelectorAll<HTMLElement>('[data-testid="tutor-message"]');
  const last = messages?.[messages.length - 1];
  const composer = root?.querySelector<HTMLElement>('[data-testid="composer"]');
  if (!last) return;
  const viewport = window.visualViewport;
  const top = (viewport?.offsetTop ?? 0) + 8;
  const bottom = Math.min((viewport?.offsetTop ?? 0) + visibleHeight(), composer?.getBoundingClientRect().top ?? Infinity) - 8;
  const rect = last.getBoundingClientRect();
  if (rect.top >= top && rect.bottom <= bottom) return;
  // Trop haute pour tenir : on montre son début.
  const delta = rect.height > bottom - top ? rect.top - top : rect.bottom - bottom;
  window.scrollBy({ top: delta, behavior: "auto" });
}

function DoiDapRound({ content, start, onDone }: {
  content: ContentIndex;
  start: ConversationStart;
  onDone: (result: GameResult, estimated: boolean, summary: string | null) => void;
}) {
  const local = useMemo(() => contentGlossary(content), [content]);
  const initial = useMemo(() => messagesFromStart(start), [start]);
  const chat = useConversation({ conversationId: start.conversationId, mode: "doi_dap", initial, initialGlosses: glossesFrom(start.opening.glosses) });
  const [turns, setTurns] = useState<DoiDapTurn[]>([]);
  const [stopped, setStopped] = useState(false);
  const [ending, setEnding] = useState(false);
  const turnStart = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const total = DOI_DAP_DEFAULTS.turns;
  const over = turns.length >= total || stopped;
  const answering = !chat.streaming && !over;

  // Le chrono démarre quand la réplique de Cô Mai est entièrement arrivée.
  useEffect(() => {
    if (!answering) return;
    turnStart.current = Date.now();
    setNow(turnStart.current);
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [answering, turns.length]);

  const timer = turnTimer(turnStart.current, now);

  const send = async (text: string, inputMode: "text" | "voice") => {
    const responseMs = Date.now() - turnStart.current;
    const outcome = await chat.send(text, inputMode, responseMs);
    if (outcome.kind === "done") setTurns((list) => [...list, { responseMs, corrected: outcome.corrected }]);
    else if (outcome.kind === "fallback") {
      if (outcome.reason === "quota") setStopped(true);
      else setTurns((list) => [...list, { responseMs, corrected: false }]);
    }
  };

  const finish = async () => {
    setEnding(true);
    let fluency: number | null = null;
    let summary: string | null = null;
    try {
      const end = await endConversation(start.conversationId);
      fluency = typeof end.fluency === "number" ? end.fluency : null;
      summary = end.summary?.[getLocale()] || end.summary?.fr || null;
    } catch {
      fluency = null;
    }
    const estimated = fluency === null;
    onDone(doiDapResult(fluency ?? estimateDoiDapFluency(turns, { totalTurns: total })), estimated, summary);
  };

  const turnNumber = Math.min(turns.length + 1, total);
  const compact = useCompactViewport();
  const root = useRef<HTMLDivElement>(null);
  const onComposerFocus = () => {
    // Après l'animation du clavier (visualViewport redimensionné).
    window.setTimeout(() => revealLastQuestion(root.current), 350);
  };
  return (
    <div ref={root} className="flex flex-1 flex-col">
    <GameLayout
      testId="doi-dap"
      attrs={{ "data-phase": "playing", "data-turn": turns.length }}
      action={
        over && !chat.streaming ? (
          <Button onClick={() => void finish()} disabled={ending}>{ending ? t("tutor.thinking") : t("tutor.doiDap.finish")}</Button>
        ) : undefined
      }
    >
      {/* Hauteur visible réduite (paysage, clavier) : l'en-tête ne colle plus en haut, la question garde la place. */}
      <div className={`z-10 flex flex-col gap-1.5 bg-nuoc ${compact ? "pb-1.5" : "sticky top-0 pb-3"}`} data-compact={compact || undefined}>
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">{over ? t("tutor.doiDap.over") : t("tutor.doiDap.turn", { n: turnNumber, total })}</span>
          {answering && (
            <span role="timer" aria-live="off" className={`text-sm tabular-nums ${timer.expired ? "text-phu-sa" : "text-ngoc"}`} data-testid="doi-dap-timer">
              {timer.expired ? t("tutor.doiDap.timeUp") : t("tutor.doiDap.seconds", { n: timer.seconds })}
            </span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-phu-sa/10" aria-hidden>
          <div
            className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-linear ${timer.ratio > 0.25 ? "bg-ngoc" : "bg-nghe"}`}
            style={{ width: `${answering ? timer.ratio * 100 : over ? 0 : 100}%` }}
          />
        </div>
      </div>
      <div className="flex flex-1 flex-col pb-4">
        <MessageList
          messages={chat.messages}
          glossaries={[chat.glosses, local]}
          streaming={chat.streaming}
          onRetry={(m) => {
            chat.dismiss(m.id);
            void send(m.sentences[0] ?? "", "text");
          }}
        />
        {timer.expired && answering && <p className="mt-3 text-sm text-phu-sa">{t("tutor.doiDap.timeUpHint")}</p>}
      </div>
      {!over && <Composer disabled={chat.streaming} onSend={send} placeholder={t("tutor.doiDap.placeholder")} onFocus={onComposerFocus} />}
    </GameLayout>
    </div>
  );
}
