import { localDay, type ChoNoiOptions, type ContentIndex, type GameResult } from "@parlo/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError } from "../api.ts";
import { shareImage } from "../certificates/share-image.ts";
import { Button, Screen } from "../components/ui.tsx";
import { BackHeader } from "../exams/BackHeader.tsx";
import { ChoNoi } from "../games/ChoNoi.tsx";
import { gamePool } from "../games/GamesPage.tsx";
import { getLocale, t, type MessageKey } from "../i18n/index.ts";
import { ordinal } from "../leagues/league-store.ts";
import { completedLessons, recordGamePlayed } from "../learner.ts";
import { useOnline } from "../use-online.ts";
import { renderExpressImage } from "./express-image.ts";
import { EXPRESS_DURATION_MS, expressInput, flushExpressQueue, getExpressLocalBest, saveExpressLocalBest, submitExpressScore, type ExpressSubmit } from "./express-store.ts";
import { getExpressShare, type ExpressShareDto } from "./social-api.ts";

/** Défi express : 60 s de Chợ nổi, rejouable ; au-delà du temps, les barques restantes ne comptent pas. */
const EXPRESS_OPTIONS: Partial<ChoNoiOptions> = { rounds: 60, durationMs: EXPRESS_DURATION_MS };

type Posting = { status: "idle" } | { status: "posting" } | ExpressSubmit;

export function ExpressPage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const status = useAccount((s) => s.status);
  const account = useAccount((s) => s.account);
  const online = useOnline();
  const [completed, setCompleted] = useState<Set<string> | null>(null);
  const [localBest, setLocalBest] = useState(0);
  const [posting, setPosting] = useState<Posting>({ status: "idle" });
  const [last, setLast] = useState<{ score: number; correct: number; at: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const startedAt = useRef(Date.now());
  const today = localDay(new Date());
  // Même graine pour tous le même jour : classement du jour comparable.
  const seed = `express:${today}`;

  useEffect(() => {
    void Promise.all([completedLessons(), getExpressLocalBest()]).then(([done, best]) => {
      setCompleted(done);
      setLocalBest(best);
    });
  }, [content]);

  useEffect(() => {
    if (status === "signed_in" && online) void flushExpressQueue().catch(() => undefined);
  }, [status, online]);

  const pool = useMemo(() => (completed ? gamePool(content, completed) : null), [content, completed]);
  if (!pool) return <Screen><p className="my-auto text-center text-phu-sa">{t("games.loading")}</p></Screen>;

  const onStart = () => {
    startedAt.current = Date.now();
    setPosting({ status: "idle" });
    setShareError(false);
  };

  const onFinish = (result: GameResult) => {
    const input = expressInput(result, localDay(new Date()));
    setLast({ score: input.score, correct: input.correct, at: new Date().toISOString() });
    void recordGamePlayed("cho_noi", result, Date.now() - startedAt.current).catch(() => undefined);
    void saveExpressLocalBest(input.score).then(setLocalBest);
    setPosting({ status: "posting" });
    void submitExpressScore(input, { signedIn: status === "signed_in", online: navigator.onLine }).then(setPosting, () => setPosting({ status: "error" }));
  };

  const shareId = posting.status === "posted" ? (posting.result.id ?? posting.result.shareId ?? null) : null;
  const shareUrl = shareId ? `${window.location.origin}/partage/${encodeURIComponent(shareId)}` : window.location.origin;

  const share = async () => {
    if (!last) return;
    setSharing(true);
    setShareError(false);
    try {
      const blob = await renderExpressImage({
        score: last.score,
        correct: last.correct,
        gameName: t("game.cho_noi"),
        displayName: account?.displayName ?? null,
        date: last.at,
        locale: getLocale(),
        url: shareUrl,
        labels: { challenge: t("social.image.label"), points: t("social.image.points"), correct: t("social.image.correct", { correct: last.correct }) },
      });
      await shareImage(blob, "parlo-defi-express.png", `${t("social.express.shareText", { n: last.score })} · ${shareUrl}`);
    } catch {
      setShareError(true);
    } finally {
      setSharing(false);
    }
  };

  const statusLine = (): { key: MessageKey; vars?: Record<string, string | number> } | null => {
    switch (posting.status) {
      case "posting":
        return { key: "social.express.posting" };
      case "queued":
        return { key: "social.express.queued" };
      case "guest":
        return { key: "social.express.guest" };
      case "error":
        return { key: "social.express.error" };
      default:
        return null;
    }
  };
  const line = statusLine();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]" data-testid="express" data-posting={posting.status}>
      <BackHeader title={t("social.express.title")} to="/defis" />
      <main className="flex flex-1 flex-col pt-2">
        <ChoNoi
          content={content}
          concepts={pool.concepts}
          seed={seed}
          options={EXPRESS_OPTIONS}
          timed
          onStart={onStart}
          onFinish={onFinish}
          introExtra={
            <div className="flex flex-col gap-1 border-l-4 border-nghe pl-3">
              <p className="font-semibold">{t("social.express.tagline")}</p>
              <p className="text-sm text-phu-sa">{t("social.express.rules")}</p>
              {localBest > 0 && <p className="text-sm text-phu-sa">{t("social.express.localBest", { n: localBest })}</p>}
            </div>
          }
          resultExtra={
            <div className="flex flex-col gap-1" data-testid="express-result">
              {posting.status === "posted" && (
                <>
                  <p className="font-semibold text-ngoc">{t("social.express.best", { n: posting.result.best })}</p>
                  <p className="text-phu-sa">
                    {posting.result.rankToday !== null ? t("social.express.rank", { rank: ordinal(posting.result.rankToday, getLocale()) }) : t("social.express.noRank")}
                  </p>
                </>
              )}
              {posting.status !== "posted" && localBest > 0 && <p className="font-semibold text-ngoc">{t("social.express.best", { n: localBest })}</p>}
              {line && <p className="text-sm text-phu-sa" role="status">{t(line.key, line.vars)}</p>}
              {shareId && (
                <Link to={`/partage/${encodeURIComponent(shareId)}`} className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("social.express.sharePage")}</Link>
              )}
              {shareError && <p role="alert" className="text-sm text-son-mai">{t("social.error")}</p>}
            </div>
          }
          resultActions={(_, replay) => (
            <>
              <Button onClick={replay}>{t("games.replay")}</Button>
              <Button variant="quiet" disabled={sharing} onClick={() => void share()}>
                {sharing ? t("social.express.sharing") : t("social.express.share")}
              </Button>
              <Button variant="quiet" onClick={() => navigate("/defis")}>{t("social.express.back")}</Button>
            </>
          )}
        />
      </main>
    </div>
  );
}

