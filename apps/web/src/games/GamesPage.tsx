import {
  BUA_COM_DEFAULTS,
  betterGameBest,
  buaComSources,
  generateBuaComRounds,
  pickXeOmRoutes,
  type BuaComSource,
  type Concept,
  type ContentIndex,
  type GameBest,
  type GameId,
  type GameResult,
} from "@parlo/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { getKv, setKv } from "../db.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { completedLessons, recordGamePlayed } from "../learner.ts";
import { BoatHull } from "./Boat.tsx";
import { BuaCom, Dish } from "./BuaCom.tsx";
import { ChoNoi } from "./ChoNoi.tsx";
import { CardsArt, NhoMat, nhoMatStandalonePool } from "./NhoMat.tsx";
import { useXeOmData } from "./xe-om-data.ts";
import { XeOm } from "./XeOm.tsx";
import { Scooter } from "./XeOmArt.tsx";
import { karaokeCandidates } from "../karaoke/KaraokePage.tsx";
import { useTutorStatus } from "../tutor/status.ts";

/** Onglet « Jeux » (spec §5.6) : chaque mini-jeu jouable seul, avec son record. */

/** Les 4 jeux du MVP, dans l'ordre de la spec. */
const MVP_GAMES: GameId[] = ["cho_noi", "karaoke_tonal", "xe_om", "bua_com", "nho_mat"];

/** Jeux jouables sur /jeux/:game : accroche et illustration de la carte. Les autres s'affichent « bientôt ». */
const PLAYABLE: Partial<Record<GameId, { tagline: MessageKey; art: () => ReactNode }>> = {
  cho_noi: { tagline: "games.choNoi.tagline", art: () => <BoatHull className="w-24 shrink-0" /> },
  xe_om: { tagline: "games.xeOm.tagline", art: () => <Scooter className="size-20 shrink-0 rotate-90" /> },
  bua_com: { tagline: "games.buaCom.tagline", art: () => <Dish className="w-24 shrink-0" /> },
  nho_mat: { tagline: "nhoMat.tagline", art: () => <CardsArt className="w-24 shrink-0" /> },
};

export const bestKey = (game: GameId) => `games.${game}.best`;

export function GamesPage({ content }: { content: ContentIndex }) {
  const [bests, setBests] = useState<Partial<Record<GameId, GameBest | null>> | undefined>(undefined);
  const tutorAvailable = useTutorStatus((s) => s.available);
  // Karaoké tonal : entrée masquée tant qu'aucune courbe de référence n'est présente (contrat phase5 §1).
  const karaoke = useMemo(() => karaokeCandidates(content, new Set()).all.length > 0, [content]);
  useEffect(() => {
    const ids = MVP_GAMES.filter((id) => PLAYABLE[id]);
    void Promise.all(ids.map((id) => getKv<GameBest | null>(bestKey(id), null))).then((values) =>
      setBests(Object.fromEntries(ids.map((id, i) => [id, values[i] ?? null]))),
    );
  }, []);

  return (
    <Screen top={<BackLink to="/" label={t("games.home")} />}>
      <h1 className="font-serif text-2xl">{t("games.title")}</h1>
      <p className="pb-6 text-phu-sa">{t("games.intro")}</p>
      <ul className="flex flex-col">
        {MVP_GAMES.map((id) => {
          const name = t(`game.${id}` as MessageKey);
          // Karaoké tonal : page propre (apps/web/src/karaoke), route /jeux/karaoke_tonal.
          if (id === "karaoke_tonal") {
            if (!karaoke) return null;
            return (
              <li key={id} className="pb-4">
                <Link to="/jeux/karaoke_tonal" className="flex flex-col gap-1 rounded-2xl border-2 border-ngoc px-5 py-5 text-muc">
                  <Vi size="vi">{name}</Vi>
                  <span className="text-sm text-phu-sa">{t("karaoke.game.tagline")}</span>
                </Link>
              </li>
            );
          }
          const entry = PLAYABLE[id];
          if (!entry) {
            return (
              <li key={id} className="flex items-baseline justify-between border-t border-phu-sa/10 py-4 text-phu-sa/60">
                <Vi size="2xl">{name}</Vi>
                <span className="text-sm">{t("games.soon")}</span>
              </li>
            );
          }
          const best = bests?.[id];
          return (
            <li key={id} className="pb-4">
              <Link to={`/jeux/${id}`} className="flex items-center gap-4 rounded-2xl bg-ngoc px-5 py-5 text-nuoc" data-game={id}>
                <span className="flex flex-1 flex-col gap-1">
                  <Vi size="vi">{name}</Vi>
                  <span className="text-sm text-nuoc/85">{t(entry.tagline)}</span>
                  <span className="text-sm font-semibold text-nghe">
                    {bests === undefined ? "" : best ? t("games.best", { points: best.points, correct: best.correct, total: best.total }) : t("games.noBest")}
                  </span>
                </span>
                {entry.art()}
              </Link>
            </li>
          );
        })}
        {/* Phase 3 : Đối đáp, conversation chronométrée avec Cô Mai (page propre, compte et réseau requis). */}
        {tutorAvailable === false ? (
          <li className="flex items-baseline justify-between border-t border-phu-sa/10 py-4 text-phu-sa/60" data-game="doi_dap">
            <Vi size="2xl">{t("game.doi_dap")}</Vi>
            <span className="text-sm">{t("journey.games.soon")}</span>
          </li>
        ) : (
          <li className="pb-4">
            <Link to="/jeux/doi_dap" className="flex flex-col gap-1 rounded-2xl border-2 border-ngoc/25 px-5 py-5 text-muc" data-game="doi_dap">
              <Vi size="vi">{t("game.doi_dap")}</Vi>
              <span className="text-sm text-phu-sa">{t("tutor.doiDap.tagline")}</span>
            </Link>
          </li>
        )}
      </ul>
    </Screen>
  );
}

