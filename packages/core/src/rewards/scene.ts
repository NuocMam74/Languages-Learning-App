import type { CollectionSet } from "./collection.ts";
import type { Rarity } from "./collection.ts";
import type { Unlock } from "./wardrobe.ts";

/**
 * « Ma rive » — le lieu qu'on aménage (contrat phase24 §2).
 *
 * L'atelier habille **une personne**. Il manquait un endroit à soi : un bout de berge du delta que
 * l'on installe petit à petit, et où les achats se voient. C'est la différence entre porter un
 * chapeau et habiter quelque part — la seconde donne envie de revenir regarder.
 *
 * Mêmes règles que l'atelier, et pour les mêmes raisons : huit emplacements, une pièce ne se
 * débloque que par **niveau**, **trophée**, **collection**, **monde** ou **achat en xu**, jamais par
 * hasard et jamais contre de l'argent réel (spec §14, contrat phase9 §2). Le catalogue est ici,
 * le dessin dans la PWA, les noms dans l'i18n.
 *
 * Aucun élément de décor n'ouvre quoi que ce soit : la rive est un plaisir, pas une progression
 * parallèle (spec §3, zéro blocage).
 */

/** Ordre de rendu : du ciel vers le premier plan. */
export const SCENE_SLOTS = ["sky", "water", "bank", "house", "boat", "plant", "light", "animal"] as const;
export type SceneSlot = (typeof SCENE_SLOTS)[number];

/**
 * Emplacements qui acceptent « rien ». Le ciel, l'eau et la berge sont toujours là — une rive sans
 * eau n'est pas une rive ; le reste s'ajoute.
 */
export const OPTIONAL_SCENE_SLOTS: ReadonlySet<SceneSlot> = new Set<SceneSlot>(["house", "boat", "plant", "light", "animal"]);

export interface SceneItem {
  id: string;
  slot: SceneSlot;
  rarity: Rarity;
  unlock: Unlock;
}

/**
 * Le catalogue. Les prix montent avec la place que la pièce prend à l'écran : un ciel change toute
 * la scène, une libellule se pose dans un coin.
 */
export const SCENE: readonly SceneItem[] = [
  // Ciel — il y en a toujours un.
  { id: "troi_trong", slot: "sky", rarity: "common", unlock: { kind: "start" } },
  { id: "binh_minh", slot: "sky", rarity: "common", unlock: { kind: "level", level: 3 } },
  { id: "hoang_hon", slot: "sky", rarity: "rare", unlock: { kind: "shop", price: 220 } },
  { id: "troi_sao", slot: "sky", rarity: "rare", unlock: { kind: "shop", price: 260 } },
  { id: "mua_giong", slot: "sky", rarity: "legendary", unlock: { kind: "trophy", code: "sessions_t3" } },

  // Eau — elle non plus ne manque jamais.
  { id: "nuoc_lang", slot: "water", rarity: "common", unlock: { kind: "start" } },
  { id: "nuoc_lon", slot: "water", rarity: "common", unlock: { kind: "level", level: 5 } },
  { id: "luc_binh", slot: "water", rarity: "rare", unlock: { kind: "shop", price: 180 } },
  { id: "sen_no", slot: "water", rarity: "legendary", unlock: { kind: "collection", set: "song" } },

  // Berge
  { id: "bo_dat", slot: "bank", rarity: "common", unlock: { kind: "start" } },
  { id: "bo_da", slot: "bank", rarity: "common", unlock: { kind: "shop", price: 100 } },
  { id: "cau_ao", slot: "bank", rarity: "rare", unlock: { kind: "level", level: 9 } },
  { id: "bo_dua", slot: "bank", rarity: "rare", unlock: { kind: "shop", price: 240 } },

  // Maison — le cœur de la rive.
  { id: "choi_la", slot: "house", rarity: "common", unlock: { kind: "level", level: 2 } },
  { id: "nha_san", slot: "house", rarity: "rare", unlock: { kind: "shop", price: 320 } },
  { id: "quan_nuoc", slot: "house", rarity: "rare", unlock: { kind: "shop", price: 380 } },
  { id: "nha_co", slot: "house", rarity: "legendary", unlock: { kind: "collection", set: "bep" } },

  // Barque
  { id: "xuong_ba_la", slot: "boat", rarity: "common", unlock: { kind: "level", level: 4 } },
  { id: "ghe_bau", slot: "boat", rarity: "rare", unlock: { kind: "shop", price: 200 } },
  { id: "ghe_cho", slot: "boat", rarity: "rare", unlock: { kind: "collection", set: "cho" } },
  { id: "tau_khach", slot: "boat", rarity: "legendary", unlock: { kind: "trophy", code: "words_t3" } },

  // Végétation
  { id: "buoi_chuoi", slot: "plant", rarity: "common", unlock: { kind: "shop", price: 80 } },
  { id: "hang_dua", slot: "plant", rarity: "common", unlock: { kind: "level", level: 7 } },
  { id: "khom_tre", slot: "plant", rarity: "rare", unlock: { kind: "shop", price: 160 } },
  { id: "mai_vang", slot: "plant", rarity: "legendary", unlock: { kind: "collection", set: "tet" } },

  // Lumières
  { id: "den_dau", slot: "light", rarity: "common", unlock: { kind: "shop", price: 90 } },
  { id: "long_den", slot: "light", rarity: "rare", unlock: { kind: "shop", price: 210 } },
  { id: "den_day", slot: "light", rarity: "rare", unlock: { kind: "level", level: 14 } },
  { id: "hoa_dang", slot: "light", rarity: "legendary", unlock: { kind: "trophy", code: "streak_t3" } },

  // Animal — petit, dans un coin, jamais au centre.
  { id: "chuon_chuon", slot: "animal", rarity: "common", unlock: { kind: "shop", price: 70 } },
  { id: "co_trang", slot: "animal", rarity: "rare", unlock: { kind: "shop", price: 190 } },
  { id: "ca_loi", slot: "animal", rarity: "rare", unlock: { kind: "level", level: 11 } },
  { id: "trau_nuoc", slot: "animal", rarity: "legendary", unlock: { kind: "trophy", code: "games_t3" } },
];

