import type { GameResult } from "@parlo/core";
import type { ReactNode } from "react";
import type { PlaybackSource } from "../audio.ts";
import { Button, Vi } from "../components/ui.tsx";
import { t } from "../i18n/index.ts";

/**
 * Coquille commune des mini-jeux Xe ôm et Bữa cơm : mise en page (action en
 * bas, à portée de pouce), écran d'intro, écran de résultat, bouton réécouter.
 * Les libellés « Jouer », « Continuer sans jouer », « Continuer » sont ceux de
 * Chợ nổi : les parcours e2e s'y fient.
 */

export function GameLayout({ testId, children, action, attrs }: {
  testId: string;
  children: ReactNode;
  action?: ReactNode;
  attrs?: Record<`data-${string}`, string | number>;
}) {
  return (
    <div className="flex flex-1 flex-col" data-testid={testId} {...attrs}>
      <div className="flex flex-1 flex-col">{children}</div>
      {action && <div className="sticky bottom-0 bg-nuoc pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{action}</div>}
    </div>
  );
}

export function GameIntro({ testId, name, tagline, rules, art, onPlay, onSkip, extra }: {
  testId: string;
  name: string;
  tagline: string;
  rules: string;
  art: ReactNode;
  onPlay: () => void;
  onSkip: (() => void) | undefined;
  extra?: ReactNode;
}) {
  return (
    <GameLayout
      testId={testId}
      action={
        <div className="flex flex-col gap-2">
          <Button onClick={onPlay}>{t("games.play")}</Button>
          {onSkip && <Button variant="quiet" onClick={onSkip}>{t("games.skipIntro")}</Button>}
        </div>
      }
    >
      <div className="flex flex-1 flex-col justify-center gap-5">
        <Vi size="vi-xl" className="text-ngoc">{name}</Vi>
        <p className="text-lg">{tagline}</p>
        <p className="text-phu-sa">{rules}</p>
        {art}
        {extra}
      </div>
    </GameLayout>
  );
}

export function GameResultScreen({ testId, title, result, actions, extra }: {
  testId: string;
  title: string;
  result: GameResult;
  actions: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <GameLayout testId={testId} action={<div className="flex flex-col gap-2">{actions}</div>}>
      <div className="flex flex-1 flex-col justify-center gap-4" role="status">
        <h2 className="font-serif text-2xl">{title}</h2>
        <p className="text-vi-xl font-semibold text-ngoc motion-safe:animate-[rise_600ms_ease-out]">
          {t("games.result", { correct: result.correct, total: result.total })}
        </p>
        <p className="text-lg text-phu-sa">{t("games.points", { n: result.points })}</p>
        {extra}
      </div>
    </GameLayout>
  );
}

export function GameEmpty({ testId, message, onSkip }: { testId: string; message: string; onSkip: (() => void) | undefined }) {
  return (
    <GameLayout testId={testId} action={onSkip && <Button onClick={onSkip}>{t("games.continue")}</Button>}>
      <p className="grid flex-1 place-items-center text-center text-lg text-phu-sa">{message}</p>
    </GameLayout>
  );
}

export function ReplayButton({ label, onClick, size = "lg" }: { label: string; onClick: () => void; size?: "lg" | "md" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`grid shrink-0 place-items-center rounded-full bg-ngoc text-nuoc shadow-[0_5px_0_0_rgb(14_94_85/0.35)] active:translate-y-1 active:shadow-none ${size === "lg" ? "size-16" : "size-12"}`}
    >
      <svg viewBox="0 0 24 24" className={size === "lg" ? "size-7" : "size-6"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
        <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
      </svg>
    </button>
  );
}

/** Marqueur discret de synthèse vocale / audio manquant (spec §7.4). */
export function SourceMarker({ source }: { source: PlaybackSource | null }) {
  if (source === "tts") return <span className="text-sm text-phu-sa/70">{t("audio.tts")}</span>;
  if (source === "missing") return <span className="text-sm text-son-mai">{t("audio.missing")}</span>;
  return null;
}