export function GamePlayPage({ content }: { content: ContentIndex }) {
  const { game = "" } = useParams();
  const navigate = useNavigate();
  const [completed, setCompleted] = useState<Set<string> | null>(null);
  const [best, setBest] = useState<GameBest | null>(null);
  const [newBest, setNewBest] = useState(false);
  const seed = useMemo(() => String(Date.now()), []);
  const startedAt = useRef(Date.now());
  const id = game as GameId;
  const playable = PLAYABLE[id] !== undefined;

  useEffect(() => {
    if (!playable) return;
    void Promise.all([completedLessons(), getKv<GameBest | null>(bestKey(id), null)]).then(([done, stored]) => {
      setBest(stored);
      setCompleted(done);
    });
  }, [content, id, playable]);

  if (!playable) return <Navigate to="/jeux" replace />;
  if (!completed) return <Screen><p className="my-auto text-center text-phu-sa">{t("games.loading")}</p></Screen>;

  const onStart = () => {
    startedAt.current = Date.now();
    setNewBest(false);
  };
  const onFinish = (result: GameResult) => {
    void recordGamePlayed(id, result, Date.now() - startedAt.current).catch(() => undefined);
    const next = betterGameBest(best, result);
    const improved = next !== best;
    setNewBest(improved);
    if (improved) {
      setBest(next);
      void setKv(bestKey(id), next);
    }
  };
  const common: StandaloneProps = {
    content,
    seed,
    onStart,
    onFinish,
    bestLine: best && <> · {t("games.best", { points: best.points, correct: best.correct, total: best.total })}</>,
    resultExtra: newBest ? <p className="font-semibold text-nghe">{t("games.newBest")}</p> : null,
    resultActions: (_: GameResult, replay: () => void) => (
      <>
        <Button onClick={replay}>{t("games.replay")}</Button>
        <Button variant="quiet" onClick={() => navigate("/jeux")}>{t("games.back")}</Button>
      </>
    ),
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]">
      <BackLink to="/jeux" label={t("games.back")} />
      <main className="flex flex-1 flex-col pt-2">
        {id === "cho_noi" && <ChoNoiStandalone {...common} completed={completed} />}
        {id === "xe_om" && <XeOmStandalone {...common} />}
        {id === "bua_com" && <BuaComStandalone {...common} completed={completed} />}
        {id === "nho_mat" && <NhoMatStandalone {...common} completed={completed} />}
      </main>
    </div>
  );
}

interface StandaloneProps {
  content: ContentIndex;
  seed: string;
  bestLine: ReactNode;
  onStart: () => void;
  onFinish: (result: GameResult) => void;
  resultExtra: ReactNode;
  resultActions: (result: GameResult, replay: () => void) => ReactNode;
}

