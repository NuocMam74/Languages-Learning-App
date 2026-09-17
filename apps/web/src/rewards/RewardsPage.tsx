import {
  collectiblesOf,
  collectionRewardItem,
  COLLECTION_SETS,
  nextTrophy,
  setProgress,
  trophyCode,
  TROPHIES,
  TROPHY_FAMILIES,
  trophyTierOf,
  trophyValue,
  type CollectionSet,
  type TrophyFamily,
} from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon, PageHeader, ProgressBar, SectionTitle, Skeleton } from "../design/index.ts";
import { getLocale, t, type MessageKey } from "../i18n/index.ts";
import { CoinIcon, CollectibleIcon, TrophyIcon } from "./RewardArt.tsx";
import { loadRewardsData, useRewards, type RewardsData } from "./store.ts";

/**
 * Récompenses (contrat phase9 §2) : les xu, les trophées, les collections. Une page qui se lit de
 * haut en bas et qui montre **ce qui manque autant que ce qui est gagné** — un cadenas muet
 * n'apprend rien, une silhouette éteinte donne une direction.
 */

export default function RewardsPage() {
  const [data, setData] = useState<RewardsData | null>(null);

  useEffect(() => {
    void loadRewardsData().then((loaded) => {
      setData(loaded);
      useRewards.setState({ data: loaded, loaded: true });
    });
  }, []);

  if (!data) {
    return (
      <Screen top={<PageHeader title={t("rewards.title")} subtitle={t("rewards.intro")} back="/profil" backLabel={t("nav.profile")} />}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" rounded="card" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-40 w-full" rounded="card" />
        </div>
      </Screen>
    );
  }

  const earned = new Set(data.trophies.map((trophy) => trophy.code));
  const owned = new Set(data.collectibles.map((item) => item.id));
  const foundAt = new Map(data.collectibles.map((item) => [item.id, item.foundAt]));

  return (
    <Screen top={<PageHeader title={t("rewards.title")} subtitle={t("rewards.intro")} back="/profil" backLabel={t("nav.profile")} />}>
      {/* La bourse porte l'écran : c'est ce qu'on vient voir, et ce qui mène à l'atelier. */}
      <Card tone="feature" as="section" className="flex items-center justify-between gap-4" data-testid="rewards-purse">
        <div className="min-w-0">
          <p className="text-sm text-phu-sa">{t("rewards.coins.label")}</p>
          <p className="flex items-center gap-2 font-serif text-vi text-nghe-ecrit">
            <CoinIcon size={28} />
            <span className="tabular-nums" data-testid="rewards-coins">{data.coins}</span>
          </p>
          {data.spent > 0 && <p className="text-sm text-phu-sa tabular-nums">{t("rewards.spent", { n: data.spent })}</p>}
        </div>
        <Link
          to="/atelier"
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border-2 border-ngoc px-4 font-semibold text-ngoc transition-transform motion-safe:active:scale-[.98]"
        >
          {t("wardrobe.open")}
          <Icon name="chevronRight" size={18} />
        </Link>
      </Card>

      <section aria-labelledby="rewards-trophies" className="pt-6">
        <SectionTitle
          id="rewards-trophies"
          tone="strong"
          icon="trophy"
          className="mb-3"
          action={<span className="text-sm text-phu-sa tabular-nums">{t("trophy.count", { n: earned.size, total: TROPHIES.length })}</span>}
        >
          {t("trophy.title")}
        </SectionTitle>
        {earned.size === 0 && <p className="mb-3 text-phu-sa">{t("trophy.empty.body")}</p>}
        <ul className="flex flex-col gap-2" data-testid="trophy-list">
          {TROPHY_FAMILIES.map((family, i) => (
            <TrophyRow key={family} family={family} data={data} earned={earned} stagger={i} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="rewards-collections" className="pt-6 pb-2">
        <SectionTitle id="rewards-collections" tone="strong" icon="star" className="mb-3">{t("collection.title")}</SectionTitle>
        {owned.size === 0 ? (
          <EmptyState art="lanterns" title={t("collection.empty.title")} body={t("collection.empty.body")} compact />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="collection-list">
            {COLLECTION_SETS.map((set, i) => (
              <CollectionRow key={set} set={set} owned={owned} foundAt={foundAt} stagger={i} />
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

/** Une famille de trophées : le palier atteint, et ce qu'il reste pour le suivant. */
function TrophyRow({ family, data, earned, stagger }: { family: TrophyFamily; data: RewardsData; earned: ReadonlySet<string>; stagger: number }) {
  const tier = trophyTierOf(family, earned);
  const next = nextTrophy(family, earned);
  const value = trophyValue(family, { totals: data.totals, bestStreak: data.bestStreak, knownWords: data.knownWords });
  // Le médaillon montre le palier atteint ; sans palier, le prochain, éteint.
  const shown = tier === 0 ? (next?.code ?? trophyCode(family, 1)) : trophyCode(family, tier);
  return (
    <Card as="li" tone={tier === 3 ? "notice" : "plain"} stagger={stagger} data-testid="trophy" data-family={family} data-tier={tier} className="flex items-center gap-4">
      <TrophyIcon code={shown} earned={tier > 0} size={52} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {t(`trophy.${family}.name` as MessageKey)}
          {tier > 0 && <span className="font-normal text-phu-sa"> · {t(`trophy.tier.${tier}` as MessageKey)}</span>}
        </p>
        {next ? (
          <>
            <p className="text-sm text-phu-sa">{t(`trophy.${family}.desc` as MessageKey, { n: next.target })}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <ProgressBar value={value} max={next.target} size="sm" tone="nghe" label={t(`trophy.${family}.desc` as MessageKey, { n: next.target })} className="flex-1" />
              <span className="shrink-0 text-sm text-phu-sa tabular-nums">{t("trophy.next", { n: Math.max(0, next.target - value) })}</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-ngoc">{t("trophy.done")}</p>
        )}
      </div>
    </Card>
  );
}

function CollectionRow({ set, owned, foundAt, stagger }: { set: CollectionSet; owned: ReadonlySet<string>; foundAt: ReadonlyMap<string, string>; stagger: number }) {
  const items = collectiblesOf(set);
  const progress = setProgress(set, owned);
  const complete = progress.owned === progress.total;
  const reward = collectionRewardItem(set);
  return (
    <Card as="li" tone={complete ? "notice" : "plain"} stagger={stagger} data-testid="collection" data-set={set} data-complete={complete || undefined} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">{t(`collection.set.${set}.name` as MessageKey)}</p>
        <span className="shrink-0 text-sm text-phu-sa tabular-nums">{t("collection.progress", { owned: progress.owned, total: progress.total })}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const has = owned.has(item.id);
          const date = foundAt.get(item.id);
          const name = t(`collection.item.${item.id}.name` as MessageKey);
          return (
            <li key={item.id} className="flex w-[4.5rem] flex-col items-center gap-1 text-center" data-testid="collectible" data-owned={has || undefined}>
              <CollectibleIcon id={item.id} owned={has} rarity={item.rarity} size={44} />
              <span className={`text-sm leading-tight ${has ? "text-muc" : "text-phu-sa"}`}>{has ? name : t("collection.locked")}</span>
              {has && date && (
                <span className="sr-only">{t("collection.foundOn", { date: new Date(date).toLocaleDateString(getLocale(), { day: "numeric", month: "long" }) })}</span>
              )}
            </li>
          );
        })}
      </ul>
      {reward && !complete && (
        <p className="flex items-center gap-1.5 text-sm text-phu-sa">
          <Icon name="star" size={15} className="text-nghe" />
          {t("collection.reward", { name: t(`wardrobe.item.${reward.id}.name` as MessageKey) })}
        </p>
      )}
      {complete && (
        <Chip tone="ngoc" icon="check" className="self-start">
          {t("collection.progress", { owned: progress.owned, total: progress.total })}
        </Chip>
      )}
    </Card>
  );
}
