import { completedSets, type CollectionSet, type Rarity } from "./collection.ts";

/**
 * Atelier du personnage (contrat phase9 §4) : six couches, et une pièce ne se débloque que par
 * **niveau**, **trophée**, **collection complète** ou **achat en xu**. Jamais par hasard, jamais
 * contre de l'argent réel.
 *
 * Le catalogue est ici (logique pure, testable) ; le dessin est dans la PWA
 * (`apps/web/src/profile/AvatarArt.tsx`) et les noms visibles dans l'i18n
 * (`wardrobe.item.<id>.name`) — rien de traduisible dans `core`.
 */

/** Ordre de rendu : du fond vers le cadre. */
export const WARDROBE_SLOTS = ["backdrop", "companion", "outfit", "hat", "accessory", "frame"] as const;
export type WardrobeSlot = (typeof WARDROBE_SLOTS)[number];

/** Emplacements qui acceptent « rien » : on ne force pas un chapeau sur la tête de quelqu'un. */
export const OPTIONAL_SLOTS: ReadonlySet<WardrobeSlot> = new Set<WardrobeSlot>(["companion", "hat", "accessory", "frame"]);

export type Unlock =
  /** Disponible dès le départ. */
  | { kind: "start" }
  | { kind: "level"; level: number }
  | { kind: "trophy"; code: string }
  | { kind: "collection"; set: CollectionSet }
  /** Achetable en xu dès qu'on en a assez. */
  | { kind: "shop"; price: number };

export interface WardrobeItem {
  id: string;
  slot: WardrobeSlot;
  rarity: Rarity;
  unlock: Unlock;
}

export const WARDROBE: readonly WardrobeItem[] = [
  // Fond — il y a toujours quelque chose derrière le personnage.
  { id: "nuoc", slot: "backdrop", rarity: "common", unlock: { kind: "start" } },
  { id: "song_chieu", slot: "backdrop", rarity: "common", unlock: { kind: "level", level: 2 } },
  { id: "cho_noi", slot: "backdrop", rarity: "rare", unlock: { kind: "level", level: 10 } },
  { id: "ruong", slot: "backdrop", rarity: "rare", unlock: { kind: "shop", price: 150 } },
  { id: "sao_dem", slot: "backdrop", rarity: "legendary", unlock: { kind: "trophy", code: "missions_t3" } },

  // Compagnon — à côté, jamais devant le visage.
  { id: "ca_vang", slot: "companion", rarity: "common", unlock: { kind: "level", level: 6 } },
  { id: "chim_se", slot: "companion", rarity: "rare", unlock: { kind: "collection", set: "cho" } },
  { id: "meo_muop", slot: "companion", rarity: "rare", unlock: { kind: "shop", price: 200 } },
  { id: "cho_con", slot: "companion", rarity: "legendary", unlock: { kind: "trophy", code: "perfect_t2" } },

  // Tenue — il y en a toujours une.
  { id: "ao_thun", slot: "outfit", rarity: "common", unlock: { kind: "start" } },
  { id: "ao_ba_ba", slot: "outfit", rarity: "common", unlock: { kind: "level", level: 4 } },
  { id: "ao_so_mi", slot: "outfit", rarity: "common", unlock: { kind: "shop", price: 120 } },
  { id: "ao_dai", slot: "outfit", rarity: "rare", unlock: { kind: "level", level: 12 } },
  { id: "ao_lan", slot: "outfit", rarity: "legendary", unlock: { kind: "trophy", code: "games_t2" } },

  // Chapeau
  { id: "non_la", slot: "hat", rarity: "common", unlock: { kind: "level", level: 3 } },
  { id: "mu_luoi_trai", slot: "hat", rarity: "common", unlock: { kind: "shop", price: 90 } },
  { id: "vong_sen", slot: "hat", rarity: "rare", unlock: { kind: "collection", set: "song" } },
  { id: "khan_dong", slot: "hat", rarity: "legendary", unlock: { kind: "level", level: 18 } },

  // Accessoire
  { id: "kinh", slot: "accessory", rarity: "common", unlock: { kind: "shop", price: 70 } },
  { id: "khan_ran", slot: "accessory", rarity: "common", unlock: { kind: "level", level: 8 } },
  { id: "tai_nghe", slot: "accessory", rarity: "rare", unlock: { kind: "trophy", code: "sessions_t2" } },
  { id: "hoa_mai", slot: "accessory", rarity: "rare", unlock: { kind: "collection", set: "tet" } },

  // Cadre du médaillon
  { id: "vien_tre", slot: "frame", rarity: "common", unlock: { kind: "level", level: 7 } },
  { id: "vien_son_mai", slot: "frame", rarity: "rare", unlock: { kind: "shop", price: 250 } },
  { id: "vien_ngoc", slot: "frame", rarity: "rare", unlock: { kind: "collection", set: "bep" } },
  { id: "vien_vang", slot: "frame", rarity: "legendary", unlock: { kind: "trophy", code: "words_t3" } },
];

