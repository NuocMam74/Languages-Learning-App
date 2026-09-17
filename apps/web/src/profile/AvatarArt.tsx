import { WARDROBE_SLOTS, type Outfit, type WardrobeSlot } from "@parlo/core";
import type { ReactElement } from "react";

/**
 * Le personnage (contrat phase9 §4). Six couches dessinées en SVG, du fond vers le cadre, sur une
 * grille de 120×120 : rien à télécharger, rien à traduire, et ça marche hors ligne.
 *
 * Contraintes tenues :
 *  - palette §13 seulement (jetons CSS, donc le personnage suit le thème sombre) ;
 *  - aucun texte dans le dessin, `aria-hidden` : le nom est écrit à côté ;
 *  - un tracé par pièce, quelques centaines d'octets chacune ;
 *  - le visage n'est **jamais** couvert : un compagnon se pose à côté, un accessoire reste bas.
 *
 * La tenue reçue est déjà nettoyée (`sanitizeOutfit`) : ici on ne fait que dessiner.
 */

/** Trait commun des pièces : la même graisse que les icônes, bouts arrondis. */
const line = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/* --------------------------------------------------------------------- Fonds */

const BACKDROPS: Record<string, ReactElement> = {
  // L'eau claire : deux rides, rien de plus.
  nuoc: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.5">
      <path d="M16 96q12-7 24 0t24 0t24 0" />
      <path d="M26 108q12-7 24 0t24 0" />
    </g>
  ),
  // Le fleuve au crépuscule : un soleil bas derrière l'épaule.
  song_chieu: (
    <g>
      <circle cx="86" cy="44" r="18" fill="var(--color-nghe)" opacity="0.75" />
      <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.55">
        <path d="M12 94q12-7 24 0t24 0t24 0t24 0" />
        <path d="M22 106q12-7 24 0t24 0t24 0" />
      </g>
    </g>
  ),
  // Le marché flottant : deux barques au loin.
  cho_noi: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.55">
      <path d="M10 62c7 3 17 3 24 0l-4 7H14z" />
      <path d="M22 62V49l6 8" />
      <path d="M88 70c6 3 15 3 21 0l-4 6H92z" />
      <path d="M99 70V59l5 7" />
      <path d="M12 98q12-7 24 0t24 0t24 0t24 0" />
    </g>
  ),
  // La rizière : les diguettes en perspective.
  ruong: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.5">
      <path d="M8 74h104M4 92h112M0 110h120" />
      <path d="M40 74v36M80 74v36" opacity="0.6" />
    </g>
  ),

  // --- Paysages des mondes terminés (contrat phase11 §3) : un fond par monde traversé.
  // Rumeur du fleuve (monde 1) : l'eau, et le son qui en monte.
  tieng_song: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.6">
      <path d="M10 88q12-7 24 0t24 0t24 0t24 0" />
      <path d="M18 100q12-7 24 0t24 0t24 0" />
      <path d="M46 40a18 18 0 0 1 28 0M54 50a10 10 0 0 1 12 0" opacity="0.8" />
    </g>
  ),
  // Devant la maison (monde 2) : un seuil, une porte ouverte.
  hien_nha: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
      <path d="M18 54 60 26l42 28" />
      <path d="M28 54v44h64V54" />
      <path d="M48 98V70h24v28" fill="var(--color-nghe)" fillOpacity="0.25" />
      <path d="M8 108h104" />
    </g>
  ),
  // Ruelle (monde 3) : deux murs qui se rapprochent, des fils au-dessus.
  hem_pho: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.55">
      <path d="M6 24v84M114 24v84" />
      <path d="M30 40v68M90 40v68" opacity="0.7" />
      <path d="M6 30q54 14 108 0M6 46q54 12 108 0" opacity="0.6" />
      <circle cx="60" cy="38" r="3" fill="var(--color-nghe)" stroke="none" />
    </g>
  ),
  // Terrasse de café (monde 4) : un guéridon, un verre, un tabouret.
  quan_ca_phe: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
      <path d="M34 66h26l-3 20H37zM47 86v16M38 102h18" />
      <path d="M72 74h16v14H72zM74 88v12M86 88v12" />
      <path d="M8 108h104" />
      <path d="M40 60c2-6 2-10 0-14" opacity="0.8" />
    </g>
  ),
  // Gare routière (monde 5) : un car de nuit, phares allumés.
  ben_xe: (
    <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
      <path d="M20 50h62v38H20z" />
      <path d="M82 60h16l8 12v16H82" />
      <path d="M28 58h16v12H28M52 58h16v12H52" opacity="0.8" />
      <circle cx="38" cy="94" r="7" />
      <circle cx="92" cy="94" r="7" />
      <circle cx="104" cy="74" r="3" fill="var(--color-nghe)" stroke="none" />
    </g>
  ),
  // Nuit de récits (monde 6) : des lanternes suspendues sous les étoiles.
  dem_ke_chuyen: (
    <g>
      <g fill="var(--color-nghe)" opacity="0.75">
        <circle cx="22" cy="24" r="2" />
        <circle cx="96" cy="18" r="2.4" />
        <circle cx="66" cy="14" r="1.8" />
      </g>
      <g stroke="var(--color-nghe)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.85">
        <path d="M0 34q60 16 120 0" />
        <path d="M34 36v8M34 44h-6l-2 10 2 10h12l2-10-2-10h-6M34 64v6" />
        <path d="M84 40v8M84 48h-5l-2 8 2 8h10l2-8-2-8h-5M84 64v6" />
      </g>
      <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.45">
        <path d="M12 102q12-7 24 0t24 0t24 0t24 0" />
      </g>
    </g>
  ),
  // La nuit étoilée : quelques points et un croissant.
  sao_dem: (
    <g>
      <path d="M96 30a13 13 0 1 0 0 22 16 16 0 0 1 0-22" fill="var(--color-nghe)" opacity="0.85" />
      <g fill="var(--color-nghe)" opacity="0.7">
        <circle cx="24" cy="28" r="2.2" />
        <circle cx="46" cy="18" r="1.8" />
        <circle cx="16" cy="52" r="1.8" />
        <circle cx="68" cy="26" r="2" />
      </g>
      <g stroke="var(--color-ngoc)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.45">
        <path d="M14 102q12-7 24 0t24 0t24 0t24 0" />
      </g>
    </g>
  ),
};

