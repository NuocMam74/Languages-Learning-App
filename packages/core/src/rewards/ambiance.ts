import type { Unlock } from "./wardrobe.ts";

/**
 * Ambiances de l'interface (contrat phase24 §3) — **amendement assumé à la spec §13**.
 *
 * La spec fixe six valeurs nommées et interdit les dégradés décoratifs. Elle ne prévoyait pas
 * qu'on puisse acheter l'habillage de l'application. Plutôt que d'ouvrir un sélecteur de couleurs
 * — qui aurait produit, en une semaine, des écrans illisibles et hors charte — une ambiance est un
 * **jeu fermé de quatre décalages**, écrit ici, relu, et contraint par trois règles :
 *
 *  1. **les six valeurs nommées ne bougent pas.** Ngọc reste ngọc, sơn mài reste sơn mài : un
 *     bouton principal, une erreur et une récompense gardent la même couleur d'un bout à l'autre
 *     de l'application, quelle que soit l'ambiance. Ce qui change, ce sont les **surfaces** —
 *     le fond de page, les cartes, la teinte de l'eau derrière le contenu ;
 *  2. **le contraste est vérifié, pas espéré.** Chaque ambiance déclare son fond clair et sombre,
 *     et les tests tiennent le rapport de contraste du texte au-dessus de 4,5:1 dans les deux ;
 *  3. **aucun dégradé décoratif.** Une ambiance est une teinte de surface, pas un papier peint.
 *
 * Conséquence : quatre ambiances, pas quarante. C'est le prix pour que l'application reste la
 * même application.
 */

export const AMBIANCES = ["delta", "hoang_hon", "mua", "tet"] as const;
export type AmbianceId = (typeof AMBIANCES)[number];

/** Les jetons qu'une ambiance a le droit de redéfinir. Rien d'autre n'est modifiable. */
export interface AmbianceTokens {
  /** Fond de page. */
  nuoc: string;
  /** Surface des cartes. */
  surface: string;
  /** Surface discrète (regroupements, champs). */
  surface2: string;
  /** Couleur des rides d'eau du fond (`body::before`). */
  ripple: string;
}

export interface Ambiance {
  id: AmbianceId;
  unlock: Unlock;
  light: AmbianceTokens;
  dark: AmbianceTokens;
}

/**
 * Les quatre ambiances. Les valeurs claires sont des blancs cassés très peu saturés (le texte mực
 * `#14201E` y tient largement AA) ; les sombres sont des gris-vert profonds (le texte `#E9EFEC`
 * y tient tout aussi largement). Les écarts sont volontairement faibles : on veut reconnaître
 * l'ambiance, pas se demander si on a changé d'application.
 */
export const AMBIANCE_LIST: readonly Ambiance[] = [
  {
    // Le delta au matin : l'ambiance d'origine, celle de tous les écrans depuis le début.
    id: "delta",
    unlock: { kind: "start" },
    light: { nuoc: "#F2F6F3", surface: "#FDFEFD", surface2: "#F7FAF8", ripple: "#0E5E55" },
    dark: { nuoc: "#0C1614", surface: "#152420", surface2: "#111D1A", ripple: "#5CC0AF" },
  },
  {
    // Le crépuscule : les surfaces tirent vers le sable chaud, l'eau vers le curcuma.
    id: "hoang_hon",
    unlock: { kind: "shop", price: 400 },
    light: { nuoc: "#F7F3EC", surface: "#FEFDFA", surface2: "#FAF6EE", ripple: "#B07A1A" },
    dark: { nuoc: "#161210", surface: "#241E18", surface2: "#1C1714", ripple: "#D9A94F" },
  },
  {
    // La mousson : gris-bleu, la lumière d'un ciel bas.
    id: "mua",
    unlock: { kind: "shop", price: 400 },
    light: { nuoc: "#EFF3F6", surface: "#FBFDFE", surface2: "#F3F7FA", ripple: "#2C5A78" },
    dark: { nuoc: "#0B1317", surface: "#132026", surface2: "#0F191E", ripple: "#6FB0CE" },
  },
  {
    // Tết : la laque diluée, réservée à ceux qui ont terminé la collection de la fête.
    id: "tet",
    unlock: { kind: "collection", set: "tet" },
    light: { nuoc: "#F8F1F0", surface: "#FFFCFB", surface2: "#FBF3F2", ripple: "#A33A30" },
    dark: { nuoc: "#170F0E", surface: "#261A18", surface2: "#1D1413", ripple: "#E08A7E" },
  },
];

const BY_ID = new Map(AMBIANCE_LIST.map((item) => [item.id, item]));

export const DEFAULT_AMBIANCE: AmbianceId = "delta";

export function ambiance(id: string | undefined | null): Ambiance {
  return (id && BY_ID.get(id as AmbianceId)) || (BY_ID.get(DEFAULT_AMBIANCE) as Ambiance);
}

export function isAmbianceId(value: unknown): value is AmbianceId {
  return typeof value === "string" && BY_ID.has(value as AmbianceId);
}

/** Prix d'une ambiance, ou `null` si elle ne s'achète pas. */
export function ambiancePrice(item: Ambiance): number | null {
  return item.unlock.kind === "shop" ? item.unlock.price : null;
}
