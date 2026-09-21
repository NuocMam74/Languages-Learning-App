import { QUEST_TARGET_DAYS, type QuestProgress, type QuestStep } from "@parlo/core";
import { useCallback, useEffect, useState } from "react";
import { Card, Chip, Icon, ProgressBar, Skeleton } from "../design/index.ts";
import { getLocale, plural, t } from "../i18n/index.ts";
import { celebrate } from "../rewards/celebrate.ts";
import { CoinIcon } from "../rewards/RewardArt.tsx";
import { claimQuestStep, weeklyQuest } from "../rewards/store.ts";

/**
 * La quête de la semaine (contrat phase24 §4).
 *
 * Elle est **au-dessus** des missions, et c'est délibéré : les missions demandent du volume, qui se
 * rattrape le dimanche soir ; la quête demande des **jours**, qui ne se rattrapent pas. C'est la
 * seule chose de cet écran qui pousse réellement à ouvrir l'application un mardi, et c'est aussi
 * la mesure la plus honnête de ce qui fait apprendre une langue.
 *
 * Ce que l'écran ne fait jamais : réclamer, décompter, rougir. Les sept cases de la semaine sont
 * là, celles qui sont faites sont pleines, les autres sont vides — sans un mot de plus.
 */
export function QuestCard({ onClaimed }: { onClaimed?: () => void }) {
  const [progress, setProgress] = useState<QuestProgress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    void weeklyQuest().then(setProgress);
  }, []);

  useEffect(reload, [reload]);

  const claim = async (step: QuestStep) => {
    if (busy) return;
    setBusy(step.id);
    try {
      celebrate(await claimQuestStep(step));
      reload();
      onClaimed?.();
    } finally {
      setBusy(null);
    }
  };

  if (!progress) return <Skeleton className="h-40 w-full" rounded="card" />;

  const done = progress.days.length;
  const max = QUEST_TARGET_DAYS.at(-1) ?? 7;
  const locale = getLocale();
  // Les sept jours de la semaine, dans l'ordre : ceux travaillés sont pleins.
  const worked = new Set(progress.days);

  return (
    <Card tone="feature" as="section" className="flex flex-col gap-3" data-testid="quest-card" data-days={done}>
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 flex-col">
          <span className="font-serif text-lg">{t("quest.title")}</span>
          <span className="text-sm text-phu-sa">{t("quest.subtitle")}</span>
        </p>
        <Chip tone="solid" data-testid="quest-days">{plural("quest.days.one", "quest.days", done)}</Chip>
      </div>

      {/* Les sept cases : la semaine se lit d'un coup d'œil, sans compter. */}
      <ul className="grid grid-cols-7 gap-1.5" data-testid="quest-week">
        {progress.period.days.map((day) => {
          const filled = worked.has(day);
          const initial = new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: "narrow" });
          return (
            <li key={day} className="flex flex-col items-center gap-1">
              <span className="text-sm text-phu-sa">{initial}</span>
              <span
                data-testid="quest-day"
                data-day={day}
                data-filled={filled || undefined}
                aria-label={new Date(`${day}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" })}
                className={`grid aspect-square w-full place-items-center rounded-chip ${filled ? "bg-ngoc text-nuoc" : "bg-phu-sa/10"}`}
              >
                {filled && <Icon name="check" size={14} strokeWidth={3} />}
              </span>
            </li>
          );
        })}
      </ul>

      <ProgressBar value={Math.min(done, max)} max={max} size="sm" label={t("quest.title")} />

      <ul className="flex flex-col gap-2" data-testid="quest-steps">
        {progress.steps.map((view) => {
          const claimable = view.done && view.claimedAt === null;
          return (
            <li
              key={view.step.id}
              data-testid="quest-step"
              data-days={view.step.days}
              data-state={view.claimedAt ? "claimed" : view.done ? "claimable" : "locked"}
              className={`flex min-h-12 items-center gap-3 rounded-card border px-3 ${
                claimable ? "border-nghe/40 bg-surface-nghe" : "border-line"
              }`}
            >
              <span className={`grid size-8 shrink-0 place-items-center rounded-full ${view.done ? "bg-ngoc-sang text-ngoc" : "bg-phu-sa/10 text-phu-sa"}`}>
                {view.done ? <Icon name="check" size={16} strokeWidth={3} /> : <span className="text-sm font-semibold tabular-nums">{view.step.days}</span>}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{t("quest.step", { n: view.step.days })}</span>
                <span className="flex items-center gap-1 text-sm text-phu-sa">
                  <CoinIcon size={13} />
                  {t("quest.step.reward", { n: view.step.coins })}
                  {view.step.chest && <span>{t("quest.step.chest")}</span>}
                </span>
              </span>
              {claimable ? (
                <button
                  type="button"
                  disabled={busy === view.step.id}
                  onClick={() => void claim(view.step)}
                  data-testid="quest-claim"
                  className="min-h-11 shrink-0 rounded-chip bg-ngoc px-4 text-sm font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98]"
                >
                  {t("quest.step.claim")}
                </button>
              ) : (
                <span className="shrink-0 text-sm text-phu-sa">{view.claimedAt ? t("quest.step.claimed") : ""}</span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Jamais « il te manque », toujours « encore » — et rien du tout quand la semaine est pleine. */}
      <p className="min-h-[1.3125rem] text-sm text-phu-sa">
        {progress.next
          ? plural("quest.next", "quest.next.plural", progress.next.days - done)
          : t("quest.complete")}
      </p>
      <p className="text-sm text-phu-sa">{t("quest.hint")}</p>
    </Card>
  );
}
