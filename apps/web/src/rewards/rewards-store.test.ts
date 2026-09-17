import { COLLECTIBLES, collectionRewardItem, itemPrice, periodOf, trophyByCode, wardrobeItem } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ParloDB, setDb } from "../db.ts";
import {
  awardActivity,
  awardGame,
  buyWardrobeItem,
  claimMission,
  emptyRewards,
  loadRewardsData,
  missionGroups,
  normalizeRewards,
  REWARDS_KEY,
  totalXpAllPacks,
  useRewards,
  wearWardrobeItem,
  wornOutfit,
} from "./store.ts";

/**
 * Récompenses locales (contrat phase9 §1). Ce qui est vérifié ici, c'est ce qui se casserait le
 * plus salement : un gain compté deux fois, un objet en double, une mission réclamée deux fois,
 * une pièce portée sans être possédée, et un état stocké abîmé qui ferait planter l'écran.
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

/** Seules les options du pack comptent ici (fonctionnalités, noms de niveaux) : pas besoin du contenu réel. */
const pack = { code: "vi-south", features: ["tones"], levelNames: [] } as never;

describe("état stocké", () => {
  it("part d'un état vide et le relit tel quel", async () => {
    expect(await loadRewardsData()).toEqual(emptyRewards());
  });

  it("survit à un état abîmé sans rien perdre de valide", () => {
    const data = normalizeRewards({
      coins: -5,
      trophies: [{ code: "sessions_t1", earnedAt: "x" }, { pas: "un trophée" }, null],
      collectibles: "pas une liste",
      purchased: ["kinh", 42],
      totals: { items: 3, inconnu: 9 },
      journal: { "2026-09-17": { items: 2 }, demain: { items: 5 } },
      level: 0,
    });
    expect(data.coins).toBe(0);
    expect(data.trophies).toEqual([{ code: "sessions_t1", earnedAt: "x" }]);
    expect(data.collectibles).toEqual([]);
    expect(data.purchased).toEqual(["kinh"]);
    expect(data.totals).toEqual({ items: 3 });
    expect(data.journal).toEqual({ "2026-09-17": { items: 2 } });
    expect(data.level).toBe(1);
  });

  it("additionne l'XP de toutes les langues", async () => {
    await d.kv.put({ key: "vi-south:totals", value: { xp: 300 } });
    await d.kv.put({ key: "es:totals", value: { xp: 120 } });
    await d.kv.put({ key: "displayName", value: "Mai" });
    expect(await totalXpAllPacks()).toBe(420);
  });
});

