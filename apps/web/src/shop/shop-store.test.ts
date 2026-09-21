import {
  COLLECTIBLES,
  DEFAULT_AMBIANCE,
  DEFAULT_SCENE,
  entriesOfSection,
  featuredEntries,
  periodOf,
  SCENE,
  sceneItem,
  shopKey,
  type ShopEntry,
} from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ParloDB, setDb } from "../db.ts";
import {
  buyShopEntry,
  chooseAmbiance,
  claimQuestStep,
  emptyRewards,
  loadRewardsData,
  placedScene,
  placeSceneItem,
  REWARDS_KEY,
  shopOwned,
  useRewards,
  weeklyQuest,
} from "../rewards/store.ts";

/**
 * Boutique, rive, ambiance et quête côté appareil (contrat phase24).
 *
 * Ce qui est vérifié ici, c'est ce qui se casserait le plus salement — et coûterait des xu à
 * quelqu'un : un achat compté deux fois, un achat sans les fonds, une pièce posée sans être
 * possédée, un palier de quête réclamé deux fois.
 */

let d: ParloDB;

beforeEach(() => {
  d = new ParloDB(`test-${Math.random()}`);
  setDb(d);
  useRewards.setState({ data: emptyRewards(), loaded: false });
});
afterEach(async () => {
  await d.delete();
  setDb(null);
});

const give = async (coins: number) => {
  await d.kv.put({ key: REWARDS_KEY, value: { ...emptyRewards(), coins } });
};

/** Une entrée d'un rayon, hors vitrine : son prix est alors celui du catalogue. */
function plainEntry(section: ShopEntry["section"], now = new Date()): ShopEntry {
  const featured = new Set(featuredEntries(periodOf("weekly", now).key).map((f) => shopKey(f.entry)));
  const entry = entriesOfSection(section).find((e) => !featured.has(shopKey(e)));
  if (!entry) throw new Error(`aucune entrée hors vitrine dans ${section}`);
  return entry;
}

describe("acheter", () => {
  it("retire le prix, range la pièce dans son rayon, et le note comme dépensé", async () => {
    const entry = plainEntry("wardrobe");
    await give(entry.price + 30);
    expect(await buyShopEntry(shopKey(entry))).toBe("bought");

    const data = await loadRewardsData();
    expect(data.coins).toBe(30);
    expect(data.spent).toBe(entry.price);
    expect(data.purchased).toContain(entry.id);
    expect(shopOwned(data).wardrobe.has(entry.id)).toBe(true);
  });

  it("refuse sans les fonds, et ne touche à rien", async () => {
    const entry = plainEntry("scene");
    await give(entry.price - 1);
    expect(await buyShopEntry(shopKey(entry))).toBe("tooExpensive");
    const data = await loadRewardsData();
    expect(data.coins).toBe(entry.price - 1);
    expect(data.purchasedScene).toEqual([]);
  });

  it("ne facture pas deux fois la même pièce", async () => {
    // Deux onglets ouverts, un double appui : la garde est ici, pas dans le bouton.
    const entry = plainEntry("scene");
    await give(entry.price * 2);
    expect(await buyShopEntry(shopKey(entry))).toBe("bought");
    expect(await buyShopEntry(shopKey(entry))).toBe("already");
    expect((await loadRewardsData()).coins).toBe(entry.price);
  });

  it("une clé inconnue ne coûte rien", async () => {
    await give(9999);
    expect(await buyShopEntry("scene:n-importe-quoi")).toBe("unknown");
    expect(await buyShopEntry("pas-un-rayon:x")).toBe("unknown");
    expect((await loadRewardsData()).coins).toBe(9999);
  });

  it("applique la remise de la vitrine, pas le prix affiché au catalogue", async () => {
    const now = new Date();
    const featured = featuredEntries(periodOf("weekly", now).key)[0]!;
    await give(featured.fullPrice);
    expect(await buyShopEntry(shopKey(featured.entry), now)).toBe("bought");
    // On a payé le prix remisé : il reste la différence.
    expect((await loadRewardsData()).coins).toBe(featured.fullPrice - featured.price);
  });

  it("un objet de collection acheté entre dans la collection", async () => {
    const entry = entriesOfSection("collectible")[0]!;
    await give(entry.price);
    expect(await buyShopEntry(shopKey(entry))).toBe("bought");
    const data = await loadRewardsData();
    expect(data.collectibles.map((c) => c.id)).toContain(entry.id);
    expect(shopOwned(data).collectibles.has(entry.id)).toBe(true);
  });

  it("terminer une collection en l'achetant paie comme si elle venait d'un coffre", async () => {
    // Le dernier objet d'une collection vaut sa prime, quel que soit le chemin par lequel il arrive.
    const set = COLLECTIBLES.filter((item) => item.set === "cho");
    const entries = set.map((item) => entriesOfSection("collectible").find((e) => e.id === item.id)!);
    await give(entries.reduce((sum, e) => sum + e.price, 0));
    for (const entry of entries) expect(await buyShopEntry(shopKey(entry))).toBe("bought");

    const data = await loadRewardsData();
    // La prime de collection (120 xu) a été versée : le solde n'est pas retombé à zéro.
    expect(data.coins).toBeGreaterThan(0);
  });

  it("une ambiance achetée devient portable, pas les autres", async () => {
    const entry = entriesOfSection("ambiance")[0]!;
    await give(entry.price);
    await buyShopEntry(shopKey(entry));
    const data = await loadRewardsData();
    expect(shopOwned(data).ambiances.has(entry.id)).toBe(true);
    // L'ambiance d'origine est toujours là ; celle qu'on n'a pas achetée ne l'est pas.
    expect(shopOwned(data).ambiances.has(DEFAULT_AMBIANCE)).toBe(true);
    const other = entriesOfSection("ambiance").find((e) => e.id !== entry.id);
    if (other) expect(shopOwned(data).ambiances.has(other.id)).toBe(false);
  });
});

