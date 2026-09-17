import { describe, expect, it } from "vitest";
import {
  addCounters,
  bumpJournal,
  CHEST_COINS,
  coinsForGame,
  coinsForSession,
  COINS_SESSION_MAX,
  collectibleById,
  COLLECTIBLES,
  COLLECTION_SETS,
  collectionRewardItem,
  completedSets,
  currentMissions,
  DEFAULT_OUTFIT,
  evaluateTrophies,
  generateMissions,
  isoWeek,
  itemPrice,
  itemState,
  JOURNAL_MAX_DAYS,
  levelReward,
  levelRewards,
  MISSION_COUNT,
  missionDone,
  missionProgress,
  missionTarget,
  newlyOwned,
  normalizeCounters,
  normalizeJournal,
  openChest,
  ownedItems,
  periodCounters,
  periodOf,
  sanitizeOutfit,
  setProgress,
  streakChest,
  sumCounters,
  TROPHIES,
  trophyByCode,
  trophyTierOf,
  trophyValue,
  WARDROBE,
  WARDROBE_SLOTS,
  wardrobeContext,
  wardrobeItem,
  weekStart,
  type CountersJournal,
  type MissionKind,
  type WardrobeContext,
} from "./index.ts";

describe("compteurs", () => {
  it("additionne et omet les métriques nulles", () => {
    expect(addCounters({ items: 3, xp: 0 }, { items: 2, correct: 1 })).toEqual({ items: 5, correct: 1 });
  });

  it("refuse les valeurs non numériques, négatives ou inconnues", () => {
    expect(normalizeCounters({ items: 4, xp: -3, correct: "8", inconnu: 9 })).toEqual({ items: 4 });
    expect(normalizeCounters(null)).toEqual({});
  });

  it("ne garde du journal que les jours au bon format", () => {
    expect(normalizeJournal({ "2026-09-17": { items: 2 }, hier: { items: 5 }, "2026-09-18": {} })).toEqual({ "2026-09-17": { items: 2 } });
  });

  it("oublie les jours au-delà de la fenêtre utile", () => {
    const journal = bumpJournal({ "2020-01-01": { items: 1 } }, "2026-09-17", { items: 2 });
    expect(journal["2020-01-01"]).toBeUndefined();
    expect(journal["2026-09-17"]).toEqual({ items: 2 });
    // La borne elle-même reste (le jour juste à l'intérieur de la fenêtre).
    const day = new Date(Date.UTC(2026, 8, 17) - (JOURNAL_MAX_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    expect(bumpJournal({ [day]: { items: 1 } }, "2026-09-17", {})[day]).toEqual({ items: 1 });
  });

  it("somme les jours demandés et ignore les absents", () => {
    const journal: CountersJournal = { "2026-09-16": { items: 3 }, "2026-09-17": { items: 4, xp: 10 } };
    expect(sumCounters(journal, ["2026-09-16", "2026-09-17", "2026-09-18"])).toEqual({ items: 7, xp: 10 });
  });
});

describe("périodes", () => {
  it("la semaine commence le lundi local", () => {
    // Dimanche 20 septembre 2026 → lundi 14.
    expect(weekStart(new Date(2026, 8, 20, 23, 30)).getDate()).toBe(14);
    // Lundi lui-même reste son propre début.
    expect(weekStart(new Date(2026, 8, 14, 0, 1)).getDate()).toBe(14);
  });

  it("numérote les semaines ISO", () => {
    expect(isoWeek(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 });
    expect(isoWeek(new Date(2026, 8, 17)).week).toBe(38);
  });

  it("couvre exactement les jours de la période", () => {
    const daily = periodOf("daily", new Date(2026, 8, 17, 14));
    expect(daily.days).toEqual(["2026-09-17"]);
    expect(periodOf("weekly", new Date(2026, 8, 17)).days).toHaveLength(7);
    expect(periodOf("monthly", new Date(2026, 8, 17)).days).toHaveLength(30);
    expect(periodOf("monthly", new Date(2026, 1, 3)).days).toHaveLength(28);
  });

  it("ne compte que les jours de la période", () => {
    const journal: CountersJournal = { "2026-09-13": { items: 100 }, "2026-09-16": { items: 3 } };
    expect(periodCounters(journal, periodOf("weekly", new Date(2026, 8, 17)))).toEqual({ items: 3 });
  });
});

describe("missions", () => {
  const now = new Date(2026, 8, 17, 10);

  it("donne la même liste pour la même période, une autre à la période suivante", () => {
    const a = generateMissions(periodOf("daily", now));
    const b = generateMissions(periodOf("daily", new Date(2026, 8, 17, 22)));
    const next = generateMissions(periodOf("daily", new Date(2026, 8, 18, 10)));
    expect(a).toEqual(b);
    expect(a.map((m) => m.kind)).not.toEqual(next.map((m) => m.kind));
  });

  it("respecte le nombre par période et n'a pas de doublon", () => {
    for (const { period, missions } of currentMissions(now)) {
      expect(missions).toHaveLength(MISSION_COUNT[period.kind]);
      expect(new Set(missions.map((m) => m.kind)).size).toBe(missions.length);
      expect(new Set(missions.map((m) => m.id)).size).toBe(missions.length);
    }
  });

  it("écarte les genres exclus (pack sans tons)", () => {
    const exclude: MissionKind[] = ["tones", "speak"];
    for (const { missions } of currentMissions(now, { exclude })) {
      expect(missions.some((m) => exclude.includes(m.kind))).toBe(false);
    }
  });

  it("monte les cibles avec l'objectif quotidien et la durée de la période", () => {
    expect(missionTarget("items", "daily", { dailyGoalMin: 5 })).toBeLessThan(missionTarget("items", "daily", { dailyGoalMin: 20 }));
    expect(missionTarget("items", "daily")).toBeLessThan(missionTarget("items", "weekly"));
    expect(missionTarget("items", "weekly")).toBeLessThan(missionTarget("items", "monthly"));
  });

  it("garde des cibles atteignables : une mission quotidienne tient dans une séance ou deux", () => {
    for (const kind of ["sessions", "lessons", "games", "gameWins", "perfect"] as const) {
      expect(missionTarget(kind, "daily", { dailyGoalMin: 20 })).toBeLessThanOrEqual(2);
    }
  });

  it("borne la progression à la cible et sait quand c'est fini", () => {
    const [mission] = generateMissions(periodOf("weekly", now), { exclude: [] });
    expect(mission).toBeDefined();
    const over = { [mission!.metric]: mission!.target * 3 };
    expect(missionProgress(mission!, over)).toBe(mission!.target);
    expect(missionDone(mission!, over)).toBe(true);
    expect(missionDone(mission!, {})).toBe(false);
    expect(missionProgress(mission!, { [mission!.metric]: -5 })).toBe(0);
  });

  it("récompense davantage les périodes longues, et seules elles donnent un coffre", () => {
    const [daily, weekly, monthly] = currentMissions(now).map(({ missions }) => missions[0]!);
    expect(daily!.reward.coins).toBeLessThan(weekly!.reward.coins);
    expect(weekly!.reward.coins).toBeLessThan(monthly!.reward.coins);
    expect(daily!.reward.chest).toBeNull();
    expect(monthly!.reward.chest).toBe("jade");
  });

  it("ne promet jamais d'XP : le serveur la réécrit, une récompense locale s'évaporerait", () => {
    for (const { missions } of currentMissions(now)) {
      for (const mission of missions) expect(mission.reward).not.toHaveProperty("xp");
    }
  });
});

describe("trophées", () => {
  const input = { totals: { sessions: 10, xp: 0 }, bestStreak: 0, knownWords: 0 };

  it("a trois paliers croissants par famille", () => {
    for (const trophy of TROPHIES) expect(trophyByCode(trophy.code)).toEqual(trophy);
    const sessions = TROPHIES.filter((t) => t.family === "sessions");
    expect(sessions.map((t) => t.target)).toEqual([...sessions.map((t) => t.target)].sort((a, b) => a - b));
  });

  it("donne les paliers atteints, jamais deux fois le même", () => {
    const first = evaluateTrophies(input, new Set());
    expect(first.map((t) => t.code)).toEqual(["sessions_t1"]);
    expect(evaluateTrophies(input, new Set(["sessions_t1"]))).toEqual([]);
  });

  it("rend tous les paliers franchis d'un coup", () => {
    const codes = evaluateTrophies({ ...input, totals: { sessions: 250 } }, new Set()).map((t) => t.code);
    expect(codes).toEqual(["sessions_t1", "sessions_t2", "sessions_t3"]);
  });

  it("lit la série et les mots connus hors des compteurs", () => {
    expect(trophyValue("streak", { ...input, bestStreak: 42 })).toBe(42);
    expect(trophyValue("words", { ...input, knownWords: 120 })).toBe(120);
    expect(trophyValue("sessions", input)).toBe(10);
  });

  it("connaît le palier le plus haut d'une famille", () => {
    expect(trophyTierOf("sessions", new Set(["sessions_t1", "sessions_t2"]))).toBe(2);
    expect(trophyTierOf("xp", new Set())).toBe(0);
  });
});

describe("objets à collecter", () => {
  it("a quatre collections de cinq objets, tous d'identifiant unique", () => {
    expect(new Set(COLLECTIBLES.map((item) => item.id)).size).toBe(COLLECTIBLES.length);
    for (const set of COLLECTION_SETS) expect(setProgress(set, new Set()).total).toBe(5);
  });

  it("un coffre ne donne jamais de doublon, et reste déterministe", () => {
    const owned = new Set<string>();
    for (let i = 0; i < COLLECTIBLES.length; i++) {
      const item = openChest(`seed-${i}`, owned, "jade");
      expect(item).not.toBeNull();
      expect(owned.has(item!.id)).toBe(false);
      owned.add(item!.id);
    }
    // Tout est collectionné : le coffre le dit au lieu d'inventer.
    expect(openChest("seed-fin", owned, "jade")).toBeNull();
    expect(openChest("x", new Set(), "jade")).toEqual(openChest("x", new Set(), "jade"));
  });

  it("un coffre de bois reste sur les objets communs tant qu'il en existe", () => {
    expect(openChest("bois", new Set(), "wood")?.rarity).toBe("common");
    // Plus un seul commun disponible : le coffre se rabat au lieu de rendre du vide.
    const commons = new Set(COLLECTIBLES.filter((item) => item.rarity === "common").map((item) => item.id));
    expect(openChest("bois", commons, "wood")).not.toBeNull();
  });

  it("les coffres plus riches versent plus de xu", () => {
    expect(CHEST_COINS.wood).toBeLessThan(CHEST_COINS.lacquer);
    expect(CHEST_COINS.lacquer).toBeLessThan(CHEST_COINS.jade);
  });

  it("reconnaît une collection complète", () => {
    const cho = COLLECTIBLES.filter((item) => item.set === "cho").map((item) => item.id);
    expect(completedSets(new Set(cho))).toEqual(["cho"]);
    expect(completedSets(new Set(cho.slice(1)))).toEqual([]);
    expect(collectibleById(cho[0]!)?.set).toBe("cho");
  });
});

describe("xu", () => {
  it("une séance vide ne rapporte rien", () => {
    expect(coinsForSession({ xp: 0, perfect: true })).toBe(0);
  });

  it("récompense l'XP et le sans-faute, sous un plafond", () => {
    expect(coinsForSession({ xp: 40, perfect: false })).toBeLessThan(coinsForSession({ xp: 40, perfect: true }));
    expect(coinsForSession({ xp: 100_000, perfect: true })).toBe(COINS_SESSION_MAX);
  });

  it("une partie jouée rapporte moins qu'une partie réussie", () => {
    const played = coinsForGame({ correct: 1, total: 5, points: 20, won: false });
    expect(played).toBeGreaterThan(0);
    expect(played).toBeLessThan(coinsForGame({ correct: 5, total: 5, points: 20, won: true }));
    expect(coinsForGame({ correct: 0, total: 0, points: 0, won: false })).toBe(0);
  });

  it("chaque niveau gagné a sa récompense, coffre aux paliers de 5 et 10", () => {
    expect(levelReward(4).chest).toBeNull();
    expect(levelReward(5).chest).toBe("lacquer");
    expect(levelReward(10).chest).toBe("jade");
    expect(levelReward(6).coins).toBeGreaterThan(levelReward(5).coins);
    expect(levelRewards(3, 6).map((r) => r.level)).toEqual([4, 5, 6]);
    expect(levelRewards(6, 6)).toEqual([]);
  });

  it("la série donne un coffre aux jalons, rien entre deux", () => {
    expect(streakChest(7)).toBe("wood");
    expect(streakChest(30)).toBe("jade");
    expect(streakChest(8)).toBeNull();
    expect(streakChest(0)).toBeNull();
  });
});

describe("atelier", () => {
  const base: WardrobeContext = { level: 1, trophies: new Set(), sets: new Set(), purchased: new Set() };

  it("chaque pièce a un emplacement connu et un identifiant unique", () => {
    expect(new Set(WARDROBE.map((item) => item.id)).size).toBe(WARDROBE.length);
    for (const item of WARDROBE) expect(WARDROBE_SLOTS).toContain(item.slot);
  });

  it("chaque emplacement a au moins deux pièces, et les obligatoires une par défaut", () => {
    for (const slot of WARDROBE_SLOTS) expect(WARDROBE.filter((item) => item.slot === slot).length).toBeGreaterThan(1);
    for (const [slot, id] of Object.entries(DEFAULT_OUTFIT)) expect(wardrobeItem(id)?.slot).toBe(slot);
  });

  it("au départ, on ne possède que les pièces de départ", () => {
    expect(new Set(ownedItems(base).map((item) => item.id))).toEqual(new Set(Object.values(DEFAULT_OUTFIT)));
  });

  it("le niveau, le trophée et la collection débloquent ; la boutique attend l'achat", () => {
    const nonLa = wardrobeItem("non_la")!;
    expect(itemState(nonLa, base)).toBe("locked");
    expect(itemState(nonLa, { ...base, level: 3 })).toBe("owned");
    const shop = WARDROBE.find((item) => item.unlock.kind === "shop")!;
    expect(itemState(shop, base)).toBe("buyable");
    expect(itemState(shop, { ...base, purchased: new Set([shop.id]) })).toBe("owned");
    expect(itemPrice(shop)).toBeGreaterThan(0);
    expect(itemPrice(nonLa)).toBeNull();
  });

  it("chaque collection offre une pièce, et une seule", () => {
    for (const set of COLLECTION_SETS) {
      const reward = collectionRewardItem(set);
      expect(reward).not.toBeNull();
      expect(itemState(reward!, base)).toBe("locked");
      expect(itemState(reward!, { ...base, sets: new Set([set]) })).toBe("owned");
    }
  });

  it("déduit les collections terminées des objets possédés", () => {
    const cho = COLLECTIBLES.filter((item) => item.set === "cho").map((item) => item.id);
    expect([...wardrobeContext({ collectibles: cho }).sets]).toEqual(["cho"]);
    expect(wardrobeContext({}).level).toBe(1);
  });

  it("nettoie une tenue : pièce non possédée retirée, emplacement obligatoire rempli", () => {
    expect(sanitizeOutfit({ hat: "non_la", outfit: "ao_dai" }, base)).toEqual(DEFAULT_OUTFIT);
    // Emplacement facultatif : « rien » est une réponse valable, pas un trou à combler.
    expect(sanitizeOutfit({}, base).hat).toBeUndefined();
    expect(sanitizeOutfit({ hat: "non_la" }, { ...base, level: 3 }).hat).toBe("non_la");
    // Une pièce rangée dans le mauvais emplacement est refusée, pas déplacée.
    expect(sanitizeOutfit({ hat: "ao_dai" }, { ...base, level: 20 }).hat).toBeUndefined();
  });

  it("annonce ce qui vient d'être débloqué", () => {
    const after = { ...base, level: 4 };
    expect(new Set(newlyOwned(base, after).map((item) => item.id))).toEqual(new Set(["song_chieu", "non_la", "ao_ba_ba"]));
    expect(newlyOwned(after, after)).toEqual([]);
  });
});
