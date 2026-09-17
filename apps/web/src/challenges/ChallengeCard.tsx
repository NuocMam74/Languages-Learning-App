import type { ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { useAccount } from "../account.ts";
import { Card, Icon, ProgressBar } from "../design/index.ts";
import { getLocale, l, t, type MessageKey } from "../i18n/index.ts";
import { useOnline } from "../use-online.ts";
import { claim, loadChallenge, type ChallengeView } from "./challenge-store.ts";

/** Défi de la semaine sur le hub : titre, barre de progression, badge à récupérer. */
export function ChallengeCard({ content, onClaimed }: { content: ContentIndex; onClaimed?: () => void }) {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [view, setView] = useState<ChallengeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [xp, setXp] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    void loadChallenge(content, { signedIn: status === "signed_in" || status === "expired", online: online && status === "signed_in" }).then(setView, () => setView(null));
  }, [content, status, online]);

  if (!view) return null;
  const { challenge, progress } = view;
  const title = l(challenge.title) || t(`challenges.kind.${challenge.kind}` as MessageKey, { n: challenge.target });
  const done = progress >= challenge.target;
  const claimed = challenge.claimedAt !== null;
  const end = new Date(Date.parse(challenge.periodEnd) - 1).toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long" });
  const canClaimNow = view.source === "local" || online;

  const onClaim = async () => {
    setBusy(true);
    setError(false);
    try {
      const result = await claim(view);
      setXp(result.xp);
      setView({ ...view, challenge: { ...challenge, claimedAt: result.claimedAt } });
      onClaimed?.();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    // Carte de rappel du hub : curcuma dilué, jamais un bandeau pleine largeur qui crie. Elle vit
    // dans un `Slot` qui réserve sa hauteur — pas d'animation d'entrée ici (elle fausserait la mesure).
    <section className="mb-5" aria-label={t("challenges.label")} data-testid="challenge">
      <Card tone="notice" className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-sm text-phu-sa">
          <Icon name="trophy" size={16} className="text-nghe" />
          {t("challenges.label")} · {t("challenges.until", { date: end })}
        </p>
        <p className="font-semibold">{title}</p>
        <div className="flex items-center gap-3">
          <ProgressBar
            className="flex-1"
            value={progress}
            max={challenge.target}
            label={title}
            tone={done ? "nghe" : "ngoc"}
          />
          <span className="shrink-0 text-sm tabular-nums text-phu-sa">{t("challenges.progress", { done: Math.min(progress, challenge.target), target: challenge.target })}</span>
        </div>
        {done && !claimed && (
          canClaimNow ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onClaim()}
              className="min-h-11 self-start rounded-chip bg-ngoc px-4 font-semibold text-nuoc transition-[background-color,transform] motion-safe:active:scale-[.98] disabled:bg-phu-sa/25"
            >
              {busy ? t("challenges.claiming") : t("challenges.claim")}
            </button>
          ) : (
            <p className="text-sm text-phu-sa">{t("challenges.claimOffline")}</p>
          )
        )}
        {claimed && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ngoc" role="status">
            <Icon name="check" size={16} />
            {xp ? t("challenges.claimedXp", { n: xp }) : t("challenges.claimed")}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-son-mai">{t("exams.error.generic")}</p>}
      </Card>
    </section>
  );
}
