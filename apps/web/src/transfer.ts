import { mergeCards, type SrsCard } from "@parlo/core";
import { db, type FavoriteRow, type KeyValue, type LessonProgressRow, type NoteRow, type StoredSrsCard } from "./db.ts";
import { clearLearningData } from "./learner.ts";
import { readPrefs, writePrefs, type PrefsValue } from "./prefs.ts";

/**
 * Changer d'appareil (contrat phase17 §1) : emporter sa progression, la reposer ailleurs.
 *
 * Toute la vie d'un apprenant tient sur son appareil — et pour un invité, **uniquement** là. Sans
 * compte, changer de téléphone revenait à tout perdre : la série, les cartes de révision, les
 * leçons acquises, les notes, le personnage habillé. Un compte sauve la progression envoyée au
 * serveur, mais pas les notes personnelles (qui ne partent jamais, contrat phase8 §3) ni les
 * réglages de l'appareil.
 *
 * Ce module produit un fichier unique, lisible, versionné, et sait le relire.
 *
 * **Ce qu'il emporte** : les cartes de révision, la progression des leçons, les notes, et tout ce
 * que `kv` contient par langue — profil, totaux, série, badges, placement, statistiques, examens,
 * récompenses et tenue du personnage, fiches conseils lues, records des jeux — plus les
 * préférences de l'appareil (langue d'interface, thème, mode silencieux, sons, dictée).
 *
 * **Ce qu'il n'emporte pas**, et pourquoi :
 *   - la **session de connexion** : un fichier ne peut pas transporter une identité. On se
 *     reconnecte sur le nouvel appareil ; le serveur y renvoie ce qu'il avait. Le fichier, lui,
 *     couvre ce que le serveur n'a pas ;
 *   - la **file d'envoi** (`outbox`) et le **journal de synchronisation** : ce sont des événements
 *     en attente pour *cet* appareil. Les rejouer ailleurs compterait deux fois la même séance ;
 *   - la **séance en cours** : elle est liée à une version de contenu et à un instant. On la
 *     recommence, ce n'est pas une perte de progression ;
 *   - les **packs téléchargés** : des dizaines de mégaoctets qui se retéléchargent. Un fichier de
 *     transfert doit pouvoir s'envoyer par message.
 */

/** Une version, et la garantie qu'on refusera d'ouvrir un format qu'on ne comprend pas. */
export const TRANSFER_VERSION = 1;

export interface TransferTables {
  srsCards: StoredSrsCard[];
  lessonProgress: LessonProgressRow[];
  /** Lignes `kv` telles quelles : leurs clés portent déjà la langue (`vi-south:profile`). */
  kv: KeyValue[];
  notes: NoteRow[];
  /** Favoris (contrat phase18 §1) : un goût, qui fait partie de ce qu'on emporte. */
  favorites: FavoriteRow[];
}

export interface TransferFile {
  app: "parlo";
  kind: "transfer";
  version: number;
  exportedAt: string;
  prefs: PrefsValue;
  tables: TransferTables;
}

/** Ce qu'on montre avant d'écrire quoi que ce soit : de quoi comparer le fichier et l'appareil. */
export interface TransferSummary {
  /** Une ligne par langue apprise, dans l'ordre des clés. */
  packs: { code: string; xp: number; lessons: number; cards: number }[];
  notes: number;
  /** Totaux, pour une comparaison d'un coup d'œil. */
  xp: number;
  lessons: number;
}

/**
 * Clés `kv` que le transfert laisse sur place. `account` porte l'identité connectée de **cet**
 * appareil : l'importer afficherait un compte sans session derrière. `activePack` est un choix
 * local — on ne change pas la langue affichée sous les pieds de quelqu'un.
 */
const KEPT_LOCAL = new Set(["account", "activePack"]);

const packOfKey = (key: string): string => (key.includes(":") ? (key.split(":")[0] ?? "") : "");

