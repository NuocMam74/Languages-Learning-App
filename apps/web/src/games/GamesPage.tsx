import {
  BUA_COM_DEFAULTS,
  betterGameBest,
  GAME_PASS_RATIO,
  buaComSources,
  generateBuaComRounds,
  isGamePlayable,
  packHasNativeAudio,
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
import { Card, Chip, EmptyState, FloatingMarket, Icon, Illustration, PageHeader, Skeleton, type IconName } from "../design/index.ts";
import { getKv, setKv } from "../db.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { completedLessons, recordGamePlayed } from "../learner.ts";
import { celebrate } from "../rewards/celebrate.ts";
import { awardGame } from "../rewards/store.ts";
import { BuaCom } from "./BuaCom.tsx";
import { CaPhe } from "./CaPhe.tsx";
import { ChoNoi } from "./ChoNoi.tsx";
import { LoTo } from "./LoTo.tsx";
import { GameBack, GameLoading } from "./GameShell.tsx";
import { NhoMat, nhoMatStandalonePool } from "./NhoMat.tsx";
import { useXeOmData } from "./xe-om-data.ts";
import { XeOm } from "./XeOm.tsx";
import { karaokeCandidates } from "../karaoke/KaraokePage.tsx";
import { useTutorStatus } from "../tutor/status.ts";

/** Onglet « Jeux » (spec §5.6) : chaque mini-jeu jouable seul, avec son record. */

/** Les jeux jouables seuls, dans l'ordre de la spec puis du contrat phase9 §7. */
const MVP_GAMES: GameId[] = ["cho_noi", "karaoke_tonal", "xe_om", "bua_com", "nho_mat", "lo_to", "ca_phe"];

/** Jeux jouables sur /jeux/:game : accroche et icône de la carte. Les autres s'affichent « bientôt ». */
const PLAYABLE: Partial<Record<GameId, { tagline: MessageKey; icon: IconName }>> = {
  cho_noi: { tagline: "games.choNoi.tagline", icon: "boat" },
  xe_om: { tagline: "games.xeOm.tagline", icon: "scooter" },
  bua_com: { tagline: "games.buaCom.tagline", icon: "bowl" },
  nho_mat: { tagline: "nhoMat.tagline", icon: "cards" },
  lo_to: { tagline: "loTo.tagline", icon: "lantern" },
  ca_phe: { tagline: "caPhe.tagline", icon: "bowl" },
};

export const bestKey = (game: GameId) => `games.${game}.best`;

/** Une entrée de la liste : soit un jeu ouvert (`to`), soit un jeu encore fermé (`soon`). */
interface Row {
  id: GameId;
  name: string;
  icon: IconName;
  to?: string;
  tagline?: string;
  state?: ReactNode;
  soon?: string;
}

export function GamesPage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const [bests, setBests] = useState<Partial<Record<GameId, GameBest | null>> | undefined>(undefined);
  const tutorAvailable = useTutorStatus((s) => s.available);
  // Karaoké tonal : entrée masquée tant qu'aucune courbe de référence n'est présente (contrat phase5 §1).
  const karaoke = useMemo(() => karaokeCandidates(content, new Set()).all.length > 0, [content]);
  // Chợ nổi fait trier des barques à l'oreille : sans voix native, il s'ouvrait sur « Pas assez de
  // mots avec un audio natif pour jouer ici ». On ne l'ouvre plus (contrat phase16 §5) — même
  // règle et même endroit que le karaoké.
  const voices = useMemo(() => packHasNativeAudio(content), [content]);
  useEffect(() => {
    const ids = MVP_GAMES.filter((id) => PLAYABLE[id]);
    void Promise.all(ids.map((id) => getKv<GameBest | null>(bestKey(id), null))).then((values) =>
      setBests(Object.fromEntries(ids.map((id, i) => [id, values[i] ?? null]))),
    );
  }, []);

  // Le record arrive après une lecture d'IndexedDB : un squelette tient sa place, jamais un trou.
  const state = (id: GameId): ReactNode => {
    if (bests === undefined) return <Skeleton className="h-6 w-44 self-start" />;
    const best = bests[id];
    if (!best) return <Chip className="self-start">{t("games.noBest")}</Chip>;
    return <Chip tone="nghe" icon="trophy" className="self-start">{t("games.best", { points: best.points, correct: best.correct, total: best.total })}</Chip>;
  };

  const rows: Row[] = [];
  for (const id of MVP_GAMES) {
    const name = t(`game.${id}` as MessageKey);
    // Karaoké tonal : page propre (apps/web/src/karaoke), route /jeux/karaoke_tonal.
    if (id === "karaoke_tonal") {
      if (karaoke) rows.push({ id, name, icon: "karaoke", to: "/jeux/karaoke_tonal", tagline: t("karaoke.game.tagline") });
      continue;
    }
    const entry = PLAYABLE[id];
    // Jeu d'oreille sans voix native : on ne le montre pas du tout, comme le karaoké tonal sans
    // courbe. Une ligne verrouillée qui explique une absence est encore une façon de l'exposer ;
    // le jeu revient de lui-même le jour où les enregistrements arrivent.
    if (entry && !isGamePlayable(content, id)) continue;
    rows.push(
      entry
        ? { id, name, icon: entry.icon, to: `/jeux/${id}`, tagline: t(entry.tagline), state: state(id) }
        : { id, name, icon: "lock", soon: t("games.soon") },
    );
  }
  // Phase 3 : Đối đáp, conversation chronométrée avec Cô Mai (page propre, compte et réseau requis).
  rows.push(
    tutorAvailable === false
      ? { id: "doi_dap", name: t("game.doi_dap"), icon: "lock", soon: t("journey.games.soon") }
      : { id: "doi_dap", name: t("game.doi_dap"), icon: "dialogue", to: "/jeux/doi_dap", tagline: t("tutor.doiDap.tagline") },
  );
  // Hiérarchie (contrat §1) : le premier jeu ouvert — tête de liste dans l'ordre de la spec — porte
  // le poids de l'écran ; les autres restent des surfaces posées.
  const featured = rows.find((row) => row.to)?.id;

  return (
    <Screen top={<PageHeader title={t("games.title")} subtitle={t("games.intro")} back="/" backLabel={t("games.home")} />}>
      {/* Le marché flottant ouvre l'écran : la promesse en une image, avant la liste. */}
      <Illustration className="mx-auto max-w-[15rem] motion-safe:parlo-enter">
        <FloatingMarket />
      </Illustration>
      {rows.length === 0 ? (
        <EmptyState
          art="market"
          title={t("games.empty.title")}
          body={t("games.empty.body")}
          action={<Button onClick={() => navigate("/")}>{t("games.home")}</Button>}
          className="mt-4"
        />
      ) : (
        <ul className="flex flex-col gap-3 pt-5">
          {rows.map((row, i) => (
            <GameRow key={row.id} row={row} featured={row.id === featured} stagger={i} />
          ))}
        </ul>
      )}
    </Screen>
  );
}

