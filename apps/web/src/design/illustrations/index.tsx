import type { ReactNode } from "react";

/**
 * Illustrations originales (contrat phase8 §1) — delta au lever du jour, barque, marché flottant,
 * lanternes, diplôme, carnet. Dessinées ici en SVG, pas de fichier à télécharger : elles vivent
 * hors ligne, ne coûtent aucune requête et suivent la palette (§13).
 *
 * Règles communes : aucun texte (donc rien à traduire), trait sombre sur fond clair, lisible à
 * 96 px comme en pleine largeur, aucun dégradé décoratif. Chaque dessin tient sous 4 ko.
 *
 * Elles ne portent jamais l'information : toujours doublées d'un titre et d'une phrase — le SVG
 * est `aria-hidden`, l'`Illustration` ne fait que le cadrer.
 */

type Props = { className?: string };

/** Cadre commun : ratio conservé, largeur pilotée par l'appelant, jamais d'à-coup de mise en page. */
export function Illustration({ children, className = "", width = 240, height = 160 }: { children: ReactNode; className?: string; width?: number; height?: number }) {
  return (
    <div className={`w-full ${className}`} style={{ aspectRatio: `${width} / ${height}` }} aria-hidden data-illustration="">
      {children}
    </div>
  );
}

const svg = (className: string) => ({
  viewBox: "0 0 240 160",
  className: `h-full w-full ${className}`,
  fill: "none" as const,
  "aria-hidden": true,
});