describe("aménager la rive", () => {
  it("pose une pièce possédée et la garde", async () => {
    const entry = plainEntry("scene");
    const item = sceneItem(entry.id)!;
    await give(entry.price);
    await buyShopEntry(shopKey(entry));
    const scene = await placeSceneItem(item.slot, item.id);
    expect(scene[item.slot]).toBe(item.id);
    expect(placedScene(await loadRewardsData())[item.slot]).toBe(item.id);
  });

  it("refuse une pièce qu'on ne possède pas, sans casser la rive", async () => {
    const locked = SCENE.find((item) => item.unlock.kind === "level" && item.slot === "boat")!;
    const scene = await placeSceneItem("boat", locked.id);
    expect(scene.boat).toBeUndefined();
    // Les emplacements obligatoires restent garnis quoi qu'il arrive.
    expect(scene.sky).toBe(DEFAULT_SCENE.sky);
    expect(scene.water).toBe(DEFAULT_SCENE.water);
  });

  it("retire une pièce facultative, jamais une obligatoire", async () => {
    expect((await placeSceneItem("animal", null)).animal).toBeUndefined();
    expect((await placeSceneItem("sky", null)).sky).toBe(DEFAULT_SCENE.sky);
  });

  it("une ambiance non possédée ne se porte pas", async () => {
    const other = entriesOfSection("ambiance")[0]!;
    expect(await chooseAmbiance(other.id)).toBe(DEFAULT_AMBIANCE);
    expect(await chooseAmbiance("bleu-fluo")).toBe(DEFAULT_AMBIANCE);
  });
});

describe("quête de la semaine", () => {
  const monday = new Date(2026, 8, 21, 12);

  const workedOn = async (days: readonly string[]) => {
    await d.kv.put({
      key: REWARDS_KEY,
      value: { ...emptyRewards(), journal: Object.fromEntries(days.map((day) => [day, { items: 8 }])) },
    });
  };

  it("compte les jours de la semaine en cours", async () => {
    await workedOn(["2026-09-21", "2026-09-22", "2026-09-24"]);
    const progress = await weeklyQuest(monday);
    expect(progress.days).toHaveLength(3);
    expect(progress.steps[0]?.done).toBe(true);
    expect(progress.steps[1]?.done).toBe(false);
  });

  it("paie le palier réclamé, une seule fois", async () => {
    await workedOn(["2026-09-21", "2026-09-22", "2026-09-23"]);
    const step = (await weeklyQuest(monday)).steps[0]!.step;

    expect(await claimQuestStep(step, monday)).not.toEqual([]);
    const after = await loadRewardsData();
    expect(after.coins).toBeGreaterThanOrEqual(step.coins);

    // Deuxième appui : rien de plus, pas un xu.
    expect(await claimQuestStep(step, monday)).toEqual([]);
    expect((await loadRewardsData()).coins).toBe(after.coins);
  });

  it("ne paie pas un palier qui n'est pas atteint", async () => {
    await workedOn(["2026-09-21"]);
    const step = (await weeklyQuest(monday)).steps[0]!.step;
    expect(await claimQuestStep(step, monday)).toEqual([]);
    expect((await loadRewardsData()).coins).toBe(0);
  });

  it("les xu gagnés servent à acheter : la boucle se referme", async () => {
    await workedOn(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
    const quest = await weeklyQuest(monday);
    for (const view of quest.steps.filter((v) => v.done)) await claimQuestStep(view.step, monday);

    const coins = (await loadRewardsData()).coins;
    const affordable = entriesOfSection("scene").find((entry) => entry.price <= coins);
    expect(affordable, "une semaine complète doit permettre d'acheter quelque chose").toBeDefined();
    expect(await buyShopEntry(shopKey(affordable!))).toBe("bought");
  });
});