/**
 * Une ligne de la liste. Le lien est *étiré* sur toute la carte (`after:inset-0`) : la carte
 * entière se touche, mais le nom accessible du lien reste le seul nom du jeu — le record et
 * l'accroche ne s'y collent pas.
 */
function GameRow({ row, featured, stagger }: { row: Row; featured: boolean; stagger: number }) {
  const open = row.to !== undefined;
  return (
    <Card
      as="li"
      tone={open ? (featured ? "feature" : "plain") : "quiet"}
      stagger={stagger}
      data-game={row.id}
      className="relative flex items-center gap-4"
    >
      <span
        className={`grid size-12 shrink-0 place-items-center rounded-full ${
          featured ? "bg-ngoc text-nuoc" : open ? "bg-ngoc-sang text-ngoc" : "bg-phu-sa/10 text-phu-sa"
        }`}
      >
        <Icon name={row.icon} size={24} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {row.to ? (
          <Link to={row.to} className="flex min-h-11 items-center rounded-card after:absolute after:inset-0 after:rounded-card">
            <Vi size="2xl">{row.name}</Vi>
          </Link>
        ) : (
          <Vi size="2xl" className="flex min-h-11 items-center text-phu-sa/80">{row.name}</Vi>
        )}
        {row.tagline && <span className="text-sm text-phu-sa">{row.tagline}</span>}
        {row.soon && <Chip className="self-start">{row.soon}</Chip>}
        {row.state}
      </span>
    </Card>
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
  if (!completed) return <Screen><GameLoading /></Screen>;

  const onStart = () => {
    startedAt.current = Date.now();
    setNewBest(false);
  };
  const onFinish = (result: GameResult) => {
    void recordGamePlayed(id, result, Date.now() - startedAt.current).catch(() => undefined);
    // Une partie rapporte des xu et nourrit missions et trophées. Jamais bloquant : une récompense
    // qui échoue ne doit pas abîmer la fin de partie.
    void awardGame({ ...result, won: result.total > 0 && result.correct / result.total >= GAME_PASS_RATIO })
      .then(celebrate)
      .catch(() => undefined);
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
    bestChip: best && <Chip tone="nghe" icon="trophy" className="self-start">{t("games.best", { points: best.points, correct: best.correct, total: best.total })}</Chip>,
    resultExtra: newBest ? <p className="font-semibold text-nghe-ecrit">{t("games.newBest")}</p> : null,
    resultActions: (_: GameResult, replay: () => void) => (
      <>
        <Button onClick={replay}>{t("games.replay")}</Button>
        <Button variant="quiet" onClick={() => navigate("/jeux")}>{t("games.back")}</Button>
      </>
    ),
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] md:max-w-[720px]">
      <GameBack to="/jeux" label={t("games.back")} />
      <main className="flex flex-1 flex-col pt-2">
        {id === "cho_noi" && <ChoNoiStandalone {...common} completed={completed} />}
        {id === "xe_om" && <XeOmStandalone {...common} />}
        {id === "bua_com" && <BuaComStandalone {...common} completed={completed} />}
        {id === "nho_mat" && <NhoMatStandalone {...common} completed={completed} />}
        {id === "lo_to" && <LoToStandalone {...common} completed={completed} />}
        {id === "ca_phe" && <CaPheStandalone {...common} completed={completed} />}
      </main>
    </div>
  );
}

