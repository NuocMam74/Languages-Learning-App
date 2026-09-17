import {
  addCounters,
  bumpJournal,
  CHEST_COINS,
  coinsForGame,
  coinsForSession,
  collectionRewardItem,
  completedSets,
  currentMissions,
  DEFAULT_OUTFIT,
  evaluateTrophies,
  itemPrice,
  itemState,
  levelForXp,
  levelName,
  levelRewards,
  localDay,
  missionDone,
  missionProgress,
  newlyOwned,
  normalizeCounters,
  normalizeJournal,
  openChest,
  periodCounters,
  sanitizeOutfit,
  SET_COMPLETION_COINS,
  streakChest,
  wardrobeContext,
  WORLD_COMPLETION_CHEST,
  WORLD_COMPLETION_COINS,
  wardrobeItem,
  type ChestTier,
  type CollectionSet,
  type Counters,
  type CountersJournal,
  type Localized,
  type Mission,
  type MissionKind,
  type Outfit,
  type Pack,
  type Period,
  type WardrobeContext,
  type WardrobeSlot,
} from "@parlo/core";
import { create } from "zustand";
import { db, getKv, setKv } from "../db.ts";
import { getProfile } from "../learner.ts";

/**
 * Récompenses côté PWA (contrat phase9 §1) : **tout est local**, dans une seule clé `kv` globale
 * (`rewards`). Global et pas par langue : c'est une personne, un porte-monnaie, une collection et
 * un personnage — pas une langue (le nom affiché suit la même règle, `profile/identity.ts`).
 *
 * Une seule clé, donc une seule lecture et une seule écriture par gain : pas de moitié d'état
 * enregistrée si l'onglet se ferme entre deux.
 */

export const REWARDS_KEY = "rewards";

export interface EarnedTrophy {
  code: string;
  earnedAt: string;
}

export interface FoundCollectible {
  id: string;
  foundAt: string;
}

export interface RewardsData {
  coins: number;
  /** Total dépensé dans l'atelier (la vitrine le montre : ce n'est pas de l'argent perdu). */
  spent: number;
  trophies: EarnedTrophy[];
  collectibles: FoundCollectible[];
  /** Pièces d'atelier achetées en xu. */
  purchased: string[];
  /** Mondes du cursus terminés (contrat phase11 §3) : chacun offre son paysage. */
  worlds: string[];
  outfit: Outfit;
  /** Compteurs cumulés depuis toujours (trophées). */
  totals: Counters;
  /** Compteurs par jour (missions). */
  journal: CountersJournal;
  /** `missionId` → date de réclamation. */
  claims: Record<string, string>;
  /** Coffres déjà ouverts : sert de graine, pour que deux coffres ne donnent pas le même objet. */
  chests: number;
  /** Dernières valeurs connues, pour évaluer les trophées même hors séance (partie, mission). */
  level: number;
  bestStreak: number;
  knownWords: number;
}

export const emptyRewards = (): RewardsData => ({
  coins: 0,
  spent: 0,
  trophies: [],
  collectibles: [],
  purchased: [],
  worlds: [],
  outfit: { ...DEFAULT_OUTFIT },
  totals: {},
  journal: {},
  claims: {},
  chests: 0,
  level: 1,
  bestStreak: 0,
  knownWords: 0,
});

const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Relit l'état stocké sans jamais faire confiance à sa forme (version ancienne, écriture coupée). */
export function normalizeRewards(raw: unknown): RewardsData {
  const source = (raw ?? {}) as Partial<RewardsData>;
  const dated = <T extends { code?: unknown; id?: unknown }>(list: unknown, key: "code" | "id"): T[] =>
    Array.isArray(list)
      ? list.flatMap((entry) => {
          const row = entry as Record<string, unknown>;
          return typeof row?.[key] === "string" ? [entry as T] : [];
        })
      : [];
  return {
    coins: num(source.coins),
    spent: num(source.spent),
    trophies: dated<EarnedTrophy>(source.trophies, "code"),
    collectibles: dated<FoundCollectible>(source.collectibles, "id"),
    purchased: strings(source.purchased),
    worlds: strings(source.worlds),
    // La tenue est nettoyée à l'affichage (`sanitizeOutfit`) : ici on garde ce qui a été choisi.
    outfit: typeof source.outfit === "object" && source.outfit !== null ? (source.outfit as Outfit) : { ...DEFAULT_OUTFIT },
    totals: normalizeCounters(source.totals),
    journal: normalizeJournal(source.journal),
    claims: typeof source.claims === "object" && source.claims !== null ? (source.claims as Record<string, string>) : {},
    chests: num(source.chests),
    level: Math.max(1, num(source.level, 1)),
    bestStreak: num(source.bestStreak),
    knownWords: num(source.knownWords),
  };
}

