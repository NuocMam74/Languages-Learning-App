import { seededRandom, shuffle } from "../engine.ts";
import { AMBIANCE_LIST, ambiancePrice, type AmbianceId } from "./ambiance.ts";
import { COLLECTIBLES, type Rarity } from "./collection.ts";
import { SCENE, sceneItemPrice, type SceneSlot } from "./scene.ts";
import { itemPrice, WARDROBE, type WardrobeSlot } from "./wardrobe.ts";

/**
 * La boutique (contrat phase24 §1).
 *
 * Il y avait déjà des pièces à acheter : elles étaient **éparpillées** dans l'atelier, au milieu de
 * celles qu'on débloque autrement, et on ne les voyait qu'en ouvrant l'emplacement qui les
 * contenait. Autant dire qu'on ne savait jamais ce qu'on pouvait s'offrir, ni pourquoi accumuler
 * des xu.
 *
 * La boutique rassemble tout ce qui s'achète en un seul endroit, en quatre rayons — accessoires du
 * personnage, décor de la rive, objets de collection, ambiances — avec un prix visible et un solde
 * en tête. Deux règles héritées ne bougent pas : **rien ne s'achète en euros**, et **rien
 * d'acheté n'ouvre une leçon** (spec §3, §14).
 *
 * Ce qui est nouveau et qui compte : les **objets de collection s'achètent à l'unité**. Jusqu'ici
 * ils ne sortaient que des coffres, donc terminer une collection était subi. On peut maintenant
 * viser précisément celui qui manque — plus cher qu'un coffre, ce qui garde au coffre sa valeur.
 */

export const SHOP_SECTIONS = ["wardrobe", "scene", "collectible", "ambiance"] as const;
export type ShopSection = (typeof SHOP_SECTIONS)[number];

/**
 * Prix d'un objet de collection acheté à l'unité. Nettement au-dessus de ce qu'un coffre coûte en
 * effort : acheter est un raccourci pour finir une collection, pas la façon normale de la remplir.
 */
export const COLLECTIBLE_PRICE: Record<Rarity, number> = { common: 80, rare: 200, legendary: 500 };

export type ShopEntry =
  | { section: "wardrobe"; id: string; price: number; rarity: Rarity; slot: WardrobeSlot }
  | { section: "scene"; id: string; price: number; rarity: Rarity; slot: SceneSlot }
  | { section: "collectible"; id: string; price: number; rarity: Rarity; set: string }
  | { section: "ambiance"; id: AmbianceId; price: number; rarity: Rarity };

/** Catalogue complet, dans un ordre stable : rayon par rayon, du moins cher au plus cher. */
export const SHOP: readonly ShopEntry[] = [
  ...WARDROBE.flatMap((item): ShopEntry[] => {
    const price = itemPrice(item);
    return price === null ? [] : [{ section: "wardrobe", id: item.id, price, rarity: item.rarity, slot: item.slot }];
  }),
  ...SCENE.flatMap((item): ShopEntry[] => {
    const price = sceneItemPrice(item);
    return price === null ? [] : [{ section: "scene", id: item.id, price, rarity: item.rarity, slot: item.slot }];
  }),
  ...COLLECTIBLES.map((item): ShopEntry => ({
    section: "collectible",
    id: item.id,
    price: COLLECTIBLE_PRICE[item.rarity],
    rarity: item.rarity,
    set: item.set,
  })),
  ...AMBIANCE_LIST.flatMap((item): ShopEntry[] => {
    const price = ambiancePrice(item);
    return price === null ? [] : [{ section: "ambiance", id: item.id, price, rarity: "rare" }];
  }),
].sort((a, b) => (a.section === b.section ? a.price - b.price : SHOP_SECTIONS.indexOf(a.section) - SHOP_SECTIONS.indexOf(b.section)));

