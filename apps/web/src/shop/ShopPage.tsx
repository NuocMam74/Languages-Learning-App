import {
  entriesOfSection,
  featuredEntries,
  isShopOwned,
  periodOf,
  remainingInSection,
  sceneItem,
  SHOP_SECTIONS,
  shopKey,
  shopState,
  wardrobeItem,
  type ShopEntry,
  type ShopOwned,
  type ShopSection,
} from "@parlo/core";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { Card, Chip, Icon, PageHeader, SectionTitle, Skeleton, staggerStyle } from "../design/index.ts";
import { plural, t, type MessageKey } from "../i18n/index.ts";
import { WardrobePreview } from "../profile/AvatarArt.tsx";
import { CoinIcon, CollectibleIcon } from "../rewards/RewardArt.tsx";
import { buyShopEntry, shopOwned, useRewards } from "../rewards/store.ts";
import { ScenePreview } from "../scene/SceneArt.tsx";
import { AmbianceSwatch } from "./AmbianceSwatch.tsx";

/**
 * La boutique (contrat phase24 §1).
 *
 * Ce qui s'achetait était **éparpillé** : une pièce à prix au milieu de l'atelier, visible
 * seulement en ouvrant le bon emplacement. Personne ne savait ce qu'il pouvait s'offrir, donc
 * personne n'avait de raison d'accumuler des xu.
 *
 * Ici tout est au même endroit, en quatre rayons, avec le solde en tête et un prix sur chaque
 * vignette. La **vitrine de la semaine** ouvre l'écran : c'est la seule chose qui change toute
 * seule, et c'est elle qui donne une raison de repasser lundi.
 *
 * Deux promesses répétées à l'écran, parce qu'elles nous engagent (spec §3, §14) : rien ne
 * s'achète en euros, et rien d'acheté n'ouvre une leçon.
 */

const isSection = (value: string | undefined): value is ShopSection => SHOP_SECTIONS.includes(value as ShopSection);