function ChoNoiStandalone({ completed, bestLine, ...props }: StandaloneProps & { completed: ReadonlySet<string> }) {
  const pool = useMemo(() => gamePool(props.content, completed), [props.content, completed]);
  return (
    <ChoNoi
      {...props}
      concepts={pool.concepts}
      introExtra={<p className="text-sm text-phu-sa">{pool.fromCompleted ? t("games.choNoi.pool") : t("games.choNoi.poolFirst")}{bestLine}</p>}
    />
  );
}

function XeOmStandalone({ bestLine, seed, ...props }: StandaloneProps) {
  const data = useXeOmData(props.content);
  const pickRoutes = useCallback((attempt: number) => (data ? pickXeOmRoutes(data, `${seed}:${attempt}`) : []), [data, seed]);
  if (data === undefined) return <p className="my-auto text-center text-phu-sa">{t("games.loading")}</p>;
  if (data === null) return <p className="my-auto text-center text-phu-sa">{t("games.xeOm.empty")}</p>;
  return <XeOm {...props} data={data} pickRoutes={pickRoutes} introExtra={bestLine ? <p className="text-sm text-phu-sa">{bestLine}</p> : null} />;
}

function BuaComStandalone({ completed, bestLine, seed, ...props }: StandaloneProps & { completed: ReadonlySet<string> }) {
  const pool = useMemo(() => buaComStandaloneSources(props.content, completed), [props.content, completed]);
  const makeRounds = useCallback((attempt: number) => generateBuaComRounds(pool.sources, `${seed}:${attempt}`), [pool, seed]);
  return (
    <BuaCom
      {...props}
      makeRounds={makeRounds}
      introExtra={<p className="text-sm text-phu-sa">{pool.fromCompleted ? t("games.pool.completed") : t("games.pool.first")}{bestLine}</p>}
    />
  );
}

function NhoMatStandalone({ completed, bestLine, ...props }: StandaloneProps & { completed: ReadonlySet<string> }) {
  const pool = useMemo(() => nhoMatStandalonePool(props.content, completed), [props.content, completed]);
  return (
    <NhoMat
      {...props}
      concepts={pool.concepts}
      introExtra={<p className="text-sm text-phu-sa">{pool.fromCompleted ? t("nhoMat.pool.completed") : t("nhoMat.pool.first")}{bestLine}</p>}
    />
  );
}

/** Concepts des leçons terminées (ordre du parcours), sinon ceux de la première leçon. */
export function gamePool(content: ContentIndex, completed: ReadonlySet<string>): { concepts: Concept[]; fromCompleted: boolean } {
  const lessonIds = availableLessons(content);
  const done = lessonIds.filter((id) => completed.has(id));
  const fromCompleted = done.length > 0;
  return { concepts: conceptsOf(content, fromCompleted ? done : lessonIds.slice(0, 1)), fromCompleted };
}

/**
 * Phrases de Bữa cơm hors séance : celles des leçons terminées ; sans leçon
 * terminée (ou sans phrase), celles des premières leçons du parcours, juste
 * assez pour une partie complète.
 */
export function buaComStandaloneSources(content: ContentIndex, completed: ReadonlySet<string>): { sources: BuaComSource[]; fromCompleted: boolean } {
  const lessonIds = availableLessons(content);
  const done = lessonIds.filter((id) => completed.has(id));
  const fromDone = done.length > 0 ? buaComSources(content, conceptsOf(content, done).map((c) => c.id)) : [];
  if (fromDone.length > 0) return { sources: fromDone, fromCompleted: true };
  let sources: BuaComSource[] = [];
  for (let n = 1; n <= lessonIds.length && sources.length < BUA_COM_DEFAULTS.rounds; n++) {
    sources = buaComSources(content, conceptsOf(content, lessonIds.slice(0, n)).map((c) => c.id));
  }
  return { sources, fromCompleted: false };
}

function availableLessons(content: ContentIndex): string[] {
  return content.curriculum.units.flatMap((u) => (u.status === "available" ? u.lessons : []));
}

function conceptsOf(content: ContentIndex, lessonIds: readonly string[]): Concept[] {
  const seen = new Set<string>();
  return lessonIds.flatMap((id) => content.lessons.get(id)?.concepts ?? []).flatMap((id): Concept[] => {
    const c = content.concepts.get(id);
    if (!c || seen.has(id)) return [];
    seen.add(id);
    return [c];
  });
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="-ml-2 flex min-h-11 items-center gap-1 self-start px-2 text-ngoc">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label}
    </Link>
  );
}
