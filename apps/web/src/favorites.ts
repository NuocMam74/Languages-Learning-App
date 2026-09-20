import type { ContentIndex, LessonStep, Localized } from "@parlo/core";
import { create } from "zustand";
import { activePackCode } from "./packs/active.ts";
import { db, favoriteId, type FavoriteRow } from "./db.ts";

/**
 * Favoris (contrat phase18 §1) : « celui-là, je veux le retrouver ».
 *
 * Tout ce que l'application proposait jusqu'ici était **son** choix à elle : la séance du jour, les
 * mots dus, l'ordre de travail. Rien ne permettait de dire *j'ai aimé cet exercice, je veux le
 * refaire* — et c'est pourtant ce qu'on fait avec une chanson ou une recette.
 *
 * Un favori est un **goût**, pas une progression : il reste sur l'appareil, ne part jamais au
 * serveur, et n'influence ni le SRS ni le parcours. Il voyage en revanche dans le transfert
 * d'appareil (contrat phase17 §1), parce qu'il fait partie de ce qui rend l'application la sienne.
 *
 * Deux granularités, et pas une de plus :
 *   - **une leçon** — on l'a aimée en entier, on veut pouvoir la rejouer ;
 *   - **un exercice** — une étape précise d'une leçon, repérée par son index. C'est la granularité
 *     à laquelle on aime vraiment : « la phrase à assembler sur le marché », pas « l'unité 8 ».
 */

export interface FavoriteTarget {
  lessonId: string;
  /** Absent (ou `undefined`) : la leçon entière. */
  stepIndex?: number | undefined;
}

interface FavoritesState {
  /** Identifiants des favoris de la langue active — `<leçon>` ou `<leçon>#<étape>`. */
  ids: ReadonlySet<string>;
  rows: FavoriteRow[];
  loaded: boolean;
  load: (pack?: string) => Promise<void>;
  toggle: (target: FavoriteTarget, pack?: string) => Promise<boolean>;
}

const idOf = (target: FavoriteTarget) => favoriteId(target.lessonId, target.stepIndex);

export const useFavorites = create<FavoritesState>((set, get) => ({
  ids: new Set<string>(),
  rows: [],
  loaded: false,

  async load(pack = activePackCode()) {
    const rows = await listFavorites(pack);
    set({ rows, ids: new Set(rows.map((r) => r.id)), loaded: true });
  },

  /** Aime ou retire, et rend l'état d'après — ce que le bouton affiche tout de suite. */
  async toggle(target, pack = activePackCode()) {
    const id = idOf(target);
    const liked = !get().ids.has(id);
    if (liked) {
      await db().favorites.put({
        id,
        packCode: pack,
        kind: target.stepIndex === undefined ? "lesson" : "step",
        lessonId: target.lessonId,
        ...(target.stepIndex === undefined ? {} : { stepIndex: target.stepIndex }),
        addedAt: new Date().toISOString(),
      });
    } else {
      await db().favorites.delete(id);
    }
    await get().load(pack);
    return liked;
  },
}));

/** Favoris d'une langue, du plus récent au plus ancien : on retrouve d'abord ce qu'on vient d'aimer. */
export async function listFavorites(pack = activePackCode()): Promise<FavoriteRow[]> {
  const rows = await db().favorites.where("packCode").equals(pack).toArray();
  return rows.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export async function isFavorite(target: FavoriteTarget, pack = activePackCode()): Promise<boolean> {
  const row = await db().favorites.get(idOf(target));
  return row !== undefined && row.packCode === pack;
}

// ---------------------------------------------------------------------------
// Lecture : de quoi montrer un favori sans rejouer la séance

/** Un favori, replacé dans son contenu : de quoi l'afficher et le rejouer. */
export interface FavoriteView {
  row: FavoriteRow;
  lessonTitle: Localized | null;
  unitTitle: Localized | null;
  /** Étape visée ; absente pour un favori de leçon, ou si le contenu ne la porte plus. */
  step: LessonStep | null;
  /** Ce que l'exercice montre, en une ligne : la phrase à assembler, le mot à reconnaître… */
  preview: string;
}

/**
 * Aperçu d'une étape, en une ligne. On ne rejoue pas l'exercice pour l'afficher — on lit le
 * contenu. Une étape qui n'existe plus (contenu mis à jour) rend une ligne vide plutôt qu'un vide :
 * le favori reste listé, et reste retirable.
 */
export function stepPreview(content: ContentIndex, step: LessonStep | null): string {
  if (!step) return "";
  switch (step.type) {
    case "build_sentence":
      return step.target;
    case "fill_gap":
      return step.text;
    case "translate_to_vi":
      return step.accepted[0] ?? "";
    case "translate_to_fr":
      return step.source;
    case "speak_answer":
      return step.prompt;
    case "listen_pick_image":
    case "listen_pick_text":
    case "listen_transcribe":
    case "tone_identify":
    case "tone_produce":
    case "speak_repeat":
      return content.concepts.get(step.concept)?.vi ?? "";
    case "match_pairs":
      return step.concepts.map((id) => content.concepts.get(id)?.vi ?? "").filter(Boolean).join(" · ");
    case "tone_minimal_pair":
      return step.pair.join(" / ");
    case "culture_card":
      return content.culture.get(step.ref)?.vi ?? "";
    default:
      return "";
  }
}

/** Les favoris de la langue active, replacés dans le contenu, du plus récent au plus ancien. */
export function viewFavorites(content: ContentIndex, rows: readonly FavoriteRow[]): FavoriteView[] {
  const unitOf = new Map<string, Localized>();
  for (const unit of content.curriculum.units) for (const id of unit.lessons) unitOf.set(id, unit.title);

  return rows.map((row) => {
    const lesson = content.lessons.get(row.lessonId);
    const step = row.stepIndex === undefined ? null : (lesson?.steps[row.stepIndex] ?? null);
    return {
      row,
      lessonTitle: lesson?.title ?? null,
      unitTitle: unitOf.get(row.lessonId) ?? null,
      step,
      preview: stepPreview(content, step),
    };
  });
}

/**
 * Les exercices aimés d'une leçon, dans l'ordre où ils s'y trouvent — c'est ainsi qu'on les
 * rejoue, pas dans l'ordre où on les a aimés.
 */
export function likedSteps(rows: readonly FavoriteRow[], lessonId: string): number[] {
  return rows
    .filter((row) => row.lessonId === lessonId && row.stepIndex !== undefined)
    .map((row) => row.stepIndex as number)
    .sort((a, b) => a - b);
}

/** Leçons qui ont au moins un exercice aimé, dans l'ordre du cursus. */
export function lessonsWithLikedSteps(content: ContentIndex, rows: readonly FavoriteRow[]): string[] {
  const withSteps = new Set(rows.filter((r) => r.stepIndex !== undefined).map((r) => r.lessonId));
  return content.curriculum.units.flatMap((unit) => unit.lessons.filter((id) => withSteps.has(id)));
}
