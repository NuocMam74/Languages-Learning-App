import { TROPHIES, type Pack } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, Chip, Icon, Skeleton, type IconName } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import { AvatarArt } from "../profile/AvatarArt.tsx";
import { CoinIcon } from "./RewardArt.tsx";
import { SceneArt } from "../scene/SceneArt.tsx";
import { claimableCount, loadRewardsData, placedScene, useRewards, wornOutfit } from "./store.ts";

/**
 * Bloc « Récompenses » du profil (contrat phase9) : la bourse, le personnage, et les trois portes
 * — missions, récompenses, atelier. Le profil ne répète pas ces pages, il y mène.
 *
 * Les hauteurs sont réservées d'avance : les chiffres arrivent d'IndexedDB et le profil est mesuré
 * à CLS ≤ 0,05 (contrat phase8 §1).
 */
export function RewardsBlock({ pack }: { pack: Pack }) {
  const data = useRewards((s) => s.data);
  const loaded = useRewards((s) => s.loaded);
  const [claimable, setClaimable] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void loadRewardsData().then((next) => {
      if (!live) return;
      useRewards.setState({ data: next, loaded: true });
    });
    void claimableCount(pack).then((n) => live && setClaimable(n));
    return () => {
      live = false;
    };
  }, [pack]);

  const outfit = wornOutfit(data);

  return (
    <Card className="flex flex-col gap-4" data-testid="profile-rewards">
      <div className="flex items-center gap-4">
        {loaded ? <AvatarArt outfit={outfit} size={72} /> : <Skeleton className="size-[72px]" />}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-serif text-lg text-nghe-ecrit">
            <CoinIcon size={20} />
            <span className="tabular-nums" data-testid="profile-coins">{loaded ? t("rewards.coins", { n: data.coins }) : ""}</span>
          </p>
          <p className="text-sm text-phu-sa tabular-nums">
            {loaded ? t("trophy.count", { n: data.trophies.length, total: TROPHIES.length }) : ""}
          </p>
        </div>
      </div>
      {/* La rive, en petit et cliquable : c'est ce qu'on a acheté, il faut que ça se voie sans
          aller le chercher (contrat phase24 §2). Ratio fixe — rien ne se décale en arrivant. */}
      <Link to="/ma-rive" aria-label={t("scene.open")} data-testid="rewards-scene" className="block">
        {loaded ? <SceneArt scene={placedScene(data)} /> : <Skeleton className="aspect-[12/7] w-full" rounded="card" />}
      </Link>

      <div className="flex flex-col">
        <RowLink to="/missions" icon="target" badge={claimable !== null && claimable > 0 ? t("missions.claimable", { n: claimable }) : null}>
          {t("missions.open")}
        </RowLink>
        <RowLink to="/boutique" icon="star">{t("shop.open")}</RowLink>
        <RowLink to="/ma-rive" icon="boat">{t("scene.open")}</RowLink>
        <RowLink to="/calendrier" icon="calendar">{t("calendar.open")}</RowLink>
        <RowLink to="/recompenses" icon="trophy">{t("rewards.open")}</RowLink>
        <RowLink to="/atelier" icon="user">{t("wardrobe.open")}</RowLink>
      </div>
    </Card>
  );
}

/** Même rangée que le reste du profil, avec une pastille facultative (missions à réclamer). */
function RowLink({ to, icon, badge, children }: { to: string; icon: IconName; badge?: string | null; children: string }) {
  return (
    <Link to={to} className="flex min-h-12 items-center gap-3 border-t border-line font-semibold text-ngoc first:border-t-0" data-testid={`rewards-link-${to.slice(1)}`}>
      <Icon name={icon} size={20} />
      <span className="min-w-0 flex-1">{children}</span>
      {badge && <Chip tone="nghe">{badge}</Chip>}
      <Icon name="chevronRight" size={18} className="text-phu-sa" />
    </Link>
  );
}
