import {
  AMBIANCE_LIST,
  itemsOfSceneSlot,
  OPTIONAL_SCENE_SLOTS,
  sanitizeScene,
  SCENE_SLOTS,
  sceneFilled,
  sceneItemPrice,
  sceneItemState,
  type Scene,
  type SceneItem,
  type SceneSlot,
} from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, Icon, PageHeader, SectionTitle, Skeleton, staggerStyle } from "../design/index.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { CoinIcon } from "../rewards/RewardArt.tsx";
import { chooseAmbiance, placeSceneItem, sceneContextOf, shopOwned, useRewards } from "../rewards/store.ts";
import { AmbianceSwatch } from "../shop/AmbianceSwatch.tsx";
import { SceneArt, ScenePreview } from "./SceneArt.tsx";

/**
 * « Ma rive » (contrat phase24 §2) : la scène en grand, puis les huit emplacements.
 *
 * Même dessin que l'atelier du personnage, et pour la même raison : **une vitrine, pas une grille
 * de cadenas**. Une pièce qu'on n'a pas dit ce qu'il faut pour l'avoir — un niveau, un trophée,
 * une collection, ou un prix en boutique — plutôt que d'afficher un verrou muet.
 *
 * L'ambiance de l'interface est ici aussi : c'est le même geste que poser un ciel, et il n'avait
 * pas de meilleur endroit.
 */

