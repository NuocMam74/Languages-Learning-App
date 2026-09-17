import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from "react";
import { Icon, type IconName } from "./icons.tsx";

/**
 * Primitives du système de design (contrat phase8 §1). Tous les écrans d'apprentissage sont
 * refactorés dessus : une carte, un titre de section, une statistique, un anneau, une barre, un
 * jeton, un état vide, une feuille, un bouton-icône, une pastille et un squelette — et rien d'autre.
 *
 * Deux règles de fond :
 *  - **hiérarchie** : `Card` a trois tons (`plain`, `raised`, `feature`) ; deux cartes identiques
 *    empilées sans distinction sont interdites (spec §13), donc l'appelant choisit lequel porte le
 *    poids de l'écran ;
 *  - **aucun texte en dur** : tout libellé vient de `t()` chez l'appelant (garde `i18n:check`).
 */

/* ------------------------------------------------------------------ Card */

type CardTone = "plain" | "raised" | "feature" | "quiet" | "notice" | "alert";

const CARD_TONE: Record<CardTone, string> = {
  // Surface posée : le cas courant, une ligne fine et rien de plus.
  plain: "bg-surface border border-line",
  // Surface qui compte : l'ombre douce unique la décolle du fond.
  raised: "bg-surface border border-line shadow-card",
  // L'élément mémorable de l'écran : liseré jade épais, fond légèrement teinté.
  feature: "bg-surface border-2 border-ngoc/30 shadow-card",
  // Regroupement discret : pas de bord, juste un ton de fond.
  quiet: "bg-surface-2 border border-transparent",
  // Rappel / récompense : curcuma dilué (contrat §1).
  notice: "bg-surface-nghe border border-nghe/30",
  // Avertissement doux : laque diluée.
  alert: "bg-surface-son-mai border border-son-mai/25",
};

/**
 * Attributs que toute primitive doit laisser passer : les crochets de test (`data-*`) et le peu
 * d'ARIA que les écrans posent eux-mêmes. Tout le reste appartient au composant.
 */
export type PassThrough = {
  id?: string;
  role?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-live"?: "polite" | "assertive" | "off";
  "aria-modal"?: boolean;
  "aria-busy"?: boolean;
} & Record<`data-${string}`, unknown>;