export const loadRewardsData = async (): Promise<RewardsData> => normalizeRewards(await getKv<unknown>(REWARDS_KEY, null));

const saveRewardsData = (data: RewardsData): Promise<void> => setKv(REWARDS_KEY, data);

/**
 * XP de **toutes** les langues : c'est elle qui donne le niveau du personnage, comme le chiffre de
 * l'accueil. Lu directement dans `kv` (les totaux sont rangés par pack, `<code>:totals`).
 */
export async function totalXpAllPacks(): Promise<number> {
  const rows = await db().kv.toArray();
  return rows
    .filter((row) => row.key === "totals" || row.key.endsWith(":totals"))
    .reduce((sum, row) => sum + num((row.value as { xp?: unknown } | null)?.xp), 0);
}

// ---------------------------------------------------------------------------
// Félicitations

export type Celebration =
  /** `name` : le nom de tranche du pack (« Người mới »), localisé à l'affichage. */
  | { kind: "level"; level: number; name: Localized | null }
  | { kind: "trophy"; code: string }
  | { kind: "collectible"; id: string }
  | { kind: "set"; set: CollectionSet }
  | { kind: "wardrobe"; itemId: string }
  | { kind: "mission"; period: Mission["period"]; missionKind: MissionKind }
  /** Monde du cursus terminé (contrat phase11 §3) ; `name` vient du contenu, pas de l'i18n. */
  | { kind: "world"; world: string; name: Localized | null }
  | { kind: "coins"; coins: number };

/** Ordre d'apparition (contrat §5) : le plus rare d'abord, la monnaie en dernier. */
const CELEBRATION_ORDER: Celebration["kind"][] = ["world", "mission", "level", "trophy", "collectible", "set", "wardrobe", "coins"];

const sortCelebrations = (list: Celebration[]): Celebration[] =>
  [...list].sort((a, b) => CELEBRATION_ORDER.indexOf(a.kind) - CELEBRATION_ORDER.indexOf(b.kind));

// ---------------------------------------------------------------------------
// Gains

export interface ActivityInput {
  /** Jour local concerné (défaut : aujourd'hui). */
  day?: string;
  /** Ce qui vient de se passer. */
  counters?: Counters;
  /** Xu déjà calculés par l'appelant (séance, partie, mission). */
  coins?: number;
  /** Coffres à ouvrir. */
  chests?: readonly ChestTier[];
  /** Niveau atteint (XP de toutes les langues) : lu tout seul s'il n'est pas fourni. */
  level?: number;
  /** Série courante : donne un coffre aux jalons (7 jours, 30 jours…). */
  streakDays?: number;
  bestStreak?: number;
  knownWords?: number;
  /** Noms de niveaux du pack, pour la carte « niveau gagné ». */
  pack?: Pack;
  /**
   * Mondes terminés à cet instant (contrat phase11 §3) : les nouveaux sont fêtés et récompensés.
   * Le titre vient du cursus — c'est le contenu qui nomme les mondes, pas l'interface.
   */
  worlds?: readonly { id: string; title: Localized }[];
}

const context = (data: RewardsData): WardrobeContext =>
  wardrobeContext({
    level: data.level,
    trophies: data.trophies.map((t) => t.code),
    collectibles: data.collectibles.map((c) => c.id),
    purchased: data.purchased,
    worlds: data.worlds,
  });

/**
 * Applique un gain et rend les félicitations à montrer. Tout le pipeline est ici, dans cet ordre :
 * compteurs, xu, niveaux, série, trophées, coffres, collections terminées, pièces d'atelier.
 *
 * Chaque étape peut en alimenter une suivante (un trophée débloque une pièce, un coffre termine une
 * collection qui en débloque une autre) — d'où l'ordre, et le calcul des pièces d'atelier à la fin,
 * par différence entre l'état d'avant et celui d'après.
 */