/* ---------------------------------------------------------------- Compagnons */

/** À côté, en bas à droite : jamais devant le visage. */
const COMPANIONS: Record<string, ReactElement> = {
  ca_vang: (
    <g {...line} stroke="var(--color-nghe)" strokeWidth="2.5" transform="translate(86 86)">
      <path d="M0 8c5-7 13-7 18 0-5 7-13 7-18 0" />
      <path d="M18 8l6-5v10z" />
      <path d="M6 6h.01" />
    </g>
  ),
  chim_se: (
    <g {...line} stroke="var(--color-son-mai)" strokeWidth="2.5" transform="translate(86 80)">
      <path d="M4 16c0-6 4-10 9-10s9 4 9 10c0 3-4 5-9 5s-9-2-9-5" />
      <path d="M13 6V2M22 16l6-3M9 12h.01" />
      <path d="M8 21l-2 5M18 21l2 5" />
    </g>
  ),
  meo_muop: (
    <g {...line} stroke="var(--color-phu-sa)" strokeWidth="2.5" transform="translate(84 76)">
      <path d="M6 14a8 8 0 0 1 16 0v10H6z" />
      <path d="M6 14l-2-7 6 3M22 14l2-7-6 3" />
      <path d="M11 16h.01M17 16h.01" />
      <path d="M22 24c6 0 8-4 8-8" />
    </g>
  ),
  cho_con: (
    <g {...line} stroke="var(--color-phu-sa)" strokeWidth="2.5" transform="translate(84 76)">
      <path d="M7 16a8 8 0 0 1 16 0v8H7z" />
      <path d="M7 16c-3-2-3-8 0-9l4 4M23 16c3-2 3-8 0-9l-4 4" />
      <path d="M12 18h.01M18 18h.01M15 22v2" />
    </g>
  ),
};

/* --------------------------------------------------------------- Le personnage */

/** Tête, cou, épaules : le socle, identique quelle que soit la tenue. */
const BODY = (
  <g {...line} stroke="var(--color-muc)">
    <circle cx="60" cy="46" r="17" fill="var(--color-surface)" />
    {/* Le visage : deux yeux et un sourire. Rien d'autre — pas de nez, pas de sourcils. */}
    <path d="M54 44h.01M66 44h.01" strokeWidth="3.4" />
    <path d="M54 52c4 3.5 8 3.5 12 0" strokeWidth="2.6" />
    <path d="M60 63v6" />
  </g>
);

/* ------------------------------------------------------------------- Tenues */