/** Page publique /partage/:id : le score partagé et une invitation à essayer Parlo. */
export function SharePage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ok"; share: ExpressShareDto } | { kind: "notFound" } | { kind: "error" }>({ kind: "loading" });

  useEffect(() => {
    getExpressShare(id).then(
      (share) => setState({ kind: "ok", share }),
      (error: unknown) => setState(error instanceof ApiError && error.status === 404 ? { kind: "notFound" } : { kind: "error" }),
    );
  }, [id]);

  const gameName = (game: string) => (game === "cho_noi" ? t("game.cho_noi") : game);

  return (
    <Screen action={<Link to="/" className="grid min-h-14 place-items-center rounded-2xl bg-ngoc px-6 text-lg font-semibold text-nuoc">{t("social.share.cta")}</Link>}>
      <div className="flex flex-1 flex-col gap-5 pt-6" data-testid="share" data-state={state.kind}>
        <div>
          <p className="font-serif text-xl text-ngoc">Parlo</p>
          <h1 className="font-serif text-2xl">{t("social.share.title")}</h1>
        </div>
        {state.kind === "loading" && <p className="text-phu-sa">{t("social.share.loading")}</p>}
        {state.kind === "notFound" && <p className="border-l-4 border-phu-sa/30 pl-3 text-lg">{t("social.share.notFound")}</p>}
        {state.kind === "error" && <p className="text-phu-sa">{t("social.error")}</p>}
        {state.kind === "ok" && (
          <article className="flex flex-col gap-3 border-y-2 border-double border-ngoc py-8 text-center">
            <p lang="vi" className="font-serif text-vi italic text-ngoc">{gameName(state.share.game)}</p>
            <p className="font-serif text-vi-xl font-semibold motion-safe:animate-[rise_600ms_ease-out]">{t("social.share.score", { n: state.share.score })}</p>
            <p className="text-lg">{t("social.share.by", { name: state.share.displayName, game: gameName(state.share.game) })}</p>
            <p className="text-sm text-phu-sa">{new Date(state.share.createdAt).toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" })}</p>
          </article>
        )}
        <p className="text-sm text-phu-sa">{t("social.share.about")}</p>
      </div>
    </Screen>
  );
}