describe("gains d'une séance", () => {
  it("écrit les compteurs du jour et les cumule, et verse des xu", async () => {
    await awardActivity({ day: "2026-09-17", counters: { sessions: 1, items: 12 }, coins: 8 });
    await awardActivity({ day: "2026-09-17", counters: { sessions: 1, items: 6 }, coins: 5 });
    const data = await loadRewardsData();
    expect(data.journal["2026-09-17"]).toEqual({ sessions: 2, items: 18 });
    expect(data.totals).toEqual({ sessions: 2, items: 18 });
    expect(data.coins).toBe(13);
  });

  it("annonce un niveau gagné une seule fois, avec sa récompense", async () => {
    const first = await awardActivity({ level: 3, counters: { sessions: 1 } });
    expect(first.filter((c) => c.kind === "level")).toHaveLength(2); // niveaux 2 et 3
    // Le même niveau ne se regagne pas au gain suivant.
    const second = await awardActivity({ level: 3, counters: { sessions: 1 } });
    expect(second.filter((c) => c.kind === "level")).toHaveLength(0);
  });

  it("ne redescend jamais le niveau (une lecture plus basse ne dégrade rien)", async () => {
    await awardActivity({ level: 8 });
    await awardActivity({ level: 2 });
    expect((await loadRewardsData()).level).toBe(8);
  });

  it("donne un trophée au palier, une fois, et ses xu", async () => {
    const trophy = trophyByCode("sessions_t1")!;
    const before = (await loadRewardsData()).coins;
    const celebrations = await awardActivity({ counters: { sessions: trophy.target } });
    expect(celebrations.filter((c) => c.kind === "trophy").map((c) => (c.kind === "trophy" ? c.code : ""))).toEqual(["sessions_t1"]);
    expect((await loadRewardsData()).coins).toBe(before + trophy.coins);
    const again = await awardActivity({ counters: { sessions: 1 } });
    expect(again.filter((c) => c.kind === "trophy")).toHaveLength(0);
  });

  it("un jalon de série donne un coffre, pas les jours entre deux", async () => {
    const seventh = await awardActivity({ streakDays: 7, counters: { sessions: 1 } });
    expect(seventh.some((c) => c.kind === "collectible")).toBe(true);
    const eighth = await awardActivity({ streakDays: 8, counters: { sessions: 1 } });
    expect(eighth.some((c) => c.kind === "collectible")).toBe(false);
  });

  it("les coffres ne donnent jamais deux fois le même objet", async () => {
    for (let i = 0; i < COLLECTIBLES.length + 3; i++) await awardActivity({ chests: ["jade"] });
    const ids = (await loadRewardsData()).collectibles.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(COLLECTIBLES.length);
  });

  it("une collection complète verse sa prime et débloque sa pièce, dans la même salve", async () => {
    // Assez de coffres pour finir au moins une collection.
    let celebrations: Awaited<ReturnType<typeof awardActivity>> = [];
    for (let i = 0; i < COLLECTIBLES.length; i++) {
      celebrations = await awardActivity({ chests: ["jade"] });
      if (celebrations.some((c) => c.kind === "set")) break;
    }
    const set = celebrations.find((c) => c.kind === "set");
    expect(set).toBeDefined();
    const reward = set?.kind === "set" ? collectionRewardItem(set.set) : null;
    expect(reward).not.toBeNull();
    expect(celebrations.some((c) => c.kind === "wardrobe" && c.itemId === reward?.id)).toBe(true);
  });

  it("l'ordre des cartes va du plus rare à la monnaie", async () => {
    const celebrations = await awardActivity({ level: 5, counters: { sessions: 10 }, chests: ["wood"], coins: 10 });
    const kinds = celebrations.map((c) => c.kind);
    expect(kinds.indexOf("level")).toBeLessThan(kinds.indexOf("coins"));
    expect(kinds.lastIndexOf("coins")).toBe(kinds.length - 1);
  });

  it("une partie perdue rapporte moins qu'une partie gagnée, et compte comme partie", async () => {
    await awardGame({ correct: 1, total: 5, points: 10, won: false });
    const lost = await loadRewardsData();
    expect(lost.totals).toEqual({ games: 1 });
    await awardGame({ correct: 5, total: 5, points: 10, won: true });
    const won = await loadRewardsData();
    expect(won.totals.gameWins).toBe(1);
    expect(won.coins - lost.coins).toBeGreaterThan(lost.coins);
  });
});

