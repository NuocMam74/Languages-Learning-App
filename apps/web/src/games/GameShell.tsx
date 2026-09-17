import type { GameResult } from "@parlo/core";
import type { MouseEventHandler, ReactNode } from "react";
import { Link } from "react-router";
import type { PlaybackSource } from "../audio.ts";
import { Button, Vi } from "../components/ui.tsx";
import { Card, CountUp, EmptyState, Icon, ProgressRing, Skeleton } from "../design/index.ts";
import { t } from "../i18n/index.ts";

/**
 * Coquille commune des mini-jeux Xe ôm, Bữa cơm et Nhớ mặt : mise en page (action en
 * bas, à portée de pouce), écran d'intro, écran de résultat, bouton réécouter.
 * Les libellés « Jouer », « Continuer sans jouer », « Continuer » sont ceux de
 * Chợ nổi : les parcours e2e s'y fient.
 *
 * Tout ce qui *entoure* la partie vient du système de design (contrat phase8 §1) — carte,
 * anneau, comptage, état vide. L'aire de jeu elle-même reste intacte : ses dessins sont faits
 * à la main et rien n'y est animé pendant une manche.
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
      {action && <div className="sticky bottom-0 border-t border-line bg-nuoc pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{action}</div>}
    </div>
  );
}

/**
 * Retour commun aux écrans de jeu (jeux, Đối đáp, karaoké) : même place, même geste partout.
 * Le libellé reste visible — sur ces écrans, c'est aussi « annuler », pas seulement « revenir ».
 */
export function GameBack({ to, label, onClick }: { to: string; label: string; onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="-ml-2 flex min-h-11 items-center gap-1 self-start rounded-full pr-3 pl-2 font-medium text-ngoc transition-[background-color,transform] hover:bg-ngoc/10 motion-safe:active:scale-[.98]"
    >
      <Icon name="chevronLeft" size={20} />
      {label}
    </Link>
  );
}

/** Attente d'une lecture (IndexedDB, itinéraires) : un squelette, jamais un écran vide (contrat §1). */
export function GameLoading() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4" role="status" aria-label={t("games.loading")}>
      <Skeleton className="h-11 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-40 w-full" rounded="card" />
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
        {/* Seul moment animé de l'écran : l'affiche du jeu se pose, les règles restent immobiles. */}
        <Card tone="feature" className="flex flex-col gap-3 motion-safe:parlo-enter">
          <Vi size="vi-xl" className="text-ngoc">{name}</Vi>
          <p className="text-lg">{tagline}</p>
          {art}
        </Card>
        <p className="text-phu-sa">{rules}</p>
        {extra}
      </div>
    </GameLayout>
  );
}

/**
 * Bilan d'une partie : l'anneau porte le résultat (il se remplit une fois), le score monte, et
 * tout tient sur une seule surface posée — c'est le moment qu'on a envie de revoir.
 */
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
        {/* Un seul moment fort ici : l'anneau se remplit et le score monte. La carte, elle, ne bouge pas. */}
        <Card tone="raised" className="flex flex-col gap-3 text-center">
          <h2 className="font-serif text-2xl">{title}</h2>
          {result.total > 0 && (
            <div className="self-center">
              <ProgressRing value={result.correct} max={result.total} size={128} label={t("games.result", { correct: result.correct, total: result.total })}>
                <span className="font-serif text-2xl text-ngoc">
                  <CountUp to={result.correct} />
                </span>
              </ProgressRing>
            </div>
          )}
          <p className="text-lg font-semibold text-ngoc">{t("games.result", { correct: result.correct, total: result.total })}</p>
          <p className="text-phu-sa">{t("games.points", { n: result.points })}</p>
          {extra}
        </Card>
      </div>
    </GameLayout>
  );
}

export function GameEmpty({ testId, message, onSkip }: { testId: string; message: string; onSkip: (() => void) | undefined }) {
  return (
    <GameLayout testId={testId} action={onSkip && <Button onClick={onSkip}>{t("games.continue")}</Button>}>
      {/* Colonne (et non grille centrée) : le texte garde toute la largeur et se replie au lieu de déborder. */}
      <div className="flex flex-1 flex-col justify-center">
        <EmptyState art="market" title={message} />
      </div>
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
      <Icon name="sound" size={size === "lg" ? 28 : 24} />
    </button>
  );
}

/** Marqueur discret de synthèse vocale / audio manquant (spec §7.4). */
export function SourceMarker({ source }: { source: PlaybackSource | null }) {
  if (source === "tts") return <span className="text-sm text-phu-sa/80">{t("audio.tts")}</span>;
  if (source === "missing") return <span className="text-sm text-son-mai">{t("audio.missing")}</span>;
  if (source === "blocked") return <span className="text-sm font-semibold text-ngoc">{t("mobile.audio.tapToListen")}</span>;
  return null;
}