const BY_ID = new Map(WARDROBE.map((item) => [item.id, item]));
export const wardrobeItem = (id: string | undefined | null): WardrobeItem | null => (id ? (BY_ID.get(id) ?? null) : null);
export const itemsOfSlot = (slot: WardrobeSlot): WardrobeItem[] => WARDROBE.filter((item) => item.slot === slot);

/** Pièce offerte par une collection complète (contrat §2). */
export function collectionRewardItem(set: CollectionSet): WardrobeItem | null {
  return WARDROBE.find((item) => item.unlock.kind === "collection" && item.unlock.set === set) ?? null;
}

/** Tenue portée : un identifiant par emplacement, les emplacements facultatifs peuvent manquer. */
export type Outfit = Partial<Record<WardrobeSlot, string>>;

export const DEFAULT_OUTFIT: Outfit = { outfit: "ao_thun", backdrop: "nuoc" };

export interface WardrobeContext {
  level: number;
  trophies: ReadonlySet<string>;
  /** Collections terminées. */
  sets: ReadonlySet<CollectionSet>;
  /** Pièces achetées en xu. */
  purchased: ReadonlySet<string>;
}

export const emptyWardrobeContext = (): WardrobeContext => ({ level: 1, trophies: new Set(), sets: new Set(), purchased: new Set() });

/** Contexte de déblocage lu depuis l'état stocké (tolère des données anciennes ou tronquées). */
export function wardrobeContext(input: { level?: number; trophies?: Iterable<string>; collectibles?: Iterable<string>; purchased?: Iterable<string> }): WardrobeContext {
  return {
    level: Math.max(1, Math.floor(input.level ?? 1)),
    trophies: new Set(input.trophies ?? []),
    sets: new Set(completedSets(new Set(input.collectibles ?? []))),
    purchased: new Set(input.purchased ?? []),
  };
}

export type ItemState = "owned" | "buyable" | "locked";

export function itemState(item: WardrobeItem, ctx: WardrobeContext): ItemState {
  switch (item.unlock.kind) {
    case "start":
      return "owned";
    case "level":
      return ctx.level >= item.unlock.level ? "owned" : "locked";
    case "trophy":
      return ctx.trophies.has(item.unlock.code) ? "owned" : "locked";
    case "collection":
      return ctx.sets.has(item.unlock.set) ? "owned" : "locked";
    case "shop":
      return ctx.purchased.has(item.id) ? "owned" : "buyable";
  }
}

export const isOwned = (item: WardrobeItem, ctx: WardrobeContext): boolean => itemState(item, ctx) === "owned";

export function ownedItems(ctx: WardrobeContext): WardrobeItem[] {
  return WARDROBE.filter((item) => isOwned(item, ctx));
}

/** Prix d'une pièce, ou null si elle ne s'achète pas. */
export function itemPrice(item: WardrobeItem): number | null {
  return item.unlock.kind === "shop" ? item.unlock.price : null;
}

/**
 * Tenue valide : les pièces non possédées tombent, les emplacements obligatoires reprennent leur
 * valeur par défaut. Une pièce devenue indisponible ne doit jamais laisser un personnage à moitié
 * dessiné.
 */
export function sanitizeOutfit(outfit: Outfit | null | undefined, ctx: WardrobeContext): Outfit {
  const out: Outfit = {};
  for (const slot of WARDROBE_SLOTS) {
    const chosen = wardrobeItem(outfit?.[slot]);
    if (chosen && chosen.slot === slot && isOwned(chosen, ctx)) {
      out[slot] = chosen.id;
      continue;
    }
    if (OPTIONAL_SLOTS.has(slot)) continue;
    const fallback = wardrobeItem(DEFAULT_OUTFIT[slot]);
    if (fallback && isOwned(fallback, ctx)) out[slot] = fallback.id;
  }
  return out;
}

/** Pièces devenues disponibles entre deux états : ce que la file de félicitations annonce. */
export function newlyOwned(before: WardrobeContext, after: WardrobeContext): WardrobeItem[] {
  const had = new Set(ownedItems(before).map((item) => item.id));
  return ownedItems(after).filter((item) => !had.has(item.id));
}