export async function awardActivity(input: ActivityInput, now = new Date()): Promise<Celebration[]> {
  const before = await loadRewardsData();
  const day = input.day ?? localDay(now);
  const level = Math.max(before.level, input.level ?? (await totalXpAllPacks().then((xp) => levelForXp(xp).value)));
  const ctxBefore = context(before);

  const data: RewardsData = {
    ...before,
    journal: input.counters ? bumpJournal(before.journal, day, input.counters) : before.journal,
    totals: input.counters ? addCounters(before.totals, input.counters) : before.totals,
    bestStreak: Math.max(before.bestStreak, input.bestStreak ?? 0),
    knownWords: Math.max(before.knownWords, input.knownWords ?? 0),
    level,
  };

  const celebrations: Celebration[] = [];
  let coins = Math.max(0, input.coins ?? 0);
  const chests: ChestTier[] = [...(input.chests ?? [])];

  // Niveaux gagnés : chacun a sa récompense, même si plusieurs tombent d'un coup.
  for (const { level: gained, reward } of levelRewards(before.level, level)) {
    coins += reward.coins;
    if (reward.chest) chests.push(reward.chest);
    celebrations.push({ kind: "level", level: gained, name: input.pack ? levelName(input.pack.levelNames, gained) : null });
  }

  // Mondes terminés : la plus grande boucle de l'app, donc la plus grosse récompense — et le
  // paysage du monde s'ouvre dans l'atelier (par différence, comme les autres pièces).
  const knownWorlds = new Set(before.worlds);
  for (const world of input.worlds ?? []) {
    if (knownWorlds.has(world.id)) continue;
    data.worlds = [...data.worlds, world.id];
    coins += WORLD_COMPLETION_COINS;
    chests.push(WORLD_COMPLETION_CHEST);
    celebrations.push({ kind: "world", world: world.id, name: world.title });
  }

  // Jalon de série : un coffre, jamais un reproche quand il n'y en a pas.
  const fromStreak = streakChest(input.streakDays ?? 0);
  if (fromStreak) chests.push(fromStreak);

  // Trophées : les paliers franchis par les compteurs qu'on vient d'écrire.
  const earned = new Set(data.trophies.map((t) => t.code));
  const fresh = evaluateTrophies({ totals: data.totals, bestStreak: data.bestStreak, knownWords: data.knownWords }, earned);
  for (const trophy of fresh) {
    data.trophies = [...data.trophies, { code: trophy.code, earnedAt: now.toISOString() }];
    coins += trophy.coins;
    celebrations.push({ kind: "trophy", code: trophy.code });
  }

  // Coffres : déterministes, un objet jamais possédé, jamais de doublon.
  const setsBefore = new Set(completedSets(new Set(data.collectibles.map((c) => c.id))));
  for (const tier of chests) {
    const owned = new Set(data.collectibles.map((c) => c.id));
    const found = openChest(`${data.chests}`, owned, tier);
    data.chests += 1;
    coins += CHEST_COINS[tier];
    if (!found) continue;
    data.collectibles = [...data.collectibles, { id: found.id, foundAt: now.toISOString() }];
    celebrations.push({ kind: "collectible", id: found.id });
  }

  // Collections terminées par ces objets.
  for (const set of completedSets(new Set(data.collectibles.map((c) => c.id)))) {
    if (setsBefore.has(set)) continue;
    coins += SET_COMPLETION_COINS;
    celebrations.push({ kind: "set", set });
  }

  data.coins = before.coins + coins;
  if (coins > 0) celebrations.push({ kind: "coins", coins });

  // Pièces d'atelier : par différence, donc une pièce débloquée par un trophée ou une collection
  // gagnée à l'instant est annoncée dans la même salve.
  for (const item of newlyOwned(ctxBefore, context(data))) celebrations.push({ kind: "wardrobe", itemId: item.id });

  await saveRewardsData(data);
  useRewards.setState({ data, loaded: true });
  return sortCelebrations(celebrations);
}

/** Fin de séance : xu, coffre de série, trophées, niveaux. */
export async function awardSession(input: {
  xp: number;
  perfect: boolean;
  counters: Counters;
  streakDays: number;
  bestStreak: number;
  knownWords: number;
  pack: Pack;
  worlds?: readonly { id: string; title: Localized }[];
  day?: string;
  level?: number;
}, now = new Date()): Promise<Celebration[]> {
  return awardActivity(
    {
      ...(input.day === undefined ? {} : { day: input.day }),
      ...(input.level === undefined ? {} : { level: input.level }),
      ...(input.worlds === undefined ? {} : { worlds: input.worlds }),
      counters: input.counters,
      coins: coinsForSession({ xp: input.xp, perfect: input.perfect }),
      streakDays: input.streakDays,
      bestStreak: input.bestStreak,
      knownWords: input.knownWords,
      pack: input.pack,
    },
    now,
  );
}

/** Fin de partie : xu de la partie, et les compteurs de jeu (missions, trophée « jeux »). */
export async function awardGame(result: { correct: number; total: number; points: number; won: boolean }, now = new Date()): Promise<Celebration[]> {
  return awardActivity(
    {
      counters: { games: 1, ...(result.won ? { gameWins: 1 } : {}) },
      coins: coinsForGame(result),
    },
    now,
  );
}

// ---------------------------------------------------------------------------
// Missions

export interface MissionView {
  mission: Mission;
  progress: number;
  done: boolean;
  claimedAt: string | null;
}

export interface MissionGroup {
  period: Period;
  missions: MissionView[];
}

/** Genres de mission qu'un pack ne peut pas honorer : on ne demande pas l'impossible. */
export function excludedMissionKinds(pack: Pack): MissionKind[] {
  const out: MissionKind[] = [];
  if (!pack.features.includes("tones")) out.push("tones");
  return out;
}