export default function ScenePage() {
  const { data, loaded, load } = useRewards();
  const [open, setOpen] = useState<SceneSlot | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const ctx = sceneContextOf(data);
  const scene: Scene = sanitizeScene(data.scene, ctx);
  const owned = shopOwned(data);

  return (
    <Screen top={<PageHeader title={t("scene.title")} subtitle={t("scene.subtitle")} back="/profil" backLabel={t("common.back")} />}>
      {/* La rive porte l'écran : elle arrive en pleine largeur, à ratio fixe (rien ne se décale). */}
      <div className="mb-3" data-testid="scene-view">
        {loaded ? <SceneArt scene={scene} /> : <Skeleton className="aspect-[12/7] w-full" rounded="card" />}
      </div>
      <p className="pb-5 text-sm text-phu-sa" data-testid="scene-filled">
        {t("scene.filled", { n: sceneFilled(scene), total: SCENE_SLOTS.length })}
      </p>

      <ul className="flex flex-col gap-2.5" data-testid="scene-slots">
        {SCENE_SLOTS.map((slot, index) => (
          <li key={slot} style={staggerStyle(index)} className="motion-safe:parlo-enter">
            <SlotRow
              slot={slot}
              scene={scene}
              open={open === slot}
              onToggle={() => setOpen(open === slot ? null : slot)}
              state={(item) => sceneItemState(item, ctx)}
              onPlace={(itemId) => void placeSceneItem(slot, itemId)}
            />
          </li>
        ))}
      </ul>

      {/* L'ambiance : le même geste, à l'échelle de l'application. */}
      <section aria-labelledby="scene-ambiance" className="mt-7">
        <SectionTitle id="scene-ambiance" tone="strong" icon="settings" className="pb-2">
          {t("ambiance.title")}
        </SectionTitle>
        <Card className="flex flex-col gap-3">
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-testid="scene-ambiances">
            {AMBIANCE_LIST.map((item) => {
              const has = owned.ambiances.has(item.id);
              const worn = data.ambiance === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!has}
                    onClick={() => void chooseAmbiance(item.id)}
                    data-testid="scene-ambiance"
                    data-id={item.id}
                    data-worn={worn || undefined}
                    className={`flex w-full flex-col items-center gap-1.5 rounded-card border p-2 text-center transition-[border-color,transform] motion-safe:active:scale-[.98] ${
                      worn ? "border-2 border-ngoc bg-ngoc-sang/40" : has ? "border-line bg-surface" : "border-line opacity-60"
                    }`}
                  >
                    <AmbianceSwatch id={item.id} size={56} />
                    <span className="text-sm leading-snug font-medium">{t(`ambiance.${item.id}.name` as MessageKey)}</span>
                    {/* Le mot, jamais la couleur seule : une pastille ne dit pas « portée ». */}
                    <span className="min-h-[1.125rem] text-sm text-phu-sa">
                      {worn ? t("ambiance.worn") : has ? t("ambiance.wear") : requirement(item)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-phu-sa">{t("shop.ambiance.hint")}</p>
        </Card>
      </section>

      <Link to="/boutique/scene" className="mt-6 flex min-h-12 items-center gap-2 font-semibold text-ngoc" data-testid="scene-shop">
        <Icon name="star" size={20} />
        <span className="min-w-0 flex-1">{t("shop.open")}</span>
        <Icon name="chevronRight" size={18} className="text-phu-sa" />
      </Link>
    </Screen>
  );
}

/**
 * Ce qu'il faut pour obtenir une pièce : jamais un cadenas muet. Partagé par les décors **et** les
 * ambiances — une ambiance offerte par une collection n'a pas de prix, et l'annoncer « 0 xu »
 * laissait croire qu'elle était gratuite.
 */
function requirement(item: { unlock: SceneItem["unlock"] }): string {
  switch (item.unlock.kind) {
    case "level":
      return t("scene.locked.level", { n: item.unlock.level });
    case "trophy":
      return t("scene.locked.trophy");
    case "collection":
      return t("scene.locked.collection");
    case "world":
      return t("scene.locked.world");
    case "shop":
      return t("scene.buyIn", { n: item.unlock.price });
    case "start":
      return "";
  }
}

function SlotRow({ slot, scene, open, onToggle, state, onPlace }: {
  slot: SceneSlot;
  scene: Scene;
  open: boolean;
  onToggle: () => void;
  state: (item: SceneItem) => "owned" | "buyable" | "locked";
  onPlace: (itemId: string | null) => void;
}) {
  const items = itemsOfSceneSlot(slot);
  const current = scene[slot];
  const currentName = current ? t(`scene.item.${current}.name` as MessageKey) : t("scene.none");
  const ownedCount = items.filter((item) => state(item) === "owned").length;

  return (
    <Card tone={open ? "raised" : "plain"} className="flex flex-col gap-3" data-testid="scene-slot" data-slot={slot} data-open={open}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="-my-1 flex min-h-12 items-center gap-3 text-left">
        {current ? <ScenePreview slot={slot} itemId={current} size={44} /> : <span className="grid size-11 shrink-0 place-items-center rounded-card bg-surface-2 text-phu-sa"><Icon name="plus" size={20} /></span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-phu-sa">{t(`scene.slot.${slot}` as MessageKey)}</span>
          <span className="truncate font-medium">{currentName}</span>
        </span>
        <Chip tone="neutral">{ownedCount}/{items.length}</Chip>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={18} className="shrink-0 text-phu-sa" />
      </button>

      {open && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {/* « Rien ici » en premier pour les emplacements facultatifs : retirer est un choix. */}
          {OPTIONAL_SCENE_SLOTS.has(slot) && (
            <li>
              <button
                type="button"
                onClick={() => onPlace(null)}
                data-testid="scene-clear"
                className={`flex h-full w-full flex-col items-center gap-1 rounded-card border px-1 py-2 text-center ${
                  current === undefined ? "border-2 border-ngoc bg-ngoc-sang/40" : "border-line"
                }`}
              >
                <span className="grid size-11 place-items-center text-phu-sa"><Icon name="close" size={20} /></span>
                <span className="text-sm leading-snug">{t("scene.none")}</span>
              </button>
            </li>
          )}
          {items.map((item) => {
            const itemState = state(item);
            const chosen = current === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={itemState !== "owned"}
                  onClick={() => onPlace(item.id)}
                  data-testid="scene-item"
                  data-id={item.id}
                  data-state={itemState}
                  data-chosen={chosen || undefined}
                  className={`flex h-full w-full flex-col items-center gap-1 rounded-card border px-1 py-2 text-center transition-transform motion-safe:active:scale-[.98] ${
                    chosen ? "border-2 border-ngoc bg-ngoc-sang/40" : itemState === "owned" ? "border-line bg-surface" : "border-line opacity-65"
                  }`}
                >
                  <ScenePreview slot={slot} itemId={item.id} size={44} />
                  <span className="text-sm leading-snug font-medium">{t(`scene.item.${item.id}.name` as MessageKey)}</span>
                  {/* Ce qu'il faut pour l'avoir, écrit — la vitrine explique, elle ne barre pas. */}
                  <span className="flex min-h-[1.125rem] items-center gap-1 text-sm text-phu-sa">
                    {itemState === "buyable" && <CoinIcon size={13} />}
                    {itemState === "owned" ? "" : requirement(item)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && items.some((item) => sceneItemPrice(item) !== null) && (
        <Link to="/boutique/scene" className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ngoc">
          {t("shop.open")}
          <Icon name="chevronRight" size={16} />
        </Link>
      )}
    </Card>
  );
}