const OUTFITS: Record<string, ReactElement> = {
  // Un t-shirt : la ligne d'épaules la plus simple.
  ao_thun: (
    <g {...line} stroke="var(--color-muc)">
      <path d="M40 112V82a14 14 0 0 1 10-13l10-1 10 1a14 14 0 0 1 10 13v30" fill="var(--color-ngoc-sang)" />
      <path d="M50 69l10 8 10-8" />
    </g>
  ),
  // Áo bà ba : la chemise du delta, col droit et boutonnage central.
  ao_ba_ba: (
    <g {...line} stroke="var(--color-muc)">
      <path d="M40 112V82a14 14 0 0 1 10-13l10-1 10 1a14 14 0 0 1 10 13v30" fill="var(--color-surface-2)" />
      <path d="M60 68v44" />
      <path d="M50 70l10-2 10 2" />
      <path d="M55 84h.01M55 96h.01" strokeWidth="3" stroke="var(--color-nghe-ecrit)" />
    </g>
  ),
  // Une chemise : col ouvert, poche.
  ao_so_mi: (
    <g {...line} stroke="var(--color-muc)">
      <path d="M40 112V82a14 14 0 0 1 10-13l10-1 10 1a14 14 0 0 1 10 13v30" fill="var(--color-surface)" />
      <path d="M52 69l8 10 8-10" />
      <path d="M52 69l-3 8M68 69l3 8" />
      <path d="M68 90h8v9h-8z" />
    </g>
  ),
  // Áo dài : la tunique longue, fendue, col montant.
  ao_dai: (
    <g {...line} stroke="var(--color-muc)">
      <path d="M42 112c0-18 2-30 8-38l10-5 10 5c6 8 8 20 8 38" fill="var(--color-ngoc)" />
      <path d="M60 71v41" stroke="var(--color-nuoc)" />
      <path d="M54 70q6-5 12 0" stroke="var(--color-nuoc)" />
      <path d="M48 92q12 6 24 0" stroke="var(--color-nuoc)" opacity="0.8" />
    </g>
  ),
  // Le costume du danseur de lion : écailles et liseré de curcuma.
  ao_lan: (
    <g {...line} stroke="var(--color-muc)">
      <path d="M40 112V82a14 14 0 0 1 10-13l10-1 10 1a14 14 0 0 1 10 13v30" fill="var(--color-son-mai)" />
      <path d="M44 86q8-7 16 0t16 0M44 98q8-7 16 0t16 0" stroke="var(--color-nghe)" strokeWidth="2.5" />
      <path d="M50 69l10 8 10-8" stroke="var(--color-nghe)" />
    </g>
  ),
};

/* ----------------------------------------------------------------- Chapeaux */

const HATS: Record<string, ReactElement> = {
  // Nón lá : le chapeau conique, et sa mentonnière.
  non_la: (
    <g {...line} stroke="var(--color-muc)">
      <path d="M32 34L60 8l28 26z" fill="var(--color-nghe)" />
      <path d="M38 34c8 5 36 5 44 0" />
      <path d="M48 24h24" stroke="var(--color-nghe-ecrit)" strokeWidth="2" />
    </g>
  ),
  // Une casquette.
  mu_luoi_trai: (
    <g {...line} stroke="var(--color-muc)">
      <path d="M43 32a17 17 0 0 1 34 0z" fill="var(--color-ngoc)" />
      <path d="M77 32h14a4 4 0 0 1-4 4H77z" fill="var(--color-ngoc)" />
    </g>
  ),
  // Une couronne de lotus.
  vong_sen: (
    <g {...line} stroke="var(--color-son-mai)" strokeWidth="2.5">
      <path d="M43 32q17-14 34 0" fill="none" />
      <path d="M48 28a4 4 0 1 1 8 0 4 4 0 1 1-8 0M56 24a4 4 0 1 1 8 0 4 4 0 1 1-8 0M64 28a4 4 0 1 1 8 0 4 4 0 1 1-8 0" fill="var(--color-surface)" />
    </g>
  ),
  // Khăn đóng : le turban de cérémonie.
  khan_dong: (
    <g {...line} stroke="var(--color-muc)">
      <path d="M41 34a19 19 0 0 1 38 0z" fill="var(--color-son-mai)" />
      <path d="M44 28q16-8 32 0M46 22q14-7 28 0" stroke="var(--color-nghe)" strokeWidth="2.2" />
    </g>
  ),
};

/* --------------------------------------------------------------- Accessoires */