export function Card({ tone = "plain", as = "div", className = "", stagger, children, ...rest }: {
  tone?: CardTone;
  as?: "div" | "section" | "li" | "article" | "aside" | "p" | "ul";
  className?: string;
  /** Rang dans une liste (≤ 6) : décale l'entrée de 40 ms par cran (contrat §1). */
  stagger?: number;
  children: ReactNode;
} & PassThrough) {
  const Tag = as;
  return (
    <Tag
      className={`rounded-card px-5 py-4 ${CARD_TONE[tone]} ${stagger === undefined ? "" : "motion-safe:parlo-enter"} ${className}`}
      style={stagger === undefined ? undefined : ({ "--parlo-stagger": `${Math.min(stagger, 5) * 40}ms` } as CSSProperties)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ---------------------------------------------------------- SectionTitle */

/**
 * Titre de section. `tone="banner"` pose le bandeau jade plein des en-têtes forts (contrat §1) ;
 * `tone="quiet"` reste une simple étiquette de regroupement. Jamais de majuscules espacées.
 */
export function SectionTitle({ children, tone = "quiet", icon, action, id, className = "" }: {
  children: ReactNode;
  tone?: "quiet" | "strong" | "banner";
  icon?: IconName;
  /** Lien ou bouton aligné à droite du titre (« tout voir »). */
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  if (tone === "banner") {
    return (
      <div className={`flex items-center gap-3 rounded-card bg-surface-ngoc px-4 py-3 text-nuoc ${className}`}>
        {icon && <Icon name={icon} size={20} className="opacity-90" />}
        <h2 id={id} className="min-w-0 flex-1 font-serif text-lg leading-tight">{children}</h2>
        {action}
      </div>
    );
  }
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      <h2 id={id} className={tone === "strong" ? "flex items-center gap-2 font-serif text-lg" : "flex items-center gap-2 text-sm font-semibold text-phu-sa"}>
        {icon && <Icon name={icon} size={tone === "strong" ? 20 : 16} className="text-ngoc" />}
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Stat */

/** Un chiffre et ce qu'il veut dire. Le chiffre d'abord, l'étiquette dessous, jamais l'inverse. */
export function Stat({ value, label, tone = "neutral", icon, className = "", ...rest }: {
  value: ReactNode;
  label: ReactNode;
  tone?: "neutral" | "ngoc" | "nghe" | "son-mai";
  icon?: IconName;
  className?: string;
} & PassThrough) {
  // `text-nghe` pur ne tient pas AA sur une surface claire : la variante écrite (tokens.css) si.
  const color = { neutral: "text-muc", ngoc: "text-ngoc", nghe: "text-nghe-ecrit", "son-mai": "text-son-mai" }[tone];
  return (
    <div className={`flex min-w-0 flex-col ${className}`} {...rest}>
      <span className={`flex items-center gap-1.5 text-lg font-semibold ${color}`}>
        {icon && <Icon name={icon} size={18} />}
        <span className="tabular-nums">{value}</span>
      </span>
      <span className="truncate text-sm text-phu-sa">{label}</span>
    </div>
  );
}

/* ----------------------------------------------------------- ProgressBar */

/**
 * Barre de progression. Le remplissage s'anime une fois (400 ms) à l'arrivée de la valeur, jamais
 * à chaque rendu : `transform: scaleX` — aucune mise en page recalculée, donc aucun décalage.
 */
export function ProgressBar({ value, max = 1, label, tone = "ngoc", size = "md", className = "", ...rest }: {
  value: number;
  max?: number;
  /** Nom accessible de la barre (obligatoire : `role="progressbar"` sans nom ne dit rien). */
  label: string;
  tone?: "ngoc" | "nghe" | "son-mai";
  size?: "sm" | "md";
  className?: string;
} & PassThrough) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = { ngoc: "bg-ngoc", nghe: "bg-nghe", "son-mai": "bg-son-mai" }[tone];
  return (
    <div
      className={`${size === "sm" ? "h-1.5" : "h-2.5"} overflow-hidden rounded-full bg-phu-sa/10 ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      {...rest}
    >
      <div className={`h-full rounded-full ${fill} motion-safe:parlo-fill`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

/* ---------------------------------------------------------- ProgressRing */

/**
 * Anneau de progression : l'objet fort des écrans de bilan et d'objectif. Le trait se remplit en
 * 400 ms (`stroke-dashoffset`, hors mise en page). Taille fixe : rien ne bouge autour.
 */
export function ProgressRing({ value, max = 1, size = 96, label, tone = "ngoc", children, ...rest }: {
  value: number;
  max?: number;
  size?: number;
  label: string;
  tone?: "ngoc" | "nghe";
  /** Ce qui s'affiche au centre (un pourcentage, un score, une icône). */
  children?: ReactNode;
} & PassThrough) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const stroke = Math.max(6, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    // Un rendu à 0 puis la valeur : la transition CSS part toujours du vide, même au premier affichage.
    const id = requestAnimationFrame(() => setShown(ratio));
    return () => cancelAnimationFrame(id);
  }, [ratio]);
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      {...rest}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-phu-sa/12" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={`${tone === "nghe" ? "text-nghe" : "text-ngoc"} transition-[stroke-dashoffset] duration-[400ms] ease-[cubic-bezier(.22,.61,.36,1)] motion-reduce:transition-none`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown)}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Chip */

export type ChipTone = "neutral" | "ngoc" | "nghe" | "son-mai" | "solid" | "outline";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "bg-phu-sa/10 text-phu-sa",
  ngoc: "bg-ngoc-sang text-ngoc",
  nghe: "bg-surface-nghe text-phu-sa",
  "son-mai": "bg-surface-son-mai text-son-mai",
  solid: "bg-ngoc text-nuoc",
  outline: "border border-line-strong bg-surface text-phu-sa",
};

/** Jeton : un état, un filtre, un compte. Rayon 12 px, jamais de majuscules espacées. */
export function Chip({ tone = "neutral", icon, children, className = "", ...rest }: {
  tone?: ChipTone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
} & PassThrough) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-chip px-2.5 py-1 text-sm font-medium ${CHIP_TONE[tone]} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ IconButton */

/**
 * Bouton ne portant qu'une icône : 44 px minimum, `aria-label` **obligatoire** (pas de bouton muet).
 * Le retour de pression (scale .98) est le micro-retour commun à tous les boutons de l'app.
 */
export function IconButton({ icon, label, tone = "quiet", size = 24, className = "", ...props }: {
  icon: IconName;
  label: string;
  tone?: "quiet" | "solid" | "ngoc";
  size?: number;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">) {
  const tones = {
    quiet: "text-phu-sa hover:bg-phu-sa/8",
    ngoc: "text-ngoc hover:bg-ngoc/10",
    solid: "bg-ngoc text-nuoc hover:bg-ngoc/90",
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid size-11 shrink-0 place-items-center rounded-full transition-[background-color,transform] active:scale-[.98] ${tones[tone]} ${className}`}
      {...props}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/* ---------------------------------------------------------------- Avatar */

/**
 * Médaillon d'identité : initiales, ou une silhouette au trait tant qu'aucun nom n'est donné.
 * `initials` permet à l'appelant d'imposer sa propre règle (profil : accents, prénoms composés).
 */
export function Avatar({ name, initials, size = "sm" }: { name: string | null; initials?: string | null; size?: "sm" | "lg" | "xl" }) {
  const box = { sm: "size-11 text-lg", lg: "size-16 text-2xl", xl: "size-24 text-vi" }[size];
  const shown =
    initials ??
    (name
      ? name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => [...part][0] ?? "")
          .join("")
          .toLocaleUpperCase()
      : null);
  return (
    <span aria-hidden className={`grid ${box} shrink-0 place-items-center rounded-full bg-ngoc-sang font-serif font-semibold text-ngoc ring-1 ring-ngoc/15`}>
      {shown ?? <Icon name="user" size={size === "sm" ? 24 : 32} strokeWidth={1.8} />}
    </span>
  );
}

/* ------------------------------------------------------------- Skeleton */

/** Barre de squelette : jamais d'écran blanc pendant une lecture d'IndexedDB ou un chunk. */
export function Skeleton({ className = "", rounded = "full" }: { className?: string; rounded?: "full" | "card" }) {
  return (
    <div
      aria-hidden
      className={`bg-phu-sa/10 ${rounded === "card" ? "rounded-card" : "rounded-full"} motion-safe:parlo-shimmer ${className}`}
    />
  );
}

/* ----------------------------------------------------------------- Sheet */

/**
 * Feuille ancrée en bas d'écran (correction d'exercice, fiche d'un mot) : arrondie en haut,
 * ombre montante, marges sûres iOS. Elle ne pose pas de focus trap — l'appelant reste maître
 * de ce qu'elle contient (la feuille de correction, elle, ne doit jamais voler le focus).
 */
export function Sheet({ children, tone = "surface", className = "", ref, ...rest }: {
  children: ReactNode;
  tone?: "surface" | "ngoc";
  className?: string;
  /** L'appelant mesure souvent la feuille (elle réserve sa hauteur dans la page). */
  ref?: Ref<HTMLDivElement>;
} & PassThrough) {
  return (
    <div
      ref={ref}
      className={`fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-[720px] flex-col rounded-t-3xl pt-5 pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] ${
        tone === "ngoc" ? "bg-ngoc text-nuoc" : "bg-surface text-muc shadow-sheet"
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- CountUp */

/**
 * Comptage d'un nombre (XP au bilan, contrat §1). Purement visuel : la valeur finale est écrite
 * dans le DOM dès le premier rendu si le mouvement est réduit, et l'animation ne retarde rien.
 */
export function CountUp({ to, duration = 700, className = "" }: { to: number; duration?: number; className?: string }) {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [n, setN] = useState(reduce ? to : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce || to <= 0) {
      setN(to);
      return;
    }
    const start = performance.now();
    const base = from.current;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // Sortie douce : le nombre ralentit en arrivant, il ne s'arrête pas net.
      setN(Math.round(base + (to - base) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, duration, reduce]);
  return <span className={`tabular-nums ${className}`}>{n}</span>;
}
