import { seededRandom, shuffle } from "../engine.ts";

/**
 * Objets à collecter (contrat phase9 §2) : quatre collections du Sud, cinq objets chacune.
 *
 * Un objet sort d'un **coffre**, et un coffre est **déterministe** : le premier objet non possédé
 * d'un tirage semé par la récompense qui l'a donné. Donc jamais de doublon, jamais de déception,
 * et le même appareil hors ligne donne le même résultat qu'en ligne. Ce n'est pas un jeu d'argent :
 * rien ne s'achète en euros, rien ne se perd.
 */

export const COLLECTION_SETS = ["cho", "song", "tet", "bep"] as const;
export type CollectionSet = (typeof COLLECTION_SETS)[number];

export type Rarity = "common" | "rare" | "legendary";

export interface Collectible {
  id: string;
  set: CollectionSet;
  rarity: Rarity;
}

/**
 * Le catalogue. Les noms visibles viennent de l'i18n (`collection.item.<id>.name`) : rien de
 * traduisible ici, comme partout dans `core`.
 */
export const COLLECTIBLES: readonly Collectible[] = [
  // Chợ — le marché flottant
  { id: "chum_nuoc", set: "cho", rarity: "common" },
  { id: "gio_tre", set: "cho", rarity: "common" },
  { id: "can_can", set: "cho", rarity: "common" },
  { id: "non_la", set: "cho", rarity: "rare" },
  { id: "ghe_cho", set: "cho", rarity: "legendary" },
  // Sông — le fleuve
  { id: "mai_ghe", set: "song", rarity: "common" },
  { id: "luoi_ca", set: "song", rarity: "common" },
  { id: "den_bao", set: "song", rarity: "common" },
  { id: "hoa_sen", set: "song", rarity: "rare" },
  { id: "cau_tre", set: "song", rarity: "legendary" },
  // Tết — la fête
  { id: "bao_do", set: "tet", rarity: "common" },
  { id: "long_den", set: "tet", rarity: "common" },
  { id: "mai_vang", set: "tet", rarity: "common" },
  { id: "trong_com", set: "tet", rarity: "rare" },
  { id: "mua_lan", set: "tet", rarity: "legendary" },
  // Bếp — la cuisine
  { id: "to_pho", set: "bep", rarity: "common" },
  { id: "am_tra", set: "bep", rarity: "common" },
  { id: "ca_phe_phin", set: "bep", rarity: "common" },
  { id: "banh_mi", set: "bep", rarity: "rare" },
  { id: "noi_dat", set: "bep", rarity: "legendary" },
];

const BY_ID = new Map(COLLECTIBLES.map((item) => [item.id, item]));
export const collectibleById = (id: string): Collectible | null => BY_ID.get(id) ?? null;

export const collectiblesOf = (set: CollectionSet): Collectible[] => COLLECTIBLES.filter((item) => item.set === set);

/** Taille d'une collection (identique pour les quatre, mais lue, jamais supposée). */
export const setSize = (set: CollectionSet): number => collectiblesOf(set).length;

/**
 * Niveau d'un coffre. Un coffre plus riche ne donne pas « plus de chances » : il élargit les
 * raretés accessibles, c'est tout.
 */
export type ChestTier = "wood" | "lacquer" | "jade";

const ALLOWED: Record<ChestTier, readonly Rarity[]> = {
  wood: ["common"],
  lacquer: ["common", "rare"],
  jade: ["common", "rare", "legendary"],
};

/** Xu accompagnant un coffre, même quand la collection est déjà complète. */
export const CHEST_COINS: Record<ChestTier, number> = { wood: 10, lacquer: 25, jade: 60 };

/**
 * Objet sorti d'un coffre : le premier non possédé du tirage semé par `seed`, en cherchant d'abord
 * les raretés du coffre, puis — plutôt que de rendre un coffre vide — les autres.
 * `null` seulement quand tout est déjà collectionné.
 */
export function openChest(seed: string, owned: ReadonlySet<string>, tier: ChestTier = "wood"): Collectible | null {
  const rand = seededRandom(`chest:${tier}:${seed}`);
  const pool = shuffle(COLLECTIBLES, rand);
  const allowed = new Set(ALLOWED[tier]);
  return pool.find((item) => !owned.has(item.id) && allowed.has(item.rarity)) ?? pool.find((item) => !owned.has(item.id)) ?? null;
}

/** Collections complètes parmi les objets possédés. */
export function completedSets(owned: ReadonlySet<string>): CollectionSet[] {
  return COLLECTION_SETS.filter((set) => collectiblesOf(set).every((item) => owned.has(item.id)));
}

/** Xu versés quand une collection se termine (la pièce d'atelier, elle, vient de `wardrobe.ts`). */
export const SET_COMPLETION_COINS = 120;

export function setProgress(set: CollectionSet, owned: ReadonlySet<string>): { owned: number; total: number } {
  const items = collectiblesOf(set);
  return { owned: items.filter((item) => owned.has(item.id)).length, total: items.length };
}
