import {
  itemPrice,
  itemState,
  itemsOfSlot,
  OPTIONAL_SLOTS,
  trophyByCode,
  WARDROBE_SLOTS,
  type ItemState,
  type Outfit,
  type WardrobeItem,
  type WardrobeSlot,
} from "@parlo/core";
import { useEffect, useState } from "react";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, Icon, PageHeader, SectionTitle, Skeleton } from "../design/index.ts";
import { playRewardSound } from "../feedback-sound.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { AvatarArt, WardrobePreview } from "../profile/AvatarArt.tsx";
import { CoinIcon } from "./RewardArt.tsx";
import { buyWardrobeItem, loadRewardsData, rewardsContext, useRewards, wearWardrobeItem, wornOutfit, type RewardsData } from "./store.ts";

/**
 * Atelier (contrat phase9 §4) : le personnage en haut, les pièces en dessous, emplacement par
 * emplacement. Le personnage se met à jour **tout de suite** quand on touche une pièce — c'est
 * tout l'intérêt, et il n'y a rien à valider.
 *
 * Ce qui est verrouillé reste **visible et expliqué** (« au niveau 12 », « en complétant Le
 * fleuve ») : une vitrine, pas une grille de cadenas.
 */

export default function WardrobePage() {
  const data = useRewards((s) => s.data);
  const loaded = useRewards((s) => s.loaded);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadRewardsData().then((next) => useRewards.setState({ data: next, loaded: true }));
  }, []);

  const outfit = wornOutfit(data);

  const wear = async (slot: WardrobeSlot, itemId: string | null) => {
    setNotice(null);
    await wearWardrobeItem(slot, itemId);
  };

  const buy = async (item: WardrobeItem) => {
    const price = itemPrice(item) ?? 0;
    const result = await buyWardrobeItem(item.id);
    if (result === "tooExpensive") {
      setNotice(t("wardrobe.tooExpensive", { n: Math.max(0, price - data.coins) }));
      return;
    }
    if (result !== "bought") return;
    playRewardSound();
    setNotice(null);
    // Une pièce qu'on vient d'acheter se porte tout de suite : c'est pour ça qu'on l'a achetée.
    await wearWardrobeItem(item.slot, item.id);
  };

  return (
    <Screen
      top={
        <PageHeader
          title={t("wardrobe.title")}
          subtitle={t("wardrobe.intro")}
          back="/profil"
          backLabel={t("nav.profile")}
          actions={
            <Chip tone="nghe" data-testid="wardrobe-coins">
              <CoinIcon size={15} />
              <span className="tabular-nums">{t("rewards.coins", { n: data.coins })}</span>
            </Chip>
          }
        />
      }
    >
      {/* Le personnage : la seule chose qui bouge sur cet écran. */}
      <div className="flex justify-center pb-2" data-testid="wardrobe-avatar">
        {loaded ? <AvatarArt outfit={outfit} size={168} /> : <Skeleton className="size-[168px]" />}
      </div>

      {notice && (
        <p className="mb-2 flex items-center gap-2 self-center rounded-chip bg-surface-son-mai px-4 py-2 text-sm text-son-mai" role="status" data-testid="wardrobe-notice">
          <Icon name="info" size={16} />
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-6 pt-3">
        {WARDROBE_SLOTS.map((slot) => (
          <SlotSection key={slot} slot={slot} data={data} outfit={outfit} onWear={wear} onBuy={buy} />
        ))}
      </div>
    </Screen>
  );
}

function SlotSection({ slot, data, outfit, onWear, onBuy }: {
  slot: WardrobeSlot;
  data: RewardsData;
  outfit: Outfit;
  onWear: (slot: WardrobeSlot, itemId: string | null) => Promise<void>;
  onBuy: (item: WardrobeItem) => Promise<void>;
}) {
  const ctx = rewardsContext(data);
  const items = itemsOfSlot(slot);
  const worn = outfit[slot] ?? null;
  return (
    <section aria-labelledby={`slot-${slot}`} data-testid="wardrobe-slot" data-slot={slot}>
      <SectionTitle id={`slot-${slot}`} className="mb-2">{t(`wardrobe.slot.${slot}` as MessageKey)}</SectionTitle>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {/* « Rien » : une vraie option pour les emplacements facultatifs, pas un vide. */}
        {OPTIONAL_SLOTS.has(slot) && (
          <li>
            <button
              type="button"
              onClick={() => void onWear(slot, null)}
              aria-pressed={worn === null}
              data-testid="wardrobe-none"
              className={`flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-1 rounded-card border px-3 py-3 text-sm transition-transform motion-safe:active:scale-[.98] ${
                worn === null ? "border-ngoc bg-ngoc-sang font-semibold text-ngoc" : "border-line bg-surface text-phu-sa"
              }`}
            >
              <Icon name="minus" size={20} />
              {t("wardrobe.none")}
            </button>
          </li>
        )}
        {items.map((item) => (
          <li key={item.id}>
            <ItemTile item={item} state={itemState(item, ctx)} worn={worn === item.id} coins={data.coins} onWear={() => void onWear(slot, item.id)} onBuy={() => void onBuy(item)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Ce qu'il faut pour débloquer une pièce, en une phrase — jamais un cadenas seul. */
function requirement(item: WardrobeItem): string {
  switch (item.unlock.kind) {
    case "level":
      return t("wardrobe.locked.level", { n: item.unlock.level });
    case "trophy": {
      const trophy = trophyByCode(item.unlock.code);
      return trophy
        ? t("wardrobe.locked.trophy", { name: t("trophy.earned", { name: t(`trophy.${trophy.family}.name` as MessageKey), tier: t(`trophy.tier.${trophy.tier}` as MessageKey) }) })
        : "";
    }
    case "collection":
      return t("wardrobe.locked.collection", { name: t(`collection.set.${item.unlock.set}.name` as MessageKey) });
    default:
      return "";
  }
}

function ItemTile({ item, state, worn, coins, onWear, onBuy }: {
  item: WardrobeItem;
  state: ItemState;
  worn: boolean;
  coins: number;
  onWear: () => void;
  onBuy: () => void;
}) {
  const name = t(`wardrobe.item.${item.id}.name` as MessageKey);
  const price = itemPrice(item);
  const locked = state === "locked";
  const tone = worn
    ? "border-ngoc bg-ngoc-sang"
    : state === "buyable"
      ? "border-nghe/40 bg-surface-nghe"
      : locked
        ? "border-line bg-surface-2"
        : "border-line bg-surface";
  return (
    <div
      className={`flex min-h-[5.5rem] flex-col items-center gap-1 rounded-card border px-2 py-2.5 text-center ${tone}`}
      data-testid="wardrobe-item"
      data-item={item.id}
      data-state={worn ? "worn" : state}
    >
      <div className={locked ? "opacity-35" : undefined}>
        <WardrobePreview slot={item.slot} itemId={item.id} size={52} />
      </div>
      <p className={`text-sm leading-tight ${locked ? "text-phu-sa" : "font-medium"}`}>{name}</p>
      {worn && (
        <span className="flex items-center gap-1 text-sm font-semibold text-ngoc">
          <Icon name="check" size={14} strokeWidth={3} />
          {t("wardrobe.worn")}
        </span>
      )}
      {!worn && state === "owned" && (
        <button type="button" onClick={onWear} aria-label={t("wardrobe.wear", { name })} className="min-h-11 text-sm font-semibold text-ngoc underline-offset-4 hover:underline">
          {t("wardrobe.put")}
        </button>
      )}
      {state === "buyable" && price !== null && (
        <button
          type="button"
          onClick={onBuy}
          aria-label={t("wardrobe.buy.label", { name, n: price })}
          data-testid="wardrobe-buy"
          className={`flex min-h-11 items-center gap-1 rounded-chip px-3 text-sm font-semibold transition-transform motion-safe:active:scale-[.98] ${
            coins >= price ? "bg-nghe text-muc" : "bg-phu-sa/15 text-phu-sa"
          }`}
        >
          <CoinIcon size={14} />
          {t("wardrobe.buy", { n: price })}
        </button>
      )}
      {locked && <p className="text-sm text-phu-sa text-balance">{requirement(item)}</p>}
    </div>
  );
}
