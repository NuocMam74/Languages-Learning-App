import { SCENE_SLOTS, type Scene, type SceneSlot } from "@parlo/core";
import type { ReactElement } from "react";

/**
 * « Ma rive » (contrat phase24 §2). Huit couches en SVG sur une grille de 240×140, du ciel au
 * premier plan : rien à télécharger, rien à traduire, et ça marche hors ligne.
 *
 * Mêmes contraintes que le personnage (`profile/AvatarArt.tsx`), et pour les mêmes raisons :
 *  - palette §13 seulement, en jetons CSS — la rive suit donc le thème sombre **et** l'ambiance ;
 *  - aucun texte dans le dessin, `aria-hidden` : le nom des pièces est écrit à côté ;
 *  - un tracé par pièce, quelques centaines d'octets chacune ;
 *  - **rien ne se recouvre** : chaque emplacement a sa bande de l'image (le ciel en haut, l'eau en
 *    bas, la maison à gauche, la barque à droite), donc deux pièces quelconques cohabitent sans
 *    qu'on ait à tester les combinaisons une par une.
 *
 * L'aménagement reçu est déjà nettoyé (`sanitizeScene`) : ici on ne fait que dessiner.
 */

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/* ------------------------------------------------------------------ Ciels */

const SKIES: Record<string, ReactElement> = {
  // Ciel clair : rien, ou presque — deux nuages au trait.
  troi_trong: (
    <g stroke="var(--color-ngoc)" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.3">
      <path d="M28 26q6-8 14-4t10 4" />
      <path d="M180 18q7-9 16-4t11 4" />
    </g>
  ),
  // Le lever : un disque bas, encore pâle.
  binh_minh: (
    <g>
      <circle cx="196" cy="40" r="16" fill="var(--color-nghe)" opacity="0.45" />
      <g stroke="var(--color-nghe)" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.4">
        <path d="M150 30h22" />
        <path d="M156 44h12" />
      </g>
    </g>
  ),
  // Le crépuscule : le disque plus grand, plus chaud, et les oiseaux qui rentrent.
  hoang_hon: (
    <g>
      <circle cx="190" cy="46" r="22" fill="var(--color-nghe)" opacity="0.7" />
      <g stroke="var(--color-phu-sa)" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.55">
        <path d="M38 24q5-5 10 0" />
        <path d="M52 32q5-5 10 0" />
        <path d="M30 38q4-4 8 0" />
      </g>
    </g>
  ),
  // La nuit : des étoiles, sans lune — la lune écraserait les lanternes.
  troi_sao: (
    <g fill="var(--color-nghe)" opacity="0.75">
      {[
        [34, 20], [62, 34], [96, 16], [128, 30], [158, 20], [186, 36], [212, 22], [78, 48], [146, 48],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />
      ))}
    </g>
  ),
  // L'orage : un ciel bas, la pluie en biais.
  mua_giong: (
    <g>
      <path d="M22 28q10-14 24-6t20 6q12-2 14 8H20q-6-6 2-8z" fill="var(--color-phu-sa)" opacity="0.28" />
      <path d="M150 22q12-16 28-7t22 7q14-2 16 9h-70q-7-7 4-9z" fill="var(--color-phu-sa)" opacity="0.22" />
      <g stroke="var(--color-ngoc)" strokeWidth="1.6" strokeLinecap="round" opacity="0.4">
        {[40, 70, 100, 130, 160, 190].map((x) => (
          <path key={x} d={`M${x} 46l-5 12`} />
        ))}
      </g>
    </g>
  ),
};

/* -------------------------------------------------------------------- Eaux */

const WATERS: Record<string, ReactElement> = {
  nuoc_lang: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.45">
      <path d="M8 118q14-7 28 0t28 0t28 0t28 0t28 0t28 0t28 0" />
      <path d="M22 130q14-7 28 0t28 0t28 0t28 0t28 0" />
    </g>
  ),
  // La marée haute : l'eau monte, les rides se resserrent.
  nuoc_lon: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.5">
      <path d="M8 110q10-6 20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0" />
      <path d="M8 121q10-6 20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0" />
      <path d="M14 132q10-6 20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0" />
    </g>
  ),
  // Les jacinthes d'eau : elles dérivent toujours en radeau.
  luc_binh: (
    <g>
      <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.4">
        <path d="M8 120q14-7 28 0t28 0t28 0t28 0t28 0t28 0t28 0" />
      </g>
      <g fill="var(--color-ngoc)" opacity="0.5">
        {[[46, 126], [62, 132], [80, 124], [150, 130], [168, 124], [186, 131]].map(([x, y]) => (
          <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="7" ry="4" />
        ))}
      </g>
    </g>
  ),
  // Les lotus ouverts : trois fleurs, pas une de plus.
  sen_no: (
    <g>
      <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.4">
        <path d="M8 122q14-7 28 0t28 0t28 0t28 0t28 0t28 0t28 0" />
      </g>
      {[46, 120, 194].map((x) => (
        <g key={x} transform={`translate(${x} 124)`}>
          <ellipse cx="0" cy="4" rx="11" ry="4" fill="var(--color-ngoc)" opacity="0.35" />
          <path d="M0 3c-5-3-8-7-8-10 3 1 6 3 8 6 2-3 5-5 8-6 0 3-3 7-8 10z" fill="var(--color-son-mai)" opacity="0.75" />
        </g>
      ))}
    </g>
  ),
};