/** Résumé d'un jeu de tables, calculé — jamais lu dans le fichier : un fichier ne s'auto-certifie pas. */
export function summarize(tables: TransferTables): TransferSummary {
  const byPack = new Map<string, { xp: number; lessons: number; cards: number }>();
  const bucket = (code: string) => {
    const found = byPack.get(code);
    if (found) return found;
    const fresh = { xp: 0, lessons: 0, cards: 0 };
    byPack.set(code, fresh);
    return fresh;
  };

  for (const row of tables.kv) {
    if (!row.key.endsWith(":totals")) continue;
    const xp = (row.value as { xp?: unknown } | null)?.xp;
    if (typeof xp === "number") bucket(packOfKey(row.key)).xp = xp;
  }
  for (const row of tables.lessonProgress) bucket(row.packCode ?? "").lessons++;
  for (const card of tables.srsCards) bucket(card.packCode ?? "").cards++;

  const packs = [...byPack.entries()]
    .filter(([code]) => code !== "")
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    packs,
    notes: tables.notes.length,
    xp: packs.reduce((sum, p) => sum + p.xp, 0),
    lessons: packs.reduce((sum, p) => sum + p.lessons, 0),
  };
}

export async function buildTransfer(now = new Date()): Promise<TransferFile> {
  const d = db();
  const [srsCards, lessonProgress, kv, notes, favorites] = await Promise.all([
    d.srsCards.toArray(),
    d.lessonProgress.toArray(),
    d.kv.toArray(),
    d.notes.toArray(),
    d.favorites.toArray(),
  ]);
  return {
    app: "parlo",
    kind: "transfer",
    version: TRANSFER_VERSION,
    exportedAt: now.toISOString(),
    prefs: readPrefs(),
    tables: { srsCards, lessonProgress, kv: kv.filter((row) => !KEPT_LOCAL.has(row.key)), notes, favorites },
  };
}

export type TransferError = "unreadable" | "not_parlo" | "too_new" | "empty";

/**
 * Relit un fichier, sans rien écrire. Chaque refus a son motif, parce que « fichier invalide » ne
 * dit pas à quelqu'un s'il s'est trompé de fichier ou s'il doit mettre l'application à jour.
 */
export function parseTransfer(text: string): { file: TransferFile } | { error: TransferError } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "unreadable" };
  }
  if (typeof raw !== "object" || raw === null) return { error: "unreadable" };
  const value = raw as Partial<TransferFile>;
  if (value.app !== "parlo" || value.kind !== "transfer") return { error: "not_parlo" };
  if (typeof value.version !== "number" || value.version > TRANSFER_VERSION) return { error: "too_new" };

  const tables = value.tables;
  if (typeof tables !== "object" || tables === null) return { error: "unreadable" };
  const arrays = {
    srsCards: Array.isArray(tables.srsCards) ? tables.srsCards : null,
    lessonProgress: Array.isArray(tables.lessonProgress) ? tables.lessonProgress : null,
    kv: Array.isArray(tables.kv) ? tables.kv : null,
    notes: Array.isArray(tables.notes) ? tables.notes : null,
    // Ajoutés après la version 1 du format : un fichier plus ancien n'en a pas, et c'est valide.
    favorites: Array.isArray(tables.favorites) ? tables.favorites : [],
  };
  if ([arrays.srsCards, arrays.lessonProgress, arrays.kv, arrays.notes].some((a) => a === null)) return { error: "unreadable" };

  const clean: TransferTables = {
    srsCards: arrays.srsCards!.filter((c): c is StoredSrsCard => typeof (c as StoredSrsCard)?.conceptId === "string"),
    lessonProgress: arrays.lessonProgress!.filter((r): r is LessonProgressRow => typeof (r as LessonProgressRow)?.lessonId === "string"),
    kv: arrays.kv!.filter((r): r is KeyValue => typeof (r as KeyValue)?.key === "string" && !KEPT_LOCAL.has((r as KeyValue).key)),
    notes: arrays.notes!.filter((n): n is NoteRow => typeof (n as NoteRow)?.id === "string"),
    favorites: arrays.favorites.filter((f): f is FavoriteRow => typeof (f as FavoriteRow)?.id === "string" && typeof (f as FavoriteRow)?.lessonId === "string"),
  };
  if (clean.srsCards.length + clean.lessonProgress.length + clean.kv.length + clean.notes.length + clean.favorites.length === 0) {
    return { error: "empty" };
  }
  return {
    file: {
      app: "parlo",
      kind: "transfer",
      version: value.version,
      exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
      prefs: value.prefs as PrefsValue,
      tables: clean,
    },
  };
}

/** Ce que l'appareil a aujourd'hui, dans la même forme — pour le mettre en regard du fichier. */
export async function localSummary(): Promise<TransferSummary> {
  const { tables } = await buildTransfer();
  return summarize(tables);
}

