import { betterGameBest, type ContentIndex, type GameBest, type GameResult } from "@parlo/core";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui.tsx";
import { Chip } from "../design/index.ts";
import { getKv, setKv } from "../db.ts";
import { t } from "../i18n/index.ts";
import { recordGamePlayed } from "../learner.ts";
import { DoiDap } from "./DoiDap.tsx";
import { GameBack } from "./GameShell.tsx";

/** Đối đáp seul, depuis l'onglet Jeux (/jeux/doi_dap) : record local et game_played. */

export const DOI_DAP_BEST_KEY = "games.doi_dap.best";

export default function DoiDapPage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const [best, setBest] = useState<GameBest | null>(null);
  const [newBest, setNewBest] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    void getKv<GameBest | null>(DOI_DAP_BEST_KEY, null).then(setBest);
  }, []);

  const onFinish = (result: GameResult) => {
    void recordGamePlayed("doi_dap", result, Date.now() - startedAt.current).catch(() => undefined);
    const next = betterGameBest(best, result);
    setNewBest(next !== best);
    if (next !== best) {
      setBest(next);
      void setKv(DOI_DAP_BEST_KEY, next);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] md:max-w-[720px]">
      <GameBack to="/jeux" label={t("games.back")} />
      <main className="flex flex-1 flex-col pt-2">
        <DoiDap
          content={content}
          onStart={() => {
            startedAt.current = Date.now();
            setNewBest(false);
          }}
          onFinish={onFinish}
          introExtra={best ? <Chip tone="nghe" icon="trophy" className="self-start">{t("tutor.doiDap.best", { n: best.points })}</Chip> : null}
          resultActions={(_, replay) => (
            <>
              {newBest && <p className="text-center font-semibold text-nghe-ecrit">{t("games.newBest")}</p>}
              <Button onClick={replay}>{t("games.replay")}</Button>
              <Button variant="quiet" onClick={() => navigate("/jeux")}>{t("games.back")}</Button>
            </>
          )}
        />
      </main>
    </div>
  );
}