const line = { stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/* ------------------------------------------------ Le delta au lever du jour */

/** Accueil et première ouverture : l'eau, le soleil bas, deux cocotiers, une barque au loin. */
export function DeltaDawn({ className = "" }: Props) {
  return (
    <svg {...svg(`text-ngoc ${className}`)}>
      {/* Le soleil : la seule masse pleine, en curcuma. */}
      <circle cx="122" cy="72" r="26" fill="var(--color-nghe)" opacity="0.9" />
      <circle cx="122" cy="72" r="34" stroke="var(--color-nghe)" strokeWidth="2" opacity="0.45" />
      {/* La ligne d'eau, puis ses rides : de plus en plus larges vers nous. */}
      <g {...line} opacity="0.85">
        <path d="M12 100h216" />
        <path d="M34 114q10-7 20 0t20 0" opacity="0.7" />
        <path d="M150 114q10-7 20 0t20 0" opacity="0.7" />
        <path d="M20 132q14-8 28 0t28 0 28 0 28 0 28 0 28 0" opacity="0.55" />
        <path d="M44 148q14-8 28 0t28 0 28 0 28 0" opacity="0.35" />
      </g>
      {/* La barque : la silhouette que l'app garde partout. */}
      <g stroke="var(--color-phu-sa)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M98 100c12 5 32 5 48 0l-9 13h-30z" fill="var(--color-surface)" />
        <path d="M122 100V74l17 20" fill="var(--color-surface)" />
      </g>
      {/* Deux cocotiers, cadrage asymétrique : la page n'est pas un logo centré. */}
      <g stroke="var(--color-phu-sa)" strokeWidth="3" strokeLinecap="round">
        <path d="M32 100c-2-16-5-27-10-36" />
        <path d="M22 64c-8-6-16-5-20-1M22 64c-3-9 1-16 7-21M22 64c9-4 17-1 21 5M22 64c-6-7-7-15-4-21" />
        <path d="M212 100c1-12 3-21 7-29" opacity="0.8" />
        <path d="M219 71c6-5 12-4 15-1M219 71c-2-7 1-12 6-16M219 71c-7-3-13-1-16 4" opacity="0.8" />
      </g>
    </svg>
  );
}

/* --------------------------------------------------------------- La barque */

/** États vides : une barque amarrée, personne à bord — il n'y a rien ici *encore*. */
export function Sampan({ className = "" }: Props) {
  return (
    <svg {...svg(`text-phu-sa ${className}`)}>
      <g {...line}>
        <path d="M66 82c18 7 90 7 108 0l-16 30H82z" fill="var(--color-surface)" />
        <path d="M120 82V44l24 30" fill="var(--color-surface)" />
        <path d="M120 44v-6" />
      </g>
      <g stroke="var(--color-ngoc)" strokeWidth="3" strokeLinecap="round" opacity="0.7">
        <path d="M24 124q16-9 32 0t32 0 32 0 32 0 32 0 32 0" />
        <path d="M44 142q16-9 32 0t32 0 32 0 32 0" opacity="0.6" />
      </g>
      {/* Un piquet d'amarrage : la barque attend. */}
      <path d="M40 76v46M40 76l-8 6" stroke="var(--color-phu-sa)" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

/* ------------------------------------------------------- Le marché flottant */

/** Les jeux : deux barques chargées, des perches, des paniers — ça grouille, ça joue. */
export function FloatingMarket({ className = "" }: Props) {
  return (
    <svg {...svg(`text-phu-sa ${className}`)}>
      {/* Barque du fond, plus petite et plus pâle : il y a de la profondeur. */}
      <g {...line} opacity="0.4">
        <path d="M150 64c12 5 44 5 56 0l-9 16h-38z" />
        <path d="M172 64V44l14 16" />
      </g>
      {/* Barque de devant, chargée de paniers. */}
      <g {...line}>
        <path d="M26 96c24 8 92 8 116 0l-17 28H43z" fill="var(--color-surface)" />
        {/* La perche : c'est elle qui donne le geste. */}
        <path d="M128 100 168 46" />
      </g>
      {/* Les fruits du marché : trois masses pleines, palette du pack. */}
      <g>
        <circle cx="58" cy="86" r="13" fill="var(--color-nghe)" opacity="0.85" />
        <circle cx="84" cy="88" r="10" fill="var(--color-ngoc)" opacity="0.7" />
        <circle cx="106" cy="86" r="12" fill="var(--color-son-mai)" opacity="0.7" />
      </g>
      <g stroke="var(--color-ngoc)" strokeWidth="3" strokeLinecap="round" opacity="0.6">
        <path d="M14 136q16-9 32 0t32 0 32 0 32 0 32 0 32 0" />
        <path d="M34 150q16-8 32 0t32 0 32 0 32 0" opacity="0.6" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------ Les lanternes */

/** La série : trois lanternes allumées, la plus haute pour le jour en cours. */
export function Lanterns({ className = "" }: Props) {
  const lantern = (x: number, y: number, h: number, fill: string, opacity: number) => (
    <g key={x}>
      <path d={`M${x} 10v${y - 10}`} stroke="var(--color-phu-sa)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <path d={`M${x - 20} ${y + 8}h40l6 ${h / 2}-6 ${h / 2}h-40l-6-${h / 2}z`} fill={fill} opacity={opacity} stroke="var(--color-phu-sa)" strokeWidth="3" strokeLinejoin="round" />
      <path d={`M${x} ${y + 8}v${h}`} stroke="var(--color-phu-sa)" strokeWidth="2" opacity="0.35" />
      <path d={`M${x - 8} ${y + h + 8}v10M${x + 8} ${y + h + 8}v10`} stroke="var(--color-phu-sa)" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
    </g>
  );
  return (
    <svg {...svg(className)}>
      {lantern(48, 60, 44, "var(--color-nghe)", 0.5)}
      {lantern(120, 38, 56, "var(--color-son-mai)", 0.75)}
      {lantern(192, 66, 40, "var(--color-nghe)", 0.4)}
    </svg>
  );
}

/* -------------------------------------------------------------- Le diplôme */

/** Examens et certificat : un parchemin roulé, un ruban, un sceau en laque. */
export function Diploma({ className = "" }: Props) {
  return (
    <svg {...svg(`text-phu-sa ${className}`)}>
      <g {...line}>
        <path d="M54 38h132v84H54z" fill="var(--color-surface)" />
        <path d="M54 38c-9 0-9 84 0 84M186 38c9 0 9 84 0 84" fill="var(--color-surface-2)" />
        {/* Les lignes du texte : jamais de vraies lettres (rien à traduire). */}
        <path d="M78 62h84M78 78h84M78 94h52" opacity="0.4" strokeWidth="4" />
      </g>
      <g>
        <circle cx="168" cy="112" r="18" fill="var(--color-son-mai)" opacity="0.85" />
        <path d="M160 128l-6 22 14-8 14 8-6-22" fill="var(--color-son-mai)" opacity="0.6" />
        <path d="M161 112l5 6 11-12" stroke="var(--color-nuoc)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- Le carnet */

/** Les notes : un carnet ouvert et un stylo — c'est à toi d'écrire dedans. */
export function Notebook({ className = "" }: Props) {
  return (
    <svg {...svg(`text-phu-sa ${className}`)}>
      <g {...line}>
        <path d="M120 48c-16-12-38-16-70-14v88c32-2 54 2 70 14 16-12 38-16 70-14V34c-32-2-54 2-70 14z" fill="var(--color-surface)" />
        <path d="M120 48v88" />
        <path d="M68 62h32M68 80h32M68 98h24" opacity="0.35" strokeWidth="4" />
        <path d="M140 62h32M140 80h20" opacity="0.35" strokeWidth="4" />
      </g>
      <g stroke="var(--color-ngoc)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M186 98l16-16 12 12-16 16-18 6z" fill="var(--color-ngoc-sang)" />
        <path d="M194 90l12 12" />
      </g>
    </svg>
  );
}

/* --------------------------------------------------------- Le carnet vierge */

/** Rien à réviser encore : une page blanche posée sur l'eau, pas un écran vide. */
export function BlankPage({ className = "" }: Props) {
  return (
    <svg {...svg(`text-phu-sa ${className}`)}>
      <g {...line}>
        <path d="M76 26h68l24 24v84H76z" fill="var(--color-surface)" />
        <path d="M144 26v24h24" />
        <path d="M96 76h48M96 94h48M96 112h30" opacity="0.3" strokeWidth="4" />
      </g>
      <g stroke="var(--color-ngoc)" strokeWidth="3" strokeLinecap="round" opacity="0.55">
        <path d="M30 148q16-9 32 0t32 0 32 0 32 0 32 0 32 0" />
      </g>
    </svg>
  );
}