/* ------------------------------------------------------------------ Berges */

const BANKS: Record<string, ReactElement> = {
  bo_dat: (
    <path d="M0 104q40-8 80-4t80-2 80-6v14H0z" fill="var(--color-phu-sa)" opacity="0.22" />
  ),
  bo_da: (
    <g>
      <path d="M0 104q40-8 80-4t80-2 80-6v14H0z" fill="var(--color-phu-sa)" opacity="0.22" />
      <g fill="var(--color-phu-sa)" opacity="0.45">
        {[[18, 104], [44, 101], [96, 103], [140, 100], [196, 102]].map(([x, y]) => (
          <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="9" ry="4.5" />
        ))}
      </g>
    </g>
  ),
  // Le ponton : une planche sur deux pieux, qui avance sur l'eau.
  cau_ao: (
    <g>
      <path d="M0 104q40-8 80-4t80-2 80-6v14H0z" fill="var(--color-phu-sa)" opacity="0.22" />
      <g {...stroke} className="text-phu-sa">
        <path d="M96 106h46" />
        <path d="M104 106v16M134 106v16" />
      </g>
    </g>
  ),
  // La rangée de cocotiers penchés : la berge qu'on voit depuis le fleuve.
  bo_dua: (
    <g>
      <path d="M0 104q40-8 80-4t80-2 80-6v14H0z" fill="var(--color-phu-sa)" opacity="0.22" />
      {/* Les deux cocotiers restent sur la berge **gauche** : à droite, l'un d'eux tombait
          exactement sur l'emplacement de l'animal (mesuré en regardant la scène). */}
      <g {...stroke} className="text-ngoc" strokeWidth="2">
        {[22, 46].map((x, i) => (
          <g key={x} transform={`translate(${x} 104) scale(${i === 0 ? 1 : -1} 1)`}>
            <path d="M0 0q-3-16 4-28" />
            <path d="M4 -28q-9-4-14 2M4 -28q10-3 13 4M4 -28q-2-9 4-12" />
          </g>
        ))}
      </g>
    </g>
  ),
};

/* ----------------------------------------------------------------- Maisons */

const HOUSES: Record<string, ReactElement> = {
  // La paillote : un toit, un mur, rien d'autre.
  choi_la: (
    <g {...stroke} className="text-phu-sa" transform="translate(30 62)">
      <path d="M-14 16L0 0l14 16" />
      <path d="M-10 16v14h20V16" />
    </g>
  ),
  // La maison sur pilotis : elle a les pieds dans l'eau, c'est tout le Sud.
  nha_san: (
    <g {...stroke} className="text-phu-sa" transform="translate(34 50)">
      <path d="M-20 18L0 2l20 16" />
      <path d="M-15 18v20h30V18" />
      <path d="M-11 38v10M-2 38v10M7 38v10M14 38v10" />
      <path d="M-4 30h8v8h-8z" strokeWidth="1.8" />
    </g>
  ),
  // Le café de rue : un auvent et deux tabourets.
  quan_nuoc: (
    <g {...stroke} className="text-phu-sa" transform="translate(32 56)">
      <path d="M-20 12h40l-4 10h-32z" />
      <path d="M-16 22v20h32V22" />
      <path d="M-10 42v6M10 42v6" strokeWidth="2" />
      <circle cx="-22" cy="44" r="3.5" />
      <circle cx="22" cy="44" r="3.5" />
    </g>
  ),
  // La maison ancienne : toit à double pente et lanterne au seuil.
  nha_co: (
    <g {...stroke} className="text-phu-sa" transform="translate(36 46)">
      <path d="M-24 20q24-20 48 0" />
      <path d="M-28 20h56" />
      <path d="M-19 20v24h38V20" />
      <path d="M-6 44V30h12v14" />
      <circle cx="19" cy="26" r="3.5" fill="var(--color-son-mai)" stroke="none" opacity="0.8" />
    </g>
  ),
};

/* ----------------------------------------------------------------- Barques */

