import { trophyByCode, type Rarity, type TrophyFamily, type TrophyTier } from "@parlo/core";
import type { ReactElement } from "react";

/**
 * Dessins des récompenses (contrat phase9 §2 ; spec §5.4 : jamais d'emoji).
 *
 * Deux familles de médaillons, du même trait que les badges (`components/BadgeIcon.tsx`) :
 *  - un **trophée** : une coupe, un motif de famille, et un anneau dont la couleur dit le palier ;
 *  - un **objet de collection** : le motif seul sur une pastille, éteint tant qu'on ne l'a pas.
 *
 * Aucun dessin ne porte d'information à lui seul : chacun est toujours accompagné d'un texte
 * (`aria-hidden` par construction).
 */

/* ------------------------------------------------------------------ Trophées */

/** Couleur d'un palier : cuivre, argent, or. Le palier se lit aussi au nombre d'anneaux. */
const TIER_COLOR: Record<TrophyTier, string> = { 1: "#a4642f", 2: "#93a3a0", 3: "var(--color-nghe)" };

const FAMILY_MOTIF: Record<TrophyFamily, ReactElement> = {
  // Des séances empilées : trois traits, comme des jours cochés.
  sessions: (
    <g>
      <path d="M25 26h14M25 32h14M25 38h9" />
    </g>
  ),
  // L'XP : une étoile simple.
  xp: (
    <g>
      <path d="M32 22l3.4 7 7.6 1.1-5.5 5.3 1.3 7.6L32 39.4 24.2 43l1.3-7.6-5.5-5.3 7.6-1.1z" />
    </g>
  ),
  // Les jeux : une manette réduite à sa croix et ses deux boutons.
  games: (
    <g>
      <path d="M26 31v6M23 34h6" />
      <circle cx="39" cy="32" r="1.6" />
      <circle cx="42" cy="36" r="1.6" />
    </g>
  ),
  // Le sans-faute : une coche seule, franche.
  perfect: (
    <g>
      <path d="M22 33l6 7 14-15" />
    </g>
  ),
  // Les missions : une cible.
  missions: (
    <g>
      <circle cx="32" cy="33" r="10" />
      <circle cx="32" cy="33" r="4.5" />
      <path d="M32 33h.01" />
    </g>
  ),
  // Les mots : un panier de marché.
  words: (
    <g>
      <path d="M22 28h20l-3 14H25z" />
      <path d="M26 28c0-6 12-6 12 0" />
    </g>
  ),
  // La série : une flamme.
  streak: (
    <g>
      <path d="M32 21s6 5 6 11a6 6 0 0 1-12 0c0-2.3 1.1-4.1 2.3-5.4.3 1.6 1.2 2.7 2.4 2.7 1.7 0 2.1-2.1 1.3-8" />
    </g>
  ),
  // Les tons : un contour qui monte et descend.
  tones: (
    <g>
      <path d="M21 38c4-12 8 4 11-8s4 10 11 2" />
    </g>
  ),
};

/**
 * Médaillon d'un trophée. `earned` éteint le dessin sans le remplacer : on voit ce qu'on n'a pas
 * encore — un cadenas muet n'apprend rien (contrat §4).
 */
export function TrophyIcon({ code, earned, size = 64 }: { code: string; earned: boolean; size?: number }) {
  const trophy = trophyByCode(code);
  if (!trophy) return null;
  const color = TIER_COLOR[trophy.tier];
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={earned ? "text-nuoc" : "text-phu-sa/40"} data-tier={trophy.tier}>
      <circle cx="32" cy="32" r="30" fill={earned ? "var(--color-surface-ngoc)" : "var(--color-ngoc-sang)"} />
      {/* Autant d'anneaux que de paliers : le palier reste lisible sans la couleur (daltonisme). */}
      {Array.from({ length: trophy.tier }, (_, i) => (
        <circle key={i} cx="32" cy="32" r={27 - i * 2.6} fill="none" stroke={earned ? color : "currentColor"} strokeWidth="1.5" strokeDasharray={earned ? undefined : "3 4"} />
      ))}
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {/* La coupe : le pied et les anses, communs à toutes les familles. */}
        <path d="M27 47h10M32 43v4" opacity="0.85" />
        {FAMILY_MOTIF[trophy.family]}
      </g>
    </svg>
  );
}

/* --------------------------------------------------------- Objets à collecter */