export async function missionGroups(pack: Pack, now = new Date()): Promise<MissionGroup[]> {
  const [data, profile] = await Promise.all([loadRewardsData(), getProfile()]);
  const options = { dailyGoalMin: profile.dailyGoalMin, exclude: excludedMissionKinds(pack) };
  return currentMissions(now, options).map(({ period, missions }) => ({
    period,
    missions: missions.map((mission) => {
      const counters = periodCounters(data.journal, period);
      return {
        mission,
        progress: missionProgress(mission, counters),
        done: missionDone(mission, counters),
        claimedAt: data.claims[mission.id] ?? null,
      };
    }),
  }));
}

/** Missions terminées et pas encore réclamées : ce que la pastille de l'accueil compte. */
export async function claimableCount(pack: Pack, now = new Date()): Promise<number> {
  const groups = await missionGroups(pack, now);
  return groups.reduce((sum, group) => sum + group.missions.filter((view) => view.done && view.claimedAt === null).length, 0);
}

/**
 * Réclame une mission. Vérifie **à nouveau** qu'elle est finie et pas déjà réclamée : c'est la
 * garde, pas le bouton (deux onglets, un double appui).
 */
export async function claimMission(mission: Mission, period: Period, now = new Date()): Promise<Celebration[]> {
  const data = await loadRewardsData();
  if (data.claims[mission.id]) return [];
  if (!missionDone(mission, periodCounters(data.journal, period))) return [];
  await saveRewardsData({ ...data, claims: { ...data.claims, [mission.id]: now.toISOString() } });
  const celebrations = await awardActivity(
    {
      counters: { missions: 1 },
      coins: mission.reward.coins,
      ...(mission.reward.chest ? { chests: [mission.reward.chest] } : {}),
    },
    now,
  );
  return sortCelebrations([{ kind: "mission", period: mission.period, missionKind: mission.kind }, ...celebrations]);
}

// ---------------------------------------------------------------------------
// Atelier

export type PurchaseResult = "bought" | "already" | "tooExpensive" | "unknown";

export async function buyWardrobeItem(itemId: string): Promise<PurchaseResult> {
  const data = await loadRewardsData();
  const item = wardrobeItem(itemId);
  if (!item) return "unknown";
  const state = itemState(item, context(data));
  if (state === "owned") return "already";
  const price = itemPrice(item);
  if (state !== "buyable" || price === null) return "unknown";
  if (data.coins < price) return "tooExpensive";
  const next: RewardsData = { ...data, coins: data.coins - price, spent: data.spent + price, purchased: [...data.purchased, item.id] };
  await saveRewardsData(next);
  useRewards.setState({ data: next, loaded: true });
  return "bought";
}

/** Porte (ou retire) une pièce. La tenue enregistrée est toujours une tenue valide. */
export async function wearWardrobeItem(slot: WardrobeSlot, itemId: string | null): Promise<Outfit> {
  const data = await loadRewardsData();
  const ctx = context(data);
  const wanted: Outfit = { ...data.outfit };
  if (itemId === null) delete wanted[slot];
  else wanted[slot] = itemId;
  const outfit = sanitizeOutfit(wanted, ctx);
  const next = { ...data, outfit };
  await saveRewardsData(next);
  useRewards.setState({ data: next, loaded: true });
  return outfit;
}

// ---------------------------------------------------------------------------
// Lecture réactive (en-têtes, pastilles, atelier)

interface RewardsStore {
  data: RewardsData;
  loaded: boolean;
  load: () => Promise<RewardsData>;
  /** Relit le niveau depuis l'XP de toutes les langues (retour de séance). */
  refreshLevel: () => Promise<void>;
}

export const useRewards = create<RewardsStore>((set, get) => ({
  data: emptyRewards(),
  loaded: false,
  async load() {
    const data = await loadRewardsData();
    set({ data, loaded: true });
    return data;
  },
  async refreshLevel() {
    const level = levelForXp(await totalXpAllPacks()).value;
    const { data } = get();
    if (level <= data.level) return;
    const next = { ...data, level };
    await saveRewardsData(next);
    set({ data: next });
  },
}));

/** Contexte de déblocage de l'état courant : utilisé par l'atelier et le personnage. */
export const rewardsContext = (data: RewardsData): WardrobeContext => context(data);

/** Tenue portée, nettoyée : ce que le personnage dessine réellement. */
export const wornOutfit = (data: RewardsData): Outfit => sanitizeOutfit(data.outfit, context(data));

/** Pièce offerte par une collection (l'atelier l'annonce sur la carte de la collection). */
export const rewardOf = (set: CollectionSet) => collectionRewardItem(set);