export type TransferMode =
  /** Remplace : l'appareil repart de ce que dit le fichier. Le geste d'un changement d'appareil. */
  | "replace"
  /** Fusionne : on garde, pour chaque mot et chaque leçon, l'état le plus avancé des deux. */
  | "merge";

/**
 * Repose un transfert sur cet appareil.
 *
 * `replace` efface d'abord les données d'apprentissage locales (`clearLearningData`, déjà utilisé à
 * la déconnexion) : c'est le cas normal, on arrive sur un appareil neuf et on veut retrouver
 * exactement son état. `merge` est là pour qui a déjà joué des deux côtés — il ne perd jamais rien,
 * au prix d'un résultat moins lisible.
 *
 * Les contenus téléchargés ne sont pas touchés : ils se retéléchargeront ou sont déjà là.
 */
export async function applyTransfer(file: TransferFile, mode: TransferMode = "replace"): Promise<TransferSummary> {
  if (mode === "replace") await clearLearningData();
  const d = db();

  await d.transaction("rw", [d.srsCards, d.lessonProgress, d.kv, d.notes, d.favorites], async () => {
    for (const incoming of file.tables.srsCards) {
      const existing = mode === "merge" ? await d.srsCards.get(incoming.conceptId) : undefined;
      // `mergeCards` est la résolution de conflit du SRS (ADR 0003) : l'état le plus avancé gagne.
      // La même règle sert à la synchronisation — un transfert n'est qu'une synchronisation à la main.
      const card: StoredSrsCard = existing ? { ...incoming, ...mergeCards(existing as SrsCard, incoming as SrsCard) } : incoming;
      await d.srsCards.put(card);
    }

    for (const incoming of file.tables.lessonProgress) {
      const existing = mode === "merge" ? await d.lessonProgress.get(incoming.lessonId) : undefined;
      await d.lessonProgress.put(existing ? betterProgress(existing, incoming) : incoming);
    }

    for (const row of file.tables.kv) {
      if (KEPT_LOCAL.has(row.key)) continue;
      if (mode === "merge" && row.key.endsWith(":totals")) {
        const existing = await d.kv.get(row.key);
        await d.kv.put(existing ? { key: row.key, value: richerTotals(existing.value, row.value) } : row);
        continue;
      }
      await d.kv.put(row);
    }

    // Un favori n'a pas d'état à arbitrer : on l'a aimé ou non. Le plus ancien « aimé » gagne,
    // pour que la date reste celle du vrai premier coup de cœur.
    for (const favorite of file.tables.favorites) {
      const existing = mode === "merge" ? await d.favorites.get(favorite.id) : undefined;
      await d.favorites.put(existing && existing.addedAt < favorite.addedAt ? existing : favorite);
    }

    for (const note of file.tables.notes) {
      const existing = mode === "merge" ? await d.notes.get(note.id) : undefined;
      // Deux versions d'une note : la plus récemment modifiée gagne.
      await d.notes.put(existing && (existing.updatedAt ?? "") > (note.updatedAt ?? "") ? existing : note);
    }
  });

  if (file.prefs) writePrefs(file.prefs);
  return summarize(file.tables);
}

/** De deux passages sur la même leçon, on garde le meilleur — une maîtrise ne se reperd jamais. */
function betterProgress(a: LessonProgressRow, b: LessonProgressRow): LessonProgressRow {
  return {
    ...a,
    ...b,
    bestScore: Math.max(a.bestScore ?? 0, b.bestScore ?? 0),
    attempts: Math.max(a.attempts ?? 0, b.attempts ?? 0),
    mastered: a.mastered === true || b.mastered === true,
    // Première fois qu'elle a été terminée : la plus ancienne des deux dates.
    completedAt: [a.completedAt, b.completedAt].filter(Boolean).sort()[0] ?? b.completedAt,
  };
}

/** Totaux d'une langue : on ne descend jamais. */
function richerTotals(a: unknown, b: unknown): unknown {
  if (typeof a !== "object" || a === null) return b;
  if (typeof b !== "object" || b === null) return a;
  const left = a as { xp?: number };
  const right = b as { xp?: number };
  return (right.xp ?? 0) >= (left.xp ?? 0) ? { ...left, ...right } : { ...right, ...left };
}