const ACCESSORIES: Record<string, ReactElement> = {
  // Des lunettes : posées sur les yeux, jamais dessus.
  kinh: (
    <g {...line} stroke="var(--color-muc)" strokeWidth="2.5">
      <circle cx="53" cy="44" r="6" fill="none" />
      <circle cx="67" cy="44" r="6" fill="none" />
      <path d="M59 44h2M43 43l4 1M77 43l-4 1" />
    </g>
  ),
  // Khăn rằn : le foulard à carreaux du Sud, autour du cou.
  khan_ran: (
    <g {...line} stroke="var(--color-son-mai)" strokeWidth="2.5">
      <path d="M48 70q12 9 24 0" fill="none" />
      <path d="M50 74q10 7 20 0" fill="none" opacity="0.8" />
      <path d="M56 72v6M64 72v6" strokeWidth="2" />
    </g>
  ),
  // Un casque : les écouteurs de l'app.
  tai_nghe: (
    <g {...line} stroke="var(--color-ngoc)" strokeWidth="2.5">
      <path d="M43 46a17 17 0 0 1 34 0" fill="none" />
      <path d="M40 46h6v10h-6zM74 46h6v10h-6z" fill="var(--color-ngoc-sang)" />
    </g>
  ),
  // Une branche de mai en fleur, à la boutonnière.
  hoa_mai: (
    <g {...line} stroke="var(--color-nghe)" strokeWidth="2.5">
      <path d="M74 78l-6 8" />
      <path d="M70 74a4 4 0 1 1 8 0 4 4 0 1 1-8 0" fill="var(--color-nghe)" />
      <path d="M78 82a3 3 0 1 1 6 0 3 3 0 1 1-6 0" fill="var(--color-nghe)" />
    </g>
  ),
};

/* --------------------------------------------------------------------- Cadres */

/** Cadres : dessinés **par-dessus** le disque, ils n'empiètent pas sur le personnage. */
const FRAMES: Record<string, ReactElement> = {
  vien_tre: (
    <g fill="none" stroke="var(--color-ngoc)" strokeWidth="3">
      <circle cx="60" cy="60" r="57" />
      <path d="M60 3v8M60 109v8M3 60h8M109 60h8" strokeWidth="4" />
    </g>
  ),
  vien_son_mai: (
    <g fill="none" stroke="var(--color-son-mai)" strokeWidth="4">
      <circle cx="60" cy="60" r="56" />
      <circle cx="60" cy="60" r="50" strokeWidth="1.5" opacity="0.7" />
    </g>
  ),
  vien_ngoc: (
    <g fill="none" stroke="var(--color-ngoc)" strokeWidth="3.5">
      <circle cx="60" cy="60" r="56" />
      <g fill="var(--color-ngoc)" stroke="none">
        <circle cx="60" cy="4" r="4" />
        <circle cx="60" cy="116" r="4" />
        <circle cx="4" cy="60" r="4" />
        <circle cx="116" cy="60" r="4" />
      </g>
    </g>
  ),
  vien_vang: (
    <g fill="none" stroke="var(--color-nghe)" strokeWidth="4.5">
      <circle cx="60" cy="60" r="55" />
      <circle cx="60" cy="60" r="47" strokeWidth="1.5" opacity="0.65" />
      <path d="M60 5l3 6-3 6-3-6z" fill="var(--color-nghe)" stroke="none" />
    </g>
  ),
};

const LAYERS: Record<WardrobeSlot, Record<string, ReactElement>> = {
  backdrop: BACKDROPS,
  companion: COMPANIONS,
  outfit: OUTFITS,
  hat: HATS,
  accessory: ACCESSORIES,
  frame: FRAMES,
};

/** Une pièce seule, pour la vitrine de l'atelier (même dessin, cadré sur la pièce). */
export function WardrobePreview({ slot, itemId, size = 56 }: { slot: WardrobeSlot; itemId: string; size?: number }) {
  const art = LAYERS[slot][itemId];
  if (!art) return null;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden className="text-muc">
      {/* Le socle reste visible pour les pièces qui n'ont de sens que portées (chapeau, accessoire). */}
      {(slot === "hat" || slot === "accessory") && BODY}
      {art}
    </svg>
  );
}

/**
 * Le personnage habillé. `size` pilote tout : il n'y a qu'un dessin, à toutes les tailles
 * (médaillon de 44 px comme portrait de profil).
 */
export function AvatarArt({ outfit, size = 120, className = "" }: { outfit: Outfit; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden
      className={`shrink-0 overflow-hidden rounded-full bg-surface-2 text-muc ${className}`}
      data-avatar-art=""
    >
      {WARDROBE_SLOTS.map((slot) => {
        const itemId = outfit[slot];
        const art = itemId ? LAYERS[slot][itemId] : undefined;
        // Le corps se glisse juste avant la tenue : une tenue se porte, elle ne flotte pas.
        return (
          <g key={slot}>
            {slot === "outfit" && BODY}
            {art}
          </g>
        );
      })}
    </svg>
  );
}

/** Le personnage porte-t-il quelque chose de dessinable ? Sinon, le médaillon d'initiales suffit. */
export function hasAvatarArt(outfit: Outfit): boolean {
  return WARDROBE_SLOTS.some((slot) => {
    const itemId = outfit[slot];
    return itemId !== undefined && LAYERS[slot][itemId] !== undefined;
  });
}