/** Un motif par objet du catalogue (`core/rewards/collection.ts`), grille 40×40. */
const COLLECTIBLE_MOTIF: Record<string, ReactElement> = {
  // Chợ — le marché flottant
  chum_nuoc: <path d="M14 16h12l3 12a9 9 0 0 1-18 0zM17 16c0-4 6-4 6 0" />,
  gio_tre: <path d="M10 16h20l-3 14H13zM14 16v14M20 16v14M26 16v14M11 22h18" />,
  can_can: <path d="M20 10v18M12 14h16M12 14l-3 7h6zM28 14l-3 7h6zM15 30h10" />,
  non_la: <path d="M6 28L20 9l14 19zM10 28c4 5 16 5 20 0M16 20h8" />,
  ghe_cho: <path d="M6 24c8 4 20 4 28 0l-5 8H11zM20 24V8l10 12" />,
  // Sông — le fleuve
  mai_ghe: <path d="M10 30L28 12M26 8l6 6-5 2-3-3z M10 30l-3 3" />,
  luoi_ca: <path d="M8 12h24l-4 18H12zM8 12l6 18M20 12v18M32 12l-6 18M10 21h20" />,
  den_bao: <path d="M20 8v4M13 12h14l2 8-2 10H13l-2-10zM16 30v4M24 30v4" />,
  hoa_sen: <path d="M20 30c-6 0-10-4-10-9 4 0 7 2 9 5 1-6 1-10 1-14 0 4 0 8 1 14 2-3 5-5 9-5 0 5-4 9-10 9z" />,
  cau_tre: <path d="M4 26c8-10 24-10 32 0M10 22v8M20 18v12M30 22v8M4 32h32" />,
  // Tết — la fête
  bao_do: <path d="M10 10h20v22H10zM10 10l10 8 10-8M20 22v6" />,
  long_den: <path d="M20 6v4M12 10h16l2 8-2 8H12l-2-8zM16 26v5M24 26v5M20 10v16" />,
  mai_vang: <path d="M20 20l-8-8M20 20l8-8M20 20v10M20 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 12a3 3 0 1 0 0 6M28 12a3 3 0 1 1 0 6" />,
  trong_com: <path d="M12 12h16v16H12zM12 12c0-3 16-3 16 0M12 28c0 3 16 3 16 0M8 16v8M32 16v8" />,
  mua_lan: <path d="M8 24c0-8 6-14 12-14s12 6 12 14M12 20h4M24 20h4M14 26c4 4 8 4 12 0M20 10V6" />,
  // Bếp — la cuisine
  to_pho: <path d="M6 18h28a14 14 0 0 1-28 0M4 32h32M16 14c2-2 2-4 0-6M24 14c2-2 2-4 0-6" />,
  am_tra: <path d="M10 16h16v10a8 8 0 0 1-16 0zM26 20h4a3 3 0 0 1 0 6h-4M14 16V9h8v7M8 34h20" />,
  ca_phe_phin: <path d="M12 8h16v6H12zM14 14h12v8H14zM17 22h6v4h-6zM12 30h16" />,
  banh_mi: <path d="M6 24c0-6 6-10 14-10s14 4 14 10c0 3-6 4-14 4S6 27 6 24M13 18l2 4M20 17l2 4M27 18l2 4" />,
  noi_dat: <path d="M8 16h24l-3 14H11zM8 16c0-3 24-3 24 0M20 8v4M16 12h8" />,
};

/**
 * Pastille d'un objet. Éteinte, elle garde sa silhouette : la collection montre ce qui manque,
 * jamais une case vide.
 */
export function CollectibleIcon({ id, owned, rarity = "common", size = 48 }: { id: string; owned: boolean; rarity?: Rarity; size?: number }) {
  const motif = COLLECTIBLE_MOTIF[id];
  const ring = rarity === "legendary" ? "var(--color-nghe)" : rarity === "rare" ? "var(--color-son-mai)" : "var(--color-ngoc)";
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden className={owned ? "text-ngoc" : "text-phu-sa/35"} data-owned={owned || undefined}>
      <circle cx="20" cy="20" r="19" fill={owned ? "var(--color-surface-2)" : "transparent"} stroke={owned ? ring : "currentColor"} strokeWidth="1.5" strokeDasharray={owned ? undefined : "3 4"} />
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 1) scale(0.88) translate(2.5 1)">
        {motif ?? <circle cx="20" cy="20" r="7" />}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ Le xu */

/** La pièce. Un rond percé, comme les sapèques : reconnaissable à 16 px. */
export function CoinIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={`shrink-0 ${className}`}>
      <circle cx="12" cy="12" r="9" fill="var(--color-nghe)" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="var(--color-surface)" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-nghe-ecrit)" strokeWidth="1.2" />
    </svg>
  );
}

/** Le coffre, pour la carte « tu as ouvert un coffre ». */
export function ChestIcon({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className="text-ngoc">
      <path d="M10 28h44v24H10z" fill="var(--color-surface-2)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M10 28a22 22 0 0 1 44 0" fill="var(--color-ngoc-sang)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M10 38h44" stroke="currentColor" strokeWidth="2.5" />
      <rect x="27" y="33" width="10" height="12" rx="2" fill="var(--color-nghe)" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
