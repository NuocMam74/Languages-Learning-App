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
  // Une oreille et un contour tonal.
  tone_ear: (
    <g>
      <path d="M26 46c-6-2-8-8-8-14 0-8 6-14 13-14s13 6 13 13c0 6-5 8-7 11s-2 6-6 6" />
      <path d="M26 32c0-3 2-5 5-5s5 2 5 5-3 4-3 6" />
      <path d="M44 20c3 2 5 5 5 9" />
    </g>
  ),
};

export function BadgeIcon({ code, earned, size = 64 }: { code: BadgeCode; earned: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={earned ? "text-nuoc" : "text-phu-sa/40"}>
      <circle cx="32" cy="32" r="30" fill={earned ? "var(--color-son-mai)" : "var(--color-ngoc-sang)"} />
      <circle cx="32" cy="32" r="26" fill="none" stroke={earned ? "var(--color-nghe)" : "currentColor"} strokeWidth="1.5" strokeDasharray={earned ? undefined : "3 4"} />
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {MOTIFS[code]}
      </g>
    </svg>
  );
}