interface StandaloneProps {
  content: ContentIndex;
  seed: string;
  bestChip: ReactNode;
  onStart: () => void;
  onFinish: (result: GameResult) => void;
  resultExtra: ReactNode;
  resultActions: (result: GameResult, replay: () => void) => ReactNode;
}

/** Bandeau d'intro d'un jeu seul : d'où viennent les mots, et le record s'il y en a un. */
function PoolLine({ label, bestChip }: { label: string; bestChip: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-phu-sa">{label}</p>
      {bestChip}
    </div>
  );
}

function ChoNoiStandalone({ completed, bestChip, ...props }: StandaloneProps & { completed: ReadonlySet<string> }) {
  const pool = useMemo(() => gamePool(props.content, completed), [props.content, completed]);
  return (
    <ChoNoi
      {...props}
      concepts={pool.concepts}
      introExtra={<PoolLine label={pool.fromCompleted ? t("games.choNoi.pool") : t("games.choNoi.poolFirst")} bestChip={bestChip} />}
    />
  );
}

function XeOmStandalone({ bestChip, seed, ...props }: StandaloneProps) {
  const data = useXeOmData(props.content);
  const pickRoutes = useCallback((attempt: number) => (data ? pickXeOmRoutes(data, `${seed}:${attempt}`) : []), [data, seed]);
  if (data === undefined) return <GameLoading />;
  if (data === null) return <EmptyState art="market" title={t("games.xeOm.empty")} className="my-auto" />;
  return <XeOm {...props} data={data} pickRoutes={pickRoutes} introExtra={bestChip} />;
}

function BuaComStandalone({ completed, bestChip, seed, ...props }: StandaloneProps & { completed: ReadonlySet<string> }) {
  const pool = useMemo(() => buaComStandaloneSources(props.content, completed), [props.content, completed]);
  const makeRounds = useCallback((attempt: number) => generateBuaComRounds(pool.sources, `${seed}:${attempt}`), [pool, seed]);
  return (
    <BuaCom
      {...props}
      makeRounds={makeRounds}
      introExtra={<PoolLine label={pool.fromCompleted ? t("games.pool.completed") : t("games.pool.first")} bestChip={bestChip} />}
    />
  );
}

function NhoMatStandalone({ completed, bestChip, ...props }: StandaloneProps & { completed: ReadonlySet<string> }) {
  const pool = useMemo(() => nhoMatStandalonePool(props.content, completed), [props.content, completed]);
  return (
    <NhoMat
      {...props}
      concepts={pool.concepts}
      introExtra={<PoolLine label={pool.fromCompleted ? t("nhoMat.pool.completed") : t("nhoMat.pool.first")} bestChip={bestChip} />}
    />
  );
}

function LoToStandalone({ completed, bestChip, ...props }: StandaloneProps & { completed: ReadonlySet<string> }) {
  const pool = useMemo(() => gamePool(props.content, completed), [props.content, completed]);
  return (
    <LoTo
      {...props}
      concepts={pool.concepts}
      introExtra={<PoolLine label={pool.fromCompleted ? t("games.pool.completed") : t("games.pool.first")} bestChip={bestChip} />}
    />
  );
}

function CaPheStandalone({ completed, bestChip, ...props }: StandaloneProps & { completed: ReadonlySet<string> }) {
  const pool = useMemo(() => gamePool(props.content, completed), [props.content, completed]);
  return (
    <CaPhe
      {...props}
      concepts={pool.concepts}
      introExtra={<PoolLine label={pool.fromCompleted ? t("games.pool.completed") : t("games.pool.first")} bestChip={bestChip} />}
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
