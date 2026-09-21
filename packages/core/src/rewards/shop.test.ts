import { describe, expect, it } from "vitest";
import { AMBIANCE_LIST, AMBIANCES, ambiance, DEFAULT_AMBIANCE, isAmbianceId, type AmbianceTokens } from "./ambiance.ts";
import { COLLECTIBLES, COLLECTION_SETS } from "./collection.ts";
import { periodOf } from "./counters.ts";
import {
  COLLECTIBLE_PRICE,
  emptyShopOwned,
  entriesOfSection,
  featuredEntries,
  isShopOwned,
  priceThisWeek,
  remainingInSection,
  SHOP,
  SHOP_SECTIONS,
  shopEntry,
  shopKey,
  shopState,
} from "./shop.ts";
import {
  DEFAULT_SCENE,
  SCENE,
  SCENE_SLOTS,
  OPTIONAL_SCENE_SLOTS,
  newlySceneOwned,
  ownedSceneItems,
  sanitizeScene,
  sceneFilled,
  sceneItem,
  sceneItemPrice,
  sceneItemState,
  type SceneContext,
} from "./scene.ts";
import { WARDROBE } from "./wardrobe.ts";

/**
 * Boutique, rive et ambiances (contrat phase24 §1 à §3).
 *
 * Ce qui est tenu ici : une vitrine qui ne ment pas sur les prix, une rive qui ne se dessine
 * jamais à moitié, et des ambiances qui restent lisibles — vérifié par le calcul, pas à l'œil.
 */

const ctx = (over: Partial<SceneContext> = {}): SceneContext => ({
  level: 1,
  trophies: new Set(),
  sets: new Set(),
  purchased: new Set(),
  worlds: new Set(),
  ...over,
});

describe("catalogue de la boutique", () => {
  it("rassemble tout ce qui s'achète, et rien d'autre", () => {
    // Chaque pièce d'atelier à prix est en boutique, et aucune pièce débloquée autrement n'y est.
    const shopWardrobe = new Set(entriesOfSection("wardrobe").map((entry) => entry.id));
    for (const item of WARDROBE) {
      expect(shopWardrobe.has(item.id)).toBe(item.unlock.kind === "shop");
    }
    const shopScene = new Set(entriesOfSection("scene").map((entry) => entry.id));
    for (const item of SCENE) {
      expect(shopScene.has(item.id)).toBe(item.unlock.kind === "shop");
    }
  });

  it("vend chaque objet de collection, au prix de sa rareté", () => {
    const entries = entriesOfSection("collectible");
    expect(entries).toHaveLength(COLLECTIBLES.length);
    for (const item of COLLECTIBLES) {
      const entry = entries.find((e) => e.id === item.id);
      expect(entry?.price).toBe(COLLECTIBLE_PRICE[item.rarity]);
    }
    // Acheter coûte nettement plus qu'un coffre : le coffre garde sa valeur.
    expect(COLLECTIBLE_PRICE.common).toBeGreaterThan(50);
    expect(COLLECTIBLE_PRICE.legendary).toBeGreaterThan(COLLECTIBLE_PRICE.rare);
  });

  it("n'a ni doublon ni prix nul", () => {
    const keys = SHOP.map(shopKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of SHOP) expect(entry.price).toBeGreaterThan(0);
  });

  it("se retrouve par sa clé, rayon compris", () => {
    // Les identifiants **se croisent** d'un catalogue à l'autre : `non_la` est un chapeau et un
    // objet de collection, `mai_vang` un décor et un objet, `ghe_cho` une barque et un objet. Une
    // clé réduite à l'identifiant ferait acheter la mauvaise chose.
    const collisions = [...new Set(COLLECTIBLES.map((c) => c.id))].filter(
      (id) => SCENE.some((item) => item.id === id) || WARDROBE.some((item) => item.id === id),
    );
    expect(collisions.length).toBeGreaterThan(0);

    for (const entry of SHOP) {
      const found = shopEntry(shopKey(entry));
      expect(found?.section).toBe(entry.section);
      expect(found?.id).toBe(entry.id);
    }
  });

  it("dit ce qui est possédé, abordable ou hors de portée", () => {
    const entry = entriesOfSection("wardrobe")[0]!;
    const owned = emptyShopOwned();
    expect(shopState(entry, owned, 0)).toBe("tooExpensive");
    expect(shopState(entry, owned, entry.price)).toBe("affordable");
    expect(shopState(entry, { ...owned, wardrobe: new Set([entry.id]) }, 0)).toBe("owned");
  });

  it("compte ce qu'il reste à acheter dans un rayon", () => {
    const all = entriesOfSection("collectible");
    const owned = { ...emptyShopOwned(), collectibles: new Set(all.slice(0, 3).map((e) => e.id)) };
    expect(remainingInSection("collectible", owned)).toBe(all.length - 3);
    expect(isShopOwned(all[0]!, owned)).toBe(true);
  });
});

