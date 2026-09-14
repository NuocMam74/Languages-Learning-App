import { betterChoNoiBest, type ChoNoiBest, type ChoNoiResult, type Concept, type ContentIndex, type GameId } from "@parlo/core";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { getKv, setKv } from "../db.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { completedLessons } from "../learner.ts";
import { BoatHull } from "./Boat.tsx";
import { ChoNoi } from "./ChoNoi.tsx";

/** Onglet « Jeux » (spec §5.6) : chaque mini-jeu jouable seul. */

const BEST_KEY = "games.cho_noi.best";
/** Les 4 jeux du MVP, dans l'ordre de la spec. */
const MVP_GAMES: GameId[] = ["cho_noi", "karaoke_tonal", "xe_om", "bua_com"];
const PLAYABLE: ReadonlySet<GameId> = new Set(["cho_noi"]);

export function GamesPage() {
  const [best, setBest] = useState<ChoNoiBest | null | undefined>(undefined);
  useEffect(() => {
    void getKv<ChoNoiBest | null>(BEST_KEY, null).then(setBest);
  }, []);

  return (
    <Screen top={<BackLink to="/" label={t("games.home")} />}>
      <h1 className="font-serif text-2xl">{t("games.title")}</h1>
      <p className="pb-6 text-phu-sa">{t("games.intro")}</p>
      <ul className="flex flex-col">
        {MVP_GAMES.map((id) => {
          const name = t(`game.${id}` as MessageKey);
          if (!PLAYABLE.has(id)) {
            return (
              <li key={id} className="flex items-baseline justify-between border-t border-phu-sa/10 py-4 text-phu-sa/60">
                <Vi size="2xl">{name}</Vi>
                <span className="text-sm">{t("games.soon")}</span>
              </li>
            );
          }
          return (
            <li key={id} className="pb-4">
              <Link to={`/jeux/${id}`} className="flex items-center gap-4 rounded-2xl bg-ngoc px-5 py-5 text-nuoc">
                <span className="flex flex-1 flex-col gap-1">
                  <Vi size="vi">{name}</Vi>
                  <span className="text-sm text-nuoc/85">{t("games.choNoi.tagline")}</span>
                  <span className="text-sm font-semibold text-nghe">
                    {best === undefined ? "" : best ? t("games.best", { points: best.points, correct: best.correct, total: best.total }) : t("games.noBest")}
                  </span>
                </span>
                <BoatHull className="w-24 shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}

export function GamePlayPage({ content }: { content: ContentIndex }) {
  const { game = "" } = useParams();
  const navigate = useNavigate();
  const [pool, setPool] = useState<{ concepts: Concept[]; fromCompleted: boolean } | null>(null);
  const [best, setBest] = useState<ChoNoiBest | null>(null);
  const [newBest, setNewBest] = useState(false);
  const seed = useMemo(() => String(Date.now()), []);

  useEffect(() => {
    void Promise.all([completedLessons(), getKv<ChoNoiBest | null>(BEST_KEY, null)]).then(([done, stored]) => {
      setBest(stored);
      setPool(gamePool(content, done));
    });
  }, [content]);

  if (game !== "cho_noi") return <Navigate to="/jeux" replace />;
  if (!pool) return <Screen><p className="my-auto text-center text-phu-sa">{t("games.loading")}</p></Screen>;

  const onFinish = (result: ChoNoiResult) => {
    const next = betterChoNoiBest(best, result);
    const improved = next !== best;
    setNewBest(improved);
    if (improved) {
      setBest(next);
      void setKv(BEST_KEY, next);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]">
      <BackLink to="/jeux" label={t("games.back")} />
      <main className="flex flex-1 flex-col pt-2">
        <ChoNoi
          content={content}
          concepts={pool.concepts}
          seed={seed}
          onFinish={onFinish}
          introExtra={
            <p className="text-sm text-phu-sa">
              {pool.fromCompleted ? t("games.choNoi.pool") : t("games.choNoi.poolFirst")}
              {best && <> · {t("games.best", { points: best.points, correct: best.correct, total: best.total })}</>}
            </p>
          }
          resultExtra={newBest ? <p className="font-semibold text-nghe">{t("games.choNoi.newBest")}</p> : null}
          resultActions={(_, replay) => (
            <>
              <Button onClick={() => { setNewBest(false); replay(); }}>{t("games.replay")}</Button>
              <Button variant="quiet" onClick={() => navigate("/jeux")}>{t("games.back")}</Button>
            </>
          )}
        />
      </main>
    </div>
  );
}

/** Concepts des leçons terminées (ordre du parcours), sinon ceux de la première leçon. */
export function gamePool(content: ContentIndex, completed: ReadonlySet<string>): { concepts: Concept[]; fromCompleted: boolean } {
  const lessonIds = content.curriculum.units.flatMap((u) => (u.status === "available" ? u.lessons : []));
  const done = lessonIds.filter((id) => completed.has(id));
  const fromCompleted = done.length > 0;
  const source = fromCompleted ? done : lessonIds.slice(0, 1);
  const seen = new Set<string>();
  const concepts = source.flatMap((id) => content.lessons.get(id)?.concepts ?? []).flatMap((id): Concept[] => {
    const c = content.concepts.get(id);
    if (!c || seen.has(id)) return [];
    seen.add(id);
    return [c];
  });
  return { concepts, fromCompleted };
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