const BY_ID = new Map(SCENE.map((item) => [item.id, item]));
export const sceneItem = (id: string | undefined | null): SceneItem | null => (id ? (BY_ID.get(id) ?? null) : null);
export const itemsOfSceneSlot = (slot: SceneSlot): SceneItem[] => SCENE.filter((item) => item.slot === slot);

/** Aménagement : un identifiant par emplacement, les facultatifs peuvent manquer. */
export type Scene = Partial<Record<SceneSlot, string>>;

export const DEFAULT_SCENE: Scene = { sky: "troi_trong", water: "nuoc_lang", bank: "bo_dat" };

/** Contexte de déblocage — le même que l'atelier : une personne, un porte-monnaie, une collection. */
export interface SceneContext {
  level: number;
  trophies: ReadonlySet<string>;
  sets: ReadonlySet<CollectionSet>;
  purchased: ReadonlySet<string>;
  worlds: ReadonlySet<string>;
}

export type SceneItemState = "owned" | "buyable" | "locked";

export function sceneItemState(item: SceneItem, ctx: SceneContext): SceneItemState {
  switch (item.unlock.kind) {
    case "start":
      return "owned";
    case "level":
      return ctx.level >= item.unlock.level ? "owned" : "locked";
    case "trophy":
      return ctx.trophies.has(item.unlock.code) ? "owned" : "locked";
    case "collection":
      return ctx.sets.has(item.unlock.set) ? "owned" : "locked";
    case "world":
      return ctx.worlds.has(item.unlock.world) ? "owned" : "locked";
    case "shop":
      return ctx.purchased.has(item.id) ? "owned" : "buyable";
  }
}

export const isSceneOwned = (item: SceneItem, ctx: SceneContext): boolean => sceneItemState(item, ctx) === "owned";

export function ownedSceneItems(ctx: SceneContext): SceneItem[] {
  return SCENE.filter((item) => isSceneOwned(item, ctx));
}

/** Prix d'une pièce de décor, ou `null` si elle ne s'achète pas. */
export function sceneItemPrice(item: SceneItem): number | null {
  return item.unlock.kind === "shop" ? item.unlock.price : null;
}

/**
 * Aménagement valide : les pièces non possédées tombent, les emplacements obligatoires reprennent
 * leur valeur de départ. Une rive n'est jamais à moitié dessinée.
 */
export function sanitizeScene(scene: Scene | null | undefined, ctx: SceneContext): Scene {
  const out: Scene = {};
  for (const slot of SCENE_SLOTS) {
    const chosen = sceneItem(scene?.[slot]);
    if (chosen && chosen.slot === slot && isSceneOwned(chosen, ctx)) {
      out[slot] = chosen.id;
      continue;
    }
    if (OPTIONAL_SCENE_SLOTS.has(slot)) continue;
    const fallback = sceneItem(DEFAULT_SCENE[slot]);
    if (fallback && isSceneOwned(fallback, ctx)) out[slot] = fallback.id;
  }
  return out;
}

/** Pièces de décor devenues disponibles entre deux états : ce que la file de félicitations annonce. */
export function newlySceneOwned(before: SceneContext, after: SceneContext): SceneItem[] {
  const had = new Set(ownedSceneItems(before).map((item) => item.id));
  return ownedSceneItems(after).filter((item) => !had.has(item.id));
}

/** Combien d'emplacements sont garnis : la vitrine l'affiche (« 5 des 8 places occupées »). */
export function sceneFilled(scene: Scene): number {
  return SCENE_SLOTS.filter((slot) => scene[slot] !== undefined).length;
}