describe("vitrine de la semaine", () => {
  const week = periodOf("weekly", new Date(2026, 8, 21)).key;

  it("est la même à chaque lecture de la semaine, et change la semaine suivante", () => {
    const a = featuredEntries(week).map((f) => shopKey(f.entry));
    expect(featuredEntries(week).map((f) => shopKey(f.entry))).toEqual(a);
    const next = periodOf("weekly", new Date(2026, 8, 28)).key;
    expect(featuredEntries(next).map((f) => shopKey(f.entry))).not.toEqual(a);
  });

  it("remise fixe, jamais un hasard qui pousse à insister", () => {
    for (const featured of featuredEntries(week)) {
      expect(featured.price).toBeLessThan(featured.fullPrice);
      expect(featured.price % 10).toBe(0);
      expect(featured.price).toBeGreaterThanOrEqual(10);
    }
  });

  it("ne laisse pas un seul rayon monopoliser la vitrine", () => {
    const sections = new Set(featuredEntries(week).map((f) => f.entry.section));
    expect(sections.size).toBeGreaterThan(1);
  });

  it("le prix de la semaine est celui de la vitrine, sinon le prix affiché", () => {
    const featured = featuredEntries(week)[0]!;
    expect(priceThisWeek(featured.entry, week)).toBe(featured.price);
    const plain = SHOP.find((entry) => !featuredEntries(week).some((f) => shopKey(f.entry) === shopKey(entry)))!;
    expect(priceThisWeek(plain, week)).toBe(plain.price);
  });
});