describe("missions", () => {
  const now = new Date(2026, 8, 17, 10);

  it("les trois périodes sont là, non réclamées, sans progression", async () => {
    const groups = await missionGroups(pack, now);
    expect(groups.map((g) => g.period.kind)).toEqual(["daily", "weekly", "monthly"]);
    for (const group of groups) {
      for (const view of group.missions) {
        expect(view.progress).toBe(0);
        expect(view.done).toBe(false);
        expect(view.claimedAt).toBeNull();
      }
    }
  });

  it("la progression vient des compteurs de la période, pas d'avant", async () => {
    const groups = await missionGroups(pack, now);
    const daily = groups[0]!.missions[0]!;
    // Un compteur d'hier ne compte pas pour aujourd'hui.
    await awardActivity({ day: "2026-09-16", counters: { [daily.mission.metric]: daily.mission.target } }, now);
    expect((await missionGroups(pack, now))[0]!.missions[0]!.progress).toBe(0);
    await awardActivity({ day: "2026-09-17", counters: { [daily.mission.metric]: daily.mission.target } }, now);
    const after = (await missionGroups(pack, now))[0]!.missions[0]!;
    expect(after.progress).toBe(daily.mission.target);
    expect(after.done).toBe(true);
  });

  it("réclamer paie une fois, marque la mission et compte pour le trophée des missions", async () => {
    const period = periodOf("daily", now);
    const groups = await missionGroups(pack, now);
    const view = groups[0]!.missions[0]!;
    await awardActivity({ day: "2026-09-17", counters: { [view.mission.metric]: view.mission.target } }, now);
    const before = (await loadRewardsData()).coins;

    const celebrations = await claimMission(view.mission, period, now);
    expect(celebrations[0]?.kind).toBe("mission");
    const data = await loadRewardsData();
    expect(data.claims[view.mission.id]).toBeTruthy();
    expect(data.coins).toBeGreaterThanOrEqual(before + view.mission.reward.coins);
    expect(data.totals.missions).toBe(1);

    // Deuxième réclamation : rien du tout.
    expect(await claimMission(view.mission, period, now)).toEqual([]);
    expect((await loadRewardsData()).coins).toBe(data.coins);
  });

  it("une mission non terminée ne se réclame pas", async () => {
    const period = periodOf("daily", now);
    const view = (await missionGroups(pack, now))[0]!.missions[0]!;
    expect(await claimMission(view.mission, period, now)).toEqual([]);
    expect((await loadRewardsData()).claims).toEqual({});
  });

  it("un pack sans tons ne reçoit pas de mission de tons", async () => {
    const noTones = { code: "es", features: [], levelNames: [] } as never;
    const groups = await missionGroups(noTones, now);
    expect(groups.flatMap((g) => g.missions).some((v) => v.mission.kind === "tones")).toBe(false);
  });
});

describe("atelier", () => {
  it("achète une pièce, débite les xu, et refuse quand il en manque", async () => {
    const item = wardrobeItem("kinh")!;
    const price = itemPrice(item)!;
    expect(await buyWardrobeItem(item.id)).toBe("tooExpensive");

    await awardActivity({ coins: price });
    expect(await buyWardrobeItem(item.id)).toBe("bought");
    const data = await loadRewardsData();
    expect(data.coins).toBe(0);
    expect(data.spent).toBe(price);
    expect(data.purchased).toContain(item.id);

    // Déjà possédée : on ne la revend pas une deuxième fois.
    expect(await buyWardrobeItem(item.id)).toBe("already");
    expect((await loadRewardsData()).coins).toBe(0);
    expect(await buyWardrobeItem("pièce-inconnue")).toBe("unknown");
  });

  it("ne porte que ce qui est possédé, et garde une tenue complète", async () => {
    // « non_la » demande le niveau 3 : refusée, et la tenue reste celle par défaut.
    await wearWardrobeItem("hat", "non_la");
    expect(wornOutfit(await loadRewardsData()).hat).toBeUndefined();

    await awardActivity({ level: 3 });
    await wearWardrobeItem("hat", "non_la");
    expect(wornOutfit(await loadRewardsData()).hat).toBe("non_la");

    // « Rien » est une réponse valable pour un emplacement facultatif.
    await wearWardrobeItem("hat", null);
    const outfit = wornOutfit(await loadRewardsData());
    expect(outfit.hat).toBeUndefined();
    // La tenue et le fond, eux, ne sont jamais vides.
    expect(outfit.outfit).toBeTruthy();
    expect(outfit.backdrop).toBeTruthy();
  });

  it("la tenue enregistrée survit à un rechargement", async () => {
    await awardActivity({ level: 4 });
    await wearWardrobeItem("outfit", "ao_ba_ba");
    setDb(d);
    expect((await loadRewardsData()).outfit.outfit).toBe("ao_ba_ba");
  });
});

describe("clé de stockage", () => {
  it("est globale : les récompenses suivent la personne, pas la langue", async () => {
    await awardActivity({ coins: 10 });
    const rows = await d.kv.toArray();
    expect(rows.map((row) => row.key)).toContain(REWARDS_KEY);
    expect(rows.some((row) => row.key.endsWith(`:${REWARDS_KEY}`))).toBe(false);
  });
});