export default function ShopPage() {
  const params = useParams();
  const navigate = useNavigate();
  const section: ShopSection = isSection(params.section) ? params.section : "wardrobe";
  const { data, loaded, load } = useRewards();
  const [bought, setBought] = useState<string | null>(null);
  const [asking, setAsking] = useState<ShopEntry | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const week = useMemo(() => periodOf("weekly", new Date()).key, []);
  const owned = useMemo(() => shopOwned(data), [data]);
  const featured = useMemo(() => featuredEntries(week), [week]);

  const buy = async (entry: ShopEntry) => {
    setAsking(null);
    const result = await buyShopEntry(shopKey(entry));
    if (result === "bought") setBought(shopKey(entry));
  };

  return (
    <Screen top={<PageHeader title={t("shop.title")} subtitle={t("shop.subtitle")} back="/profil" backLabel={t("common.back")} />}>
      {/* Le solde porte l'écran : sans lui, un prix ne veut rien dire. */}
      <Card tone="feature" className="mb-5 flex flex-col gap-2" data-testid="shop-balance">
        <div className="flex items-center gap-3">
          <CoinIcon size={40} />
          <p className="flex min-w-0 flex-1 flex-col">
            {/* `text-2xl` et pas `text-vi` : à quatre chiffres, la taille d'exercice coupait
                « 1450 xu » en deux lignes sur un écran de 360 px. */}
            <span className="truncate font-serif text-2xl font-semibold text-ngoc tabular-nums">
              {loaded ? t("shop.balance", { n: data.coins }) : <Skeleton className="inline-block h-6 w-24 align-middle" />}
            </span>
            <span className="text-sm text-phu-sa">{t("shop.balance.label")}</span>
          </p>
        </div>
        <Link to="/missions" className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc">
          {t("shop.earn.cta")}
          <Icon name="chevronRight" size={18} />
        </Link>
      </Card>

      {/* La vitrine : elle change chaque lundi, c'est la raison de revenir. */}
      <section aria-labelledby="shop-featured" className="mb-6">
        <SectionTitle id="shop-featured" tone="banner" icon="star" className="mb-3">
          {t("shop.featured")}
        </SectionTitle>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" data-testid="shop-featured">
          {featured.map((item, index) => (
            <li key={shopKey(item.entry)} style={staggerStyle(index)} className="motion-safe:parlo-enter">
              <EntryCard
                entry={item.entry}
                price={item.price}
                fullPrice={item.fullPrice}
                owned={owned}
                coins={data.coins}
                bought={bought === shopKey(item.entry)}
                onBuy={() => setAsking({ ...item.entry, price: item.price })}
              />
            </li>
          ))}
        </ul>
        <p className="pt-2 text-sm text-phu-sa">{t("shop.featured.hint")}</p>
      </section>

      {/* Les rayons. Un onglet par rayon : quatre grilles empilées feraient un catalogue illisible. */}
      <div role="tablist" aria-label={t("shop.title")} className="mb-4 grid grid-cols-4 gap-1 rounded-card bg-surface-2 p-1">
        {SHOP_SECTIONS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === section}
            data-testid="shop-tab"
            data-section={key}
            onClick={() => navigate(key === "wardrobe" ? "/boutique" : `/boutique/${key}`, { replace: true })}
            className={`min-h-11 rounded-chip px-1 text-sm font-semibold transition-[background-color,color] ${
              key === section ? "bg-surface text-ngoc shadow-card" : "text-phu-sa"
            }`}
          >
            {t(`shop.section.${key}` as MessageKey)}
          </button>
        ))}
      </div>

      <SectionRow section={section} owned={owned} />

      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" data-testid="shop-grid" data-section={section}>
        {entriesOfSection(section).map((entry, index) => (
          <li key={shopKey(entry)} style={staggerStyle(index)} className="motion-safe:parlo-enter">
            <EntryCard
              entry={entry}
              price={entry.price}
              owned={owned}
              coins={data.coins}
              bought={bought === shopKey(entry)}
              onBuy={() => setAsking(entry)}
            />
          </li>
        ))}
      </ul>

      {section === "collectible" && <p className="pt-3 text-sm text-phu-sa">{t("shop.collectible.hint")}</p>}
      {section === "ambiance" && <p className="pt-3 text-sm text-phu-sa">{t("shop.ambiance.hint")}</p>}

      <p className="mt-6 flex items-start gap-2 text-sm text-phu-sa">
        <Icon name="info" size={16} className="mt-0.5 shrink-0" />
        {t("shop.noRealMoney")}
      </p>

      {asking && (
        <ConfirmPurchase
          entry={asking}
          coins={data.coins}
          onCancel={() => setAsking(null)}
          onConfirm={() => void buy(asking)}
        />
      )}
    </Screen>
  );
}

/** Ce qui reste à trouver dans le rayon : un chiffre, plutôt qu'une grille de vignettes grises. */
function SectionRow({ section, owned }: { section: ShopSection; owned: ShopOwned }) {
  const left = remainingInSection(section, owned);
  return (
    <p className="pb-3 text-sm text-phu-sa" data-testid="shop-remaining" data-remaining={left}>
      {left === 0 ? t("shop.section.complete") : plural("shop.section.remaining.one", "shop.section.remaining", left)}
    </p>
  );
}

/** Le nom visible d'une entrée : chaque rayon a son espace de clés d'i18n. */
export function entryName(entry: ShopEntry): string {
  switch (entry.section) {
    case "wardrobe":
      return t(`wardrobe.item.${entry.id}.name` as MessageKey);
    case "scene":
      return t(`scene.item.${entry.id}.name` as MessageKey);
    case "collectible":
      return t(`collection.item.${entry.id}.name` as MessageKey);
    case "ambiance":
      return t(`ambiance.${entry.id}.name` as MessageKey);
  }
}

/** La vignette d'une entrée : le dessin réel de la pièce, jamais une icône générique. */
function EntryArt({ entry }: { entry: ShopEntry }) {
  switch (entry.section) {
    case "wardrobe": {
      const item = wardrobeItem(entry.id);
      return item ? <WardrobePreview slot={item.slot} itemId={item.id} size={64} /> : null;
    }
    case "scene": {
      const item = sceneItem(entry.id);
      return item ? <ScenePreview slot={item.slot} itemId={item.id} size={64} /> : null;
    }
    case "collectible":
      // Toujours allumé en boutique : on vend l'objet, on ne montre pas une case vide.
      return <CollectibleIcon id={entry.id} owned rarity={entry.rarity} size={64} />;
    case "ambiance":
      return <AmbianceSwatch id={entry.id} size={64} />;
  }
}