describe("la rive", () => {
  it("a toujours un ciel, une eau et une berge dès le départ", () => {
    const scene = sanitizeScene({}, ctx());
    for (const slot of SCENE_SLOTS) {
      if (OPTIONAL_SCENE_SLOTS.has(slot)) continue;
      expect(scene[slot], `${slot} manquant`).toBeDefined();
    }
    expect(scene).toEqual(DEFAULT_SCENE);
  });

  it("laisse tomber une pièce qu'on ne possède pas, sans casser la scène", () => {
    const paid = SCENE.find((item) => item.unlock.kind === "shop" && item.slot === "sky")!;
    const scene = sanitizeScene({ sky: paid.id, animal: "chuon_chuon" }, ctx());
    // Le ciel retombe sur celui de départ ; l'animal, facultatif, disparaît simplement.
    expect(scene.sky).toBe(DEFAULT_SCENE.sky);
    expect(scene.animal).toBeUndefined();
  });

  it("garde la pièce une fois achetée", () => {
    const paid = SCENE.find((item) => item.unlock.kind === "shop" && item.slot === "sky")!;
    const owned = ctx({ purchased: new Set([paid.id]) });
    expect(sceneItemState(paid, owned)).toBe("owned");
    expect(sanitizeScene({ sky: paid.id }, owned).sky).toBe(paid.id);
  });

  it("refuse une pièce posée dans le mauvais emplacement", () => {
    const boat = SCENE.find((item) => item.slot === "boat")!;
    expect(sanitizeScene({ sky: boat.id }, ctx({ level: 99 })).sky).toBe(DEFAULT_SCENE.sky);
  });

  it("annonce les pièces qu'un niveau vient d'ouvrir", () => {
    const fresh = newlySceneOwned(ctx({ level: 1 }), ctx({ level: 5 }));
    expect(fresh.length).toBeGreaterThan(0);
    for (const item of fresh) expect(item.unlock.kind).toBe("level");
  });

  it("compte les emplacements garnis", () => {
    expect(sceneFilled(DEFAULT_SCENE)).toBe(3);
    expect(sceneFilled({})).toBe(0);
  });

  it("chaque emplacement a au moins deux pièces : un choix, pas une vitrine vide", () => {
    for (const slot of SCENE_SLOTS) {
      expect(SCENE.filter((item) => item.slot === slot).length, slot).toBeGreaterThanOrEqual(2);
    }
  });

  it("n'a ni doublon d'identifiant ni prix absurde", () => {
    const ids = SCENE.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SCENE) {
      const price = sceneItemPrice(item);
      if (price !== null) expect(price).toBeGreaterThanOrEqual(50);
    }
    expect(sceneItem("inconnu")).toBeNull();
  });

  it("les pièces de départ sont possédées par tout le monde", () => {
    expect(ownedSceneItems(ctx()).every((item) => item.unlock.kind === "start")).toBe(true);
  });

  it("chaque collection ouvre quelque chose sur la rive : finir une collection se voit", () => {
    for (const set of COLLECTION_SETS) {
      const gift = SCENE.some((item) => item.unlock.kind === "collection" && item.unlock.set === set);
      expect(gift, `collection ${set} sans récompense de rive`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------- Ambiances */

/** Luminance relative WCAG d'une couleur `#RRGGBB`. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Les deux encres de la palette (spec §13) : mực en clair, son inverse en sombre. */
const INK = { light: "#14201E", dark: "#E9EFEC" } as const;

describe("ambiances", () => {
  it("le texte reste lisible sur chaque surface, en clair comme en sombre", () => {
    for (const item of AMBIANCE_LIST) {
      for (const mode of ["light", "dark"] as const) {
        const tokens: AmbianceTokens = item[mode];
        for (const key of ["nuoc", "surface", "surface2"] as const) {
          const ratio = contrast(INK[mode], tokens[key]);
          expect(ratio, `${item.id}/${mode}/${key} : ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("une ambiance claire reste claire, une sombre reste sombre", () => {
    // Sans ça, « clair » et « sombre » se croiseraient et l'encre choisie serait la mauvaise.
    for (const item of AMBIANCE_LIST) {
      expect(luminance(item.light.nuoc), item.id).toBeGreaterThan(0.5);
      expect(luminance(item.dark.nuoc), item.id).toBeLessThan(0.1);
    }
  });

  it("la carte reste plus claire que le fond en clair, et l'inverse en sombre", () => {
    // La profondeur de l'interface vient de là : une carte posée **sur** l'eau.
    for (const item of AMBIANCE_LIST) {
      expect(luminance(item.light.surface), item.id).toBeGreaterThan(luminance(item.light.nuoc));
      expect(luminance(item.dark.surface), item.id).toBeGreaterThan(luminance(item.dark.nuoc));
    }
  });

  it("l'ambiance d'origine est celle de toujours, et la seule offerte au départ", () => {
    expect(DEFAULT_AMBIANCE).toBe("delta");
    expect(ambiance(DEFAULT_AMBIANCE).light.nuoc).toBe("#F2F6F3");
    expect(AMBIANCE_LIST.filter((item) => item.unlock.kind === "start").map((item) => item.id)).toEqual([DEFAULT_AMBIANCE]);
  });

  it("un identifiant inconnu retombe sur l'ambiance d'origine", () => {
    expect(ambiance("n-importe-quoi").id).toBe(DEFAULT_AMBIANCE);
    expect(ambiance(null).id).toBe(DEFAULT_AMBIANCE);
    expect(isAmbianceId("mua")).toBe(true);
    expect(isAmbianceId("bleu")).toBe(false);
    expect(AMBIANCES).toHaveLength(AMBIANCE_LIST.length);
  });

  it("toutes les sections de la boutique ont de quoi vendre", () => {
    for (const section of SHOP_SECTIONS) expect(entriesOfSection(section).length, section).toBeGreaterThan(0);
  });
});
