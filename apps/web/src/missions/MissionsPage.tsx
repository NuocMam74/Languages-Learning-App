import type { ContentIndex, Mission, Period } from "@parlo/core";
import { useCallback, useEffect, useState } from "react";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon, PageHeader, ProgressBar, SectionTitle, Skeleton } from "../design/index.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { celebrate } from "../rewards/celebrate.ts";
import { CoinIcon } from "../rewards/RewardArt.tsx";
import { claimMission, missionGroups, useRewards, type MissionGroup, type MissionView } from "../rewards/store.ts";
import { QuestCard } from "./QuestCard.tsx";

/**
 * Missions (contrat phase9 §3) : trois périodes, une section chacune, la plus courte en haut.
 *
 * L'écran ne presse personne : une période dit jusqu'à quand elle court, jamais « plus que… ».
 * La réclamation est un geste — c'est le moment où l'on reçoit, et il vaut mieux qu'il se voie.
 */

export const missionLabel = (mission: Mission): string => t(`mission.${mission.kind}.label` as MessageKey, { n: mission.target });

/** Jusqu'à quand court la période, en clair. */
export function periodDeadline(period: Period, now = new Date()): string {
  const days = Math.ceil((period.endsAt.getTime() - now.getTime()) / 86_400_000);
  if (days <= 1) return t("mission.endsToday");
  if (days === 2) return t("mission.endsTomorrow");
  return t("mission.endsIn", { n: days });
}

const rewardLabel = (mission: Mission): string =>
  mission.reward.chest ? t("missions.reward.chest", { n: mission.reward.coins }) : t("missions.reward", { n: mission.reward.coins });

export default function MissionsPage({ content }: { content: ContentIndex }) {
  const [groups, setGroups] = useState<MissionGroup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const coins = useRewards((s) => s.data.coins);

  const reload = useCallback(() => {
    void missionGroups(content.pack).then(setGroups);
  }, [content.pack]);

  useEffect(() => {
    void useRewards.getState().load();
    reload();
  }, [reload]);

  const claim = async (view: MissionView, period: Period) => {
    if (busy) return;
    setBusy(view.mission.id);
    try {
      celebrate(await claimMission(view.mission, period));
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      top={
        <PageHeader
          title={t("missions.title")}
          subtitle={t("missions.intro")}
          back="/profil"
          backLabel={t("nav.profile")}
          actions={<Chip tone="nghe" data-testid="missions-coins"><CoinIcon size={15} />{t("rewards.coins", { n: coins })}</Chip>}
        />
      }
    >
      {/* La quête ouvre l'écran (contrat phase24 §4) : elle demande des jours, les missions
          demandent du volume — et seule la première donne une raison d'ouvrir l'app un mardi. */}
      <div className="pt-2 pb-5">
        <QuestCard onClaimed={reload} />
      </div>

      {groups === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" rounded="card" />
          <Skeleton className="h-24 w-full" rounded="card" />
        </div>
      ) : groups.every((group) => group.missions.length === 0) ? (
        <EmptyState art="boat" title={t("missions.empty.title")} body={t("missions.empty.body")} className="my-auto" />
      ) : (
        <div className="flex flex-col gap-6 pt-2">
          {groups.map((group) => (
            <section key={group.period.kind} aria-labelledby={`missions-${group.period.kind}`} data-testid="mission-group" data-period={group.period.kind}>
              <SectionTitle
                id={`missions-${group.period.kind}`}
                tone="strong"
                icon={group.period.kind === "daily" ? "clock" : group.period.kind === "weekly" ? "calendar" : "chart"}
                className="mb-2"
                action={<span className="text-sm text-phu-sa">{periodDeadline(group.period)}</span>}
              >
                {t(`mission.period.${group.period.kind}` as MessageKey)}
              </SectionTitle>
              <ul className="flex flex-col gap-2">
                {group.missions.map((view, i) => (
                  <MissionRow key={view.mission.id} view={view} stagger={i} busy={busy === view.mission.id} onClaim={() => void claim(view, group.period)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Screen>
  );
}

function MissionRow({ view, stagger, busy, onClaim }: { view: MissionView; stagger: number; busy: boolean; onClaim: () => void }) {
  const { mission, progress, done, claimedAt } = view;
  const label = missionLabel(mission);
  const claimable = done && claimedAt === null;
  return (
    <Card
      as="li"
      // Une mission à réclamer porte le poids de la liste : c'est la seule qui demande un geste.
      tone={claimable ? "notice" : "plain"}
      stagger={stagger}
      data-testid="mission"
      data-kind={mission.kind}
      data-done={done || undefined}
      data-claimed={claimedAt !== null || undefined}
      className="flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 font-medium">{label}</p>
        {claimedAt !== null ? (
          <Chip tone="ngoc" icon="check">{t("missions.claimed")}</Chip>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-sm text-phu-sa">
            <CoinIcon size={14} />
            <span className="tabular-nums">{rewardLabel(mission)}</span>
          </span>
        )}
      </div>
      <ProgressBar
        value={progress}
        max={mission.target}
        size="sm"
        tone={done ? "nghe" : "ngoc"}
        label={t("missions.progress", { done: progress, total: mission.target })}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-phu-sa tabular-nums">{t("missions.progress", { done: progress, total: mission.target })}</span>
        {claimable && (
          <button
            type="button"
            onClick={onClaim}
            disabled={busy}
            aria-label={t("missions.claim.label", { name: label })}
            data-testid="mission-claim"
            className="flex min-h-11 items-center gap-2 rounded-chip bg-nghe px-4 font-semibold text-muc transition-transform disabled:opacity-60 motion-safe:active:scale-[.98]"
          >
            <Icon name="star" size={16} />
            {t("missions.claim")}
          </button>
        )}
      </div>
    </Card>
  );
}