const BOATS: Record<string, ReactElement> = {
  // Xuồng ba lá : la barque à trois planches, celle du niveau 1.
  xuong_ba_la: (
    <g {...stroke} className="text-muc" transform="translate(166 108)">
      <path d="M-22 0c8 7 36 7 44 0l-7 10h-30z" />
      <path d="M0 0v-12l8 10" strokeWidth="2" />
    </g>
  ),
  // Ghe bầu : la barque ventrue, avec ses deux yeux peints à la proue.
  ghe_bau: (
    <g {...stroke} className="text-muc" transform="translate(164 106)">
      <path d="M-26 0q6 10 22 11t26-11l-8 12h-32z" />
      <path d="M-4 0v-16l10 13" strokeWidth="2" />
      <circle cx="-19" cy="4" r="1.8" fill="currentColor" stroke="none" />
    </g>
  ),
  // La barque du marché : chargée, avec sa perche à échantillons.
  ghe_cho: (
    <g {...stroke} className="text-muc" transform="translate(162 104)">
      <path d="M-28 2q8 10 26 10t28-10l-8 13h-36z" />
      <path d="M6 2v-22" strokeWidth="2" />
      <circle cx="6" cy="-22" r="4" fill="var(--color-nghe)" stroke="none" opacity="0.85" />
      <path d="M-16 2v-8h12v8" strokeWidth="1.8" />
    </g>
  ),
  // Le bateau de passagers : une cabine, une cheminée.
  tau_khach: (
    <g {...stroke} className="text-muc" transform="translate(160 102)">
      <path d="M-32 6q10 10 32 10t32-10l-8 14h-48z" />
      <path d="M-18 6V-6h30v12" />
      <path d="M-10 -6v-9" strokeWidth="2" />
      <path d="M-12 0h6M0 0h6" strokeWidth="1.6" />
    </g>
  ),
};

/* -------------------------------------------------------------- Végétation */

const PLANTS: Record<string, ReactElement> = {
  buoi_chuoi: (
    <g {...stroke} className="text-ngoc" strokeWidth="2" transform="translate(84 104)">
      <path d="M0 0v-22" />
      <path d="M0 -20q-13-2-16 8M0 -20q13-3 16 7M0 -22q-3-10 3-14M0 -22q6-8 12-6" />
    </g>
  ),
  hang_dua: (
    <g {...stroke} className="text-ngoc" strokeWidth="2">
      {[72, 96].map((x, i) => (
        <g key={x} transform={`translate(${x} 104) scale(${i === 0 ? 1 : -1} 1)`}>
          <path d="M0 0q-2-18 3-30" />
          <path d="M3 -30q-10-4-15 3M3 -30q11-3 14 4M3 -30q-2-9 5-12" />
        </g>
      ))}
    </g>
  ),
  khom_tre: (
    <g {...stroke} className="text-ngoc" strokeWidth="2" transform="translate(88 104)">
      {[-8, 0, 8].map((dx, i) => (
        <g key={dx}>
          <path d={`M${dx} 0q${dx / 2}-16 ${dx}-${28 - i * 3}`} />
          <path d={`M${dx + 2} -${18 - i * 2}l6-4M${dx - 2} -${24 - i * 2}l-6-3`} strokeWidth="1.6" />
        </g>
      ))}
    </g>
  ),
  // L'abricotier du Tết : fleurs jaunes, branches nues.
  mai_vang: (
    <g transform="translate(86 104)">
      <g {...stroke} className="text-phu-sa" strokeWidth="2">
        <path d="M0 0v-24" />
        <path d="M0 -14l-10-8M0 -18l11-7M0 -24l-7-8" />
      </g>
      <g fill="var(--color-nghe)" opacity="0.9">
        {[[-11, -23], [12, -26], [-8, -33], [1, -27], [5, -34]].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" />
        ))}
      </g>
    </g>
  ),
};

/* --------------------------------------------------------------- Lumières */

const LIGHTS: Record<string, ReactElement> = {
  // La lampe à huile, posée sur le ponton.
  den_dau: (
    <g transform="translate(120 92)">
      <circle cx="0" cy="0" r="4" fill="var(--color-nghe)" opacity="0.9" />
      <circle cx="0" cy="0" r="9" fill="var(--color-nghe)" opacity="0.18" />
      <path d="M-3 4h6v4h-6z" fill="var(--color-phu-sa)" opacity="0.5" />
    </g>
  ),
  // Les lampions suspendus : une guirlande qui traverse la scène.
  long_den: (
    <g>
      <path d="M52 34q60 14 140 2" stroke="var(--color-phu-sa)" strokeWidth="1.4" fill="none" opacity="0.4" />
      {[[74, 42], [110, 47], [148, 46], [182, 41]].map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <ellipse cx="0" cy="0" rx="5" ry="7" fill="var(--color-son-mai)" opacity="0.8" />
          <path d="M0 7v4" stroke="var(--color-son-mai)" strokeWidth="1.4" opacity="0.6" />
        </g>
      ))}
    </g>
  ),
  // Les lampes de pêche : trois halos sur l'eau.
  den_day: (
    <g>
      {[[62, 116], [128, 122], [196, 114]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="3" fill="var(--color-nghe)" opacity="0.9" />
          <ellipse cx={x} cy={y! + 4} rx="13" ry="4" fill="var(--color-nghe)" opacity="0.16" />
        </g>
      ))}
    </g>
  ),
  // Les lanternes qu'on met à l'eau : elles dérivent, en file.
  hoa_dang: (
    <g>
      {[[58, 124], [92, 128], [134, 124], [176, 129], [210, 123]].map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <path d="M-5 0h10l-2 5h-6z" fill="var(--color-son-mai)" opacity="0.8" />
          <circle cx="0" cy="-3" r="2.6" fill="var(--color-nghe)" />
          <ellipse cx="0" cy="6" rx="9" ry="3" fill="var(--color-nghe)" opacity="0.18" />
        </g>
      ))}
    </g>
  ),
};