/** Clé d'une entrée : le rayon **et** l'identifiant — un même id peut exister dans deux rayons. */
export const shopKey = (entry: Pick<ShopEntry, "section" | "id">): string => `${entry.section}:${entry.id}`;

const BY_KEY = new Map(SHOP.map((entry) => [shopKey(entry), entry]));
export const shopEntry = (key: string): ShopEntry | null => BY_KEY.get(key) ?? null;

export const entriesOfSection = (section: ShopSection): ShopEntry[] => SHOP.filter((entry) => entry.section === section);

/**
 * Ce que l'apprenant possède déjà, tous rayons confondus. L'appelant le construit depuis son état ;
 * la boutique ne lit jamais la base.
 */
export interface ShopOwned {
  /** Pièces d'atelier possédées (achetées **ou** débloquées autrement). */
  wardrobe: ReadonlySet<string>;
  scene: ReadonlySet<string>;
  collectibles: ReadonlySet<string>;
  ambiances: ReadonlySet<string>;
}

export const emptyShopOwned = (): ShopOwned => ({
  wardrobe: new Set(),
  scene: new Set(),
  collectibles: new Set(),
  ambiances: new Set(),
});

export function isShopOwned(entry: ShopEntry, owned: ShopOwned): boolean {
  switch (entry.section) {
    case "wardrobe":
      return owned.wardrobe.has(entry.id);
    case "scene":
      return owned.scene.has(entry.id);
    case "collectible":
      return owned.collectibles.has(entry.id);
    case "ambiance":
      return owned.ambiances.has(entry.id);
  }
}

export type ShopState = "owned" | "affordable" | "tooExpensive";

export function shopState(entry: ShopEntry, owned: ShopOwned, coins: number): ShopState {
  if (isShopOwned(entry, owned)) return "owned";
  return coins >= entry.price ? "affordable" : "tooExpensive";
}

/**
 * La sélection de la semaine : six entrées mises en avant, **choisies par la semaine ISO**.
 *
 * C'est la seule chose de la boutique qui change toute seule, et c'est volontaire : une vitrine
 * figée n'a aucune raison d'être rouverte. Le tirage est semé par la clé de semaine, donc identique
 * sur deux appareils et hors ligne — et la remise est fixe, jamais un hasard qui pousse à insister.
 */
export const FEATURED_COUNT = 6;
export const FEATURED_DISCOUNT = 0.2;

export interface FeaturedEntry {
  entry: ShopEntry;
  /** Prix remisé, arrondi à la dizaine inférieure : un prix se lit d'un coup d'œil. */
  price: number;
  /** Prix d'origine, barré à l'écran. */
  fullPrice: number;
}

export function featuredEntries(weekKey: string, count = FEATURED_COUNT): FeaturedEntry[] {
  const rand = seededRandom(`shop:${weekKey}`);
  // Un rayon ne monopolise pas la vitrine : on tire dans chacun, puis on complète.
  const perSection = SHOP_SECTIONS.flatMap((section) => shuffle(entriesOfSection(section), rand).slice(0, 2));
  const picked = shuffle(perSection, rand).slice(0, count);
  return picked.map((entry) => ({
    entry,
    fullPrice: entry.price,
    price: Math.max(10, Math.floor((entry.price * (1 - FEATURED_DISCOUNT)) / 10) * 10),
  }));
}

/** Prix effectif d'une entrée cette semaine : le prix remisé si elle est en vitrine. */
export function priceThisWeek(entry: ShopEntry, weekKey: string): number {
  const featured = featuredEntries(weekKey).find((f) => shopKey(f.entry) === shopKey(entry));
  return featured ? featured.price : entry.price;
}

/** Ce qu'il reste à acheter dans un rayon : la boutique le dit, plutôt que d'afficher une grille grise. */
export function remainingInSection(section: ShopSection, owned: ShopOwned): number {
  return entriesOfSection(section).filter((entry) => !isShopOwned(entry, owned)).length;
}
