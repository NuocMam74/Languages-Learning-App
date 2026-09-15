import type { BadgeCode } from "@parlo/core";
import type { ReactElement } from "react";

/**
 * Icônes de badges dessinées (spec §5.4 : pas d'emojis). Médaillon en laque,
 * motif au trait ; version éteinte tant que le badge n'est pas gagné.
 */

const MOTIFS: Record<BadgeCode, ReactElement> = {
  // Une barque qui part : la première leçon.
  first_lesson: (
    <g>
      <path d="M14 34h36l-6 8H20z" />
      <path d="M32 34V16l12 14H32" />
      <path d="M10 48c6 3 10 3 16 0s10-3 16 0 10 3 16 0" />
    </g>
  ),
  // Sept vagues de rizière.
  streak_7: (
    <g>
      <path d="M16 44c4-10 8-10 12 0" />
      <path d="M26 44c4-14 8-14 12 0" />
      <path d="M36 44c4-10 8-10 12 0" />
      <text x="32" y="30" textAnchor="middle" fontSize="14" fontWeight="700" stroke="none" fill="currentColor">7</text>
    </g>
  ),
  // Une lune pleine au-dessus du fleuve : un mois.
  streak_30: (
    <g>
      <circle cx="32" cy="26" r="10" />
      <path d="M12 46c6 3 11 3 17 0s11-3 17 0 6 2 6 2" />
      <text x="32" y="30.5" textAnchor="middle" fontSize="11" fontWeight="700" stroke="none" fill="currentColor">30</text>
    </g>
  ),
  // Un embarcadère : première unité parcourue.
  unit_1_done: (
    <g>
      <path d="M14 40h36" />
      <path d="M20 40v10M32 40v10M44 40v10" />
      <path d="M22 32l7 6 13-16" />
    </g>
  ),
  // Une grappe de mots : un panier du marché.
  words_50: (
    <g>
      <path d="M16 30h32l-4 18H20z" />
      <path d="M22 30c0-8 20-8 20 0" />
      <path d="M22 38h20M24 44h16" />
    </g>
  ),
  // Cent jours : trois vagues sous le nombre.
  streak_100: (
    <g>
      <path d="M14 44c4-6 8-6 12 0s8 6 12 0 8-6 12 0" />
      <text x="32" y="33" textAnchor="middle" fontSize="13" fontWeight="700" stroke="none" fill="currentColor">100</text>
    </g>
  ),
  // Un an : le soleil au-dessus du fleuve.
  streak_365: (
    <g>
      <circle cx="32" cy="26" r="8" />
      <path d="M32 12v4M20 16l3 3M44 16l-3 3M16 26h4M44 26h4" />
      <path d="M12 46c6 3 11 3 17 0s11-3 17 0 6 2 6 2" />
    </g>
  ),
  // Une barque pleine de mots : 500 mots.
  words_500: (
    <g>
      <path d="M12 36h40l-7 10H19z" />
      <path d="M20 36v-8h8v8M30 36V24h8v12M40 36v-6h6v6" />
    </g>
  ),
  // Sud : une feuille de cocotier et une flèche vers le bas.
  no_north_accent: (
    <g>
      <path d="M32 14v30" />
      <path d="M24 36l8 8 8-8" />
      <path d="M32 20c-6-4-12-3-16 0M32 20c6-4 12-3 16 0" />
    </g>
  ),
  // Une lanterne : explorateur de culture.
  culture_explorer: (
    <g>
      <path d="M32 12v5" />
      <path d="M22 22h20l3 10-3 10H22l-3-10z" />
      <path d="M26 42v6M38 42v6M28 22v20M36 22v20" />
    </g>
  ),
  // Un chapeau conique : unité culturelle réussie.
  culture_unit: (
    <g>
      <path d="M12 40L32 18l20 22z" />
      <path d="M18 40c4 6 24 6 28 0" />
      <path d="M26 30h12" />
    </g>
  ),
  // Une oreille et un contour tonal.
  tone_ear: (
    <g>
      <path d="M26 46c-6-2-8-8-8-14 0-8 6-14 13-14s13 6 13 13c0 6-5 8-7 11s-2 6-6 6" />
      <path d="M26 32c0-3 2-5 5-5s5 2 5 5-3 4-3 6" />
      <path d="M44 20c3 2 5 5 5 9" />
    </g>
  ),
};

/** Défi de la semaine (badges `challenge_*` du serveur) : un fanion. */
const CHALLENGE_MOTIF = (
  <g>
    <path d="M22 50V14" />
    <path d="M22 16h22l-5 8 5 8H22" />
  </g>
);

export function BadgeIcon({ code, earned, size = 64 }: { code: BadgeCode | string; earned: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={earned ? "text-nuoc" : "text-phu-sa/40"}>
      <circle cx="32" cy="32" r="30" fill={earned ? "var(--color-son-mai)" : "var(--color-ngoc-sang)"} />
      <circle cx="32" cy="32" r="26" fill="none" stroke={earned ? "var(--color-nghe)" : "currentColor"} strokeWidth="1.5" strokeDasharray={earned ? undefined : "3 4"} />
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {(MOTIFS as Record<string, ReactElement>)[code] ?? CHALLENGE_MOTIF}
      </g>
    </svg>
  );
}