/* ---------------------------------------------------------------- Animaux */

const ANIMALS: Record<string, ReactElement> = {
  chuon_chuon: (
    <g {...stroke} className="text-ngoc" strokeWidth="1.8" transform="translate(206 70)">
      <path d="M-7 0h14" />
      <path d="M-2 0q-7-7-12-3M-2 0q-7 7-12 3M2 0q7-7 12-3M2 0q7 7 12 3" />
    </g>
  ),
  co_trang: (
    <g {...stroke} className="text-muc" strokeWidth="2" transform="translate(206 96)">
      <path d="M0 8V-2q0-6 6-7" />
      <path d="M6 -9l5 2-5 2z" fill="currentColor" />
      <path d="M0 8l-4 4M0 8l4 4" />
      <path d="M-2 2q8-3 12 2" />
    </g>
  ),
  ca_loi: (
    <g {...stroke} className="text-ngoc" strokeWidth="2" transform="translate(206 120)">
      <path d="M-9 0q6-6 12 0t-12 0z" />
      <path d="M-9 0l-6-4v8z" />
    </g>
  ),
  trau_nuoc: (
    <g {...stroke} className="text-phu-sa" strokeWidth="2.2" transform="translate(200 112)">
      <path d="M-14 4q6-8 16-6t12 6" />
      <path d="M-14 4q-4-5 0-8M14 4q4-5 0-8" />
      <path d="M-16 -6q-6-4-4-8 4 0 6 5M16 -6q6-4 4-8-4 0-6 5" />
    </g>
  ),
};

const LAYERS: Record<SceneSlot, Record<string, ReactElement>> = {
  sky: SKIES,
  water: WATERS,
  bank: BANKS,
  house: HOUSES,
  boat: BOATS,
  plant: PLANTS,
  light: LIGHTS,
  animal: ANIMALS,
};

/** Une pièce seule, cadrée sur sa bande : la vignette de la boutique et de l'aménagement. */
export function ScenePreview({ slot, itemId, size = 64 }: { slot: SceneSlot; itemId: string; size?: number }) {
  const art = LAYERS[slot][itemId];
  if (!art) return null;
  // Chaque emplacement occupe une région connue du dessin : on y zoome plutôt que de montrer une
  // pièce perdue dans une scène vide.
  const box: Record<SceneSlot, string> = {
    sky: "10 6 220 60",
    water: "0 96 240 44",
    bank: "0 64 240 62",
    house: "0 36 84 76",
    boat: "118 78 106 44",
    plant: "52 66 60 46",
    light: "40 26 170 110",
    animal: "176 56 64 76",
  };
  return (
    <svg viewBox={box[slot]} width={size} height={size} aria-hidden className="overflow-hidden rounded-card bg-surface-2 text-muc">
      {art}
    </svg>
  );
}

/**
 * La rive entière. `size` ne pilote que la largeur : le rapport est fixe (12/7), donc rien ne se
 * décale quand la scène arrive après le premier rendu (CLS).
 */
export function SceneArt({ scene, className = "", rounded = true }: { scene: Scene; className?: string; rounded?: boolean }) {
  return (
    <svg
      viewBox="0 0 240 140"
      aria-hidden
      className={`w-full text-muc ${rounded ? "overflow-hidden rounded-card" : ""} ${className}`}
      data-scene-art=""
    >
      <rect x="0" y="0" width="240" height="140" fill="var(--color-surface-2)" />
      {SCENE_SLOTS.map((slot) => {
        const itemId = scene[slot];
        const art = itemId ? LAYERS[slot][itemId] : undefined;
        return <g key={slot}>{art}</g>;
      })}
    </svg>
  );
}

/** La pièce existe-t-elle vraiment en dessin ? (garde des tests de contenu). */
export const hasSceneArt = (slot: SceneSlot, itemId: string): boolean => LAYERS[slot][itemId] !== undefined;