function EntryCard({ entry, price, fullPrice, owned, coins, bought, onBuy }: {
  entry: ShopEntry;
  price: number;
  fullPrice?: number;
  owned: ShopOwned;
  coins: number;
  bought: boolean;
  onBuy: () => void;
}) {
  const state = isShopOwned(entry, owned) || bought ? "owned" : shopState({ ...entry, price }, owned, coins);
  const discounted = fullPrice !== undefined && fullPrice > price;

  return (
    <Card
      tone={state === "owned" ? "quiet" : "plain"}
      className="flex h-full flex-col items-center gap-2 px-3 py-3 text-center"
      data-testid="shop-entry"
      data-key={shopKey(entry)}
      data-state={state}
    >
      <EntryArt entry={entry} />
      <p className="min-w-0 text-sm leading-snug font-medium">{entryName(entry)}</p>

      {state === "owned" ? (
        <p className="mt-auto flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ngoc">
          <Icon name="check" size={16} strokeWidth={3} />
          {t("shop.owned")}
        </p>
      ) : (
        <button
          type="button"
          onClick={onBuy}
          disabled={state === "tooExpensive"}
          data-testid="shop-buy"
          className={`mt-auto flex min-h-11 w-full items-center justify-center gap-1.5 rounded-chip px-2 text-sm font-semibold transition-transform motion-safe:active:scale-[.98] ${
            state === "tooExpensive" ? "bg-phu-sa/10 text-phu-sa" : "bg-ngoc text-nuoc"
          }`}
        >
          <CoinIcon size={16} />
          <span className="tabular-nums">{price}</span>
          {/* Le prix barré n'est pas décoratif : il dit de combien la vitrine remise. */}
          {discounted && <span className="text-sm line-through opacity-60 tabular-nums">{fullPrice}</span>}
        </button>
      )}
      {/* Ligne toujours là : le manque s'affiche sans faire grandir la vignette (CLS). */}
      <p className="min-h-[1.125rem] text-sm text-phu-sa">
        {state === "tooExpensive" ? t("shop.tooExpensive", { n: price - coins }) : ""}
      </p>
    </Card>
  );
}

/**
 * Confirmation d'achat. Elle n'est pas là pour freiner : elle dit **ce qu'il restera après**, la
 * seule information qu'on n'a pas en regardant un prix.
 */
function ConfirmPurchase({ entry, coins, onCancel, onConfirm }: {
  entry: ShopEntry;
  coins: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-muc/45 px-5 backdrop-blur-[2px]" role="presentation" onClick={onCancel}>
      <Card
        tone="raised"
        role="dialog"
        aria-modal
        aria-label={t("shop.confirm.title", { name: entryName(entry) })}
        className="flex w-full max-w-[22rem] flex-col items-center gap-3 text-center"
        data-testid="shop-confirm"
      >
        <EntryArt entry={entry} />
        <p className="font-serif text-lg">{t("shop.confirm.title", { name: entryName(entry) })}</p>
        <p className="text-sm text-phu-sa">{t("shop.confirm.price", { n: entry.price, left: coins - entry.price })}</p>
        <Button onClick={onConfirm} data-testid="shop-confirm-yes">{t("shop.confirm.yes")}</Button>
        <button type="button" onClick={onCancel} className="min-h-11 font-semibold text-phu-sa">
          {t("shop.confirm.no")}
        </button>
      </Card>
    </div>
  );
}

/** Jeton de rareté, réutilisé par la rive et l'atelier. */
export function RarityChip({ rarity }: { rarity: "common" | "rare" | "legendary" }) {
  return (
    <Chip tone={rarity === "legendary" ? "nghe" : rarity === "rare" ? "ngoc" : "neutral"}>
      {t(`shop.rarity.${rarity}` as MessageKey)}
    </Chip>
  );
}
