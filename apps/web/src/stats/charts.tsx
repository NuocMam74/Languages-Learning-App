import { useId, useState, type ReactNode } from "react";
import { Icon } from "../design/index.ts";
import { t } from "../i18n/index.ts";

/**
 * Graphiques des statistiques (contrat phase23 §1). Du SVG écrit à la main, sans bibliothèque :
 * une dépendance de graphiques pèse plus lourd que tout l'écran qu'elle sert, et aucune ne sait
 * parler la palette du delta ni suivre le thème sombre.
 *
 * Quatre règles, tenues par construction :
 *
 *  - **une échelle, une série.** Jamais deux axes verticaux dans un même cadre : deux mesures qui
 *    ne se comparent pas (des réponses et des minutes) font deux cadres empilés qui partagent
 *    l'axe des jours. Superposées, elles racontent n'importe quelle corrélation ;
 *  - **la couleur ne porte jamais seule un sens.** Mesuré : laque (#C2352A) et curcuma écrit
 *    (#8A5A00) ne se distinguent pas en vision deutan (ΔE 4,2). Toute marque colorée d'ici est
 *    donc doublée d'un libellé lisible ;
 *  - **rien ne bouge.** Chaque cadre a sa hauteur fixe et son `viewBox` : les chiffres arrivent
 *    d'IndexedDB après le premier rendu et ne poussent jamais la page (CLS) ;
 *  - **ça se touche.** Pas de survol sur un téléphone : on tape une colonne, et la ligne de
 *    lecture au-dessus du cadre dit ce qu'elle vaut. Cette ligne existe toujours, même vide.
 *
 * Les marques portent `currentColor` : le ton vient d'une classe Tailwind chez l'appelant, donc
 * du jeton de couleur — le thème sombre suit sans une ligne de plus.
 */

/** Rayon des extrémités de barre : 4 px, ancrées à la ligne de base (jamais de barre en pilule). */
const BAR_RADIUS = 4;

export interface ChartPoint {
  /** Jour ISO, sert de clé et de libellé. */
  day: string;
  value: number;
  /** Ce que la ligne de lecture affiche quand on tape cette colonne. */
  label: string;
  /**
   * Case de calage, hors fenêtre (la bande de régularité commence un lundi). Elle occupe la
   * place et **ne se dessine pas** : une case grise indistinguable d'un jour sans séance
   * ajouterait des jours creux qui n'ont jamais existé.
   */
  placeholder?: boolean;
}

/**
 * Cadre commun : un titre, une ligne de lecture à hauteur réservée, le dessin, et le repli
 * « rien à montrer ». Le titre nomme la série — c'est pourquoi une série seule n'a pas de légende.
 */
function Frame({ title, hint, reading, height, children, empty }: {
  title: string;
  hint?: string | undefined;
  /** Ligne de lecture : la valeur touchée, ou le résumé par défaut. Hauteur toujours réservée. */
  reading: ReactNode;
  /** Hauteur fixe du dessin, en pixels. Absente : le contenu porte sa propre hauteur (une grille). */
  height?: number;
  children: ReactNode;
  empty: boolean;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {/* Une ligne, toujours là : sans elle, taper une colonne ferait grandir la carte. */}
        <span className="flex min-h-[1.3125rem] items-center text-sm text-phu-sa" aria-live="polite">
          {empty ? t("stats.chart.empty") : reading}
        </span>
      </figcaption>
      <div style={height === undefined ? undefined : { height }} className="relative">
        {children}
      </div>
      {hint && <span className="text-sm text-phu-sa">{hint}</span>}
    </figure>
  );
}

/* ------------------------------------------------------------------ Barres */

/**
 * Histogramme d'une série journalière. Les jours creux restent dessinés — une colonne à zéro,
 * c'est le jour où l'on n'a rien fait, et c'est exactement ce qu'on vient voir. Un filet gris à la
 * ligne de base les rend visibles sans les faire passer pour une valeur.
 */
export function DayBars({ title, hint, points, unitLabel, summary, tone = "ngoc", height = 132 }: {
  title: string;
  hint?: string | undefined;
  points: readonly ChartPoint[];
  /** Nom de la mesure, lu par les lecteurs d'écran (« réponses », « minutes »). */
  unitLabel: string;
  /** Ce que dit la ligne de lecture tant que rien n'est touché. */
  summary: string;
  tone?: "ngoc" | "nghe";
  height?: number;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const titleId = useId();
  const max = Math.max(1, ...points.map((p) => p.value));
  const empty = points.every((p) => p.value === 0);
  // Repère horizontal unique : le maximum. Une grille complète encombrerait 132 px de haut.
  const width = Math.max(1, points.length) * 10;
  const chosen = picked === null ? null : points[picked];

  return (
    <Frame title={title} hint={hint} height={height} empty={empty} reading={chosen ? chosen.label : summary}>
      <svg
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
        className={`h-full w-full ${tone === "nghe" ? "text-nghe" : "text-ngoc"}`}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{`${title} (${unitLabel}) — ${summary}`}</title>
        {points.map((point, i) => {
          const h = empty ? 0 : (point.value / max) * 96;
          const x = i * 10;
          return (
            <g key={point.day}>
              {/* Ligne de base : le jour creux se voit, sans peser comme une valeur. */}
              <rect x={x + 1.5} y={98.5} width={7} height={1.5} className="fill-current opacity-20" />
              {h > 0 && (
                <rect
                  x={x + 1.5}
                  y={100 - h}
                  width={7}
                  height={h}
                  rx={BAR_RADIUS / 2}
                  className={`fill-current transition-opacity ${picked !== null && picked !== i ? "opacity-35" : ""}`}
                />
              )}
              {/* Cible tactile pleine hauteur : on ne vise pas une colonne de 3 px de large. */}
              <rect
                x={x}
                y={0}
                width={10}
                height={100}
                fill="transparent"
                className="cursor-pointer"
                onPointerDown={() => setPicked(picked === i ? null : i)}
              >
                <title>{point.label}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </Frame>
  );
}

/* ------------------------------------------------------------------- Ligne */

export interface LinePoint {
  day: string;
  /** `null` : rien n'a été noté ce jour-là. La ligne s'interrompt, elle ne descend pas à zéro. */
  value: number | null;
  label: string;
}

/**
 * Courbe d'un taux (0..1). Un jour sans réponse **coupe** le tracé : le relier à zéro dessinerait
 * une chute qui n'a pas eu lieu — c'est l'erreur classique, et elle se lit comme un effondrement.
 * Les seuils de lecture (60 % et 85 %, ceux des compétences) sont tracés en filets discrets, avec
 * leur valeur écrite : ils donnent l'échelle sans axe.
 */
/** Le point n'a de voisin mesuré ni avant ni après : aucun segment ne le rendra visible. */
function isolated(points: readonly LinePoint[], i: number): boolean {
  return (points[i - 1]?.value ?? null) === null && (points[i + 1]?.value ?? null) === null;
}

export function RatioLine({ title, hint, points, summary, thresholds = [0.6, 0.85], height = 132 }: {
  title: string;
  hint?: string | undefined;
  points: readonly LinePoint[];
  summary: string;
  thresholds?: readonly number[];
  height?: number;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const titleId = useId();
  const width = Math.max(1, points.length) * 10;
  const empty = points.every((p) => p.value === null);
  const x = (i: number) => i * 10 + 5;
  const y = (value: number) => 96 - value * 92;
  const chosen = picked === null ? null : points[picked];

  // Segments continus : une nouvelle commande `M` à chaque reprise après un jour creux.
  let path = "";
  let open = false;
  points.forEach((point, i) => {
    if (point.value === null) {
      open = false;
      return;
    }
    path += `${open ? "L" : "M"}${x(i)} ${y(point.value)} `;
    open = true;
  });

  return (
    <Frame title={title} hint={hint} height={height} empty={empty} reading={chosen?.value != null ? chosen.label : summary}>
      <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" className="h-full w-full text-ngoc" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{`${title} — ${summary}`}</title>
        {thresholds.map((threshold) => (
          <line
            key={threshold}
            x1={0}
            x2={width}
            y1={y(threshold)}
            y2={y(threshold)}
            className="stroke-phu-sa opacity-25"
            strokeWidth={0.5}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* 2 px constants quelle que soit l'échelle horizontale : `non-scaling-stroke` évite le trait écrasé. */}
        <path d={path.trim()} fill="none" className="stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map((point, i) =>
          point.value === null ? null : (
            <g key={point.day}>
              {/* Un jour isolé entre deux jours creux n'a aucun segment à lui : sans ce point, une
                  journée de travail serait purement invisible sur la courbe. */}
              {(picked === i || isolated(points, i)) && (
                // Anneau de surface autour du point : il se détache même posé sur la ligne.
                <circle cx={x(i)} cy={y(point.value)} r={3.4} className="fill-current stroke-surface" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
              )}
              <rect x={i * 10} y={0} width={10} height={100} fill="transparent" onPointerDown={() => setPicked(picked === i ? null : i)}>
                <title>{point.label}</title>
              </rect>
            </g>
          ),
        )}
      </svg>
      {/* Les seuils écrits : le graphique n'a pas d'axe vertical, ce sont eux qui donnent l'échelle.
          Chaque repère est posé **sur son filet** — la même fonction `y` que le tracé, convertie en
          pourcentage de la boîte. Les répartir à vue les mettrait ailleurs qu'à leur valeur, et un
          repère faux vaut moins que pas de repère. */}
      {thresholds.map((threshold) => (
        <span
          key={threshold}
          aria-hidden
          className="pointer-events-none absolute right-0 -translate-y-1/2 rounded-chip bg-nuoc/80 px-1 text-sm leading-none text-phu-sa tabular-nums"
          style={{ top: `${y(threshold)}%` }}
        >
          {Math.round(threshold * 100)}%
        </span>
      ))}
    </Frame>
  );
}

/* --------------------------------------------------------------- Régularité */

/** Cinq pas d'une rampe séquentielle d'un seul ton : du plus creux au plus fourni. */
const HEAT_STEPS = ["opacity-[0.10]", "opacity-30", "opacity-50", "opacity-75", "opacity-100"] as const;

/**
 * Bande de régularité : une case par jour, teintée par le volume. Une rampe **d'un seul ton**
 * (jade), du pâle au plein — une échelle de magnitude ne se peint jamais en arc-en-ciel.
 *
 * C'est le graphique qui dit le plus de choses vraies sur l'apprentissage d'une langue : la
 * fréquence compte plus que la durée, et elle se lit d'un coup d'œil sur une bande de 28 cases.
 */
export function RegularityStrip({ title, points, summary, weekdayLabels }: {
  title: string;
  points: readonly ChartPoint[];
  summary: string;
  /** Initiales des jours de la semaine, du lundi au dimanche (déjà traduites). */
  weekdayLabels: readonly string[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const days = points.filter((p) => !p.placeholder);
  const max = Math.max(1, ...days.map((p) => p.value));
  const empty = days.every((p) => p.value === 0);
  const chosen = days.find((p) => p.day === picked);
  const step = (value: number): string =>
    HEAT_STEPS[value === 0 ? 0 : Math.min(HEAT_STEPS.length - 1, 1 + Math.floor((value / max) * (HEAT_STEPS.length - 1.01)))] ?? HEAT_STEPS[0];

  return (
    <Frame title={title} empty={empty} reading={chosen ? chosen.label : summary}>
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-7 gap-1.5" aria-hidden>
          {weekdayLabels.map((label, i) => (
            <span key={i} className="text-center text-sm text-phu-sa">{label}</span>
          ))}
        </div>
        <ul className="grid grid-cols-7 gap-1.5">
          {points.map((point) => (
            <li key={point.day}>
              {point.placeholder ? (
                <span aria-hidden className="block aspect-square w-full" />
              ) : (
              <button
                type="button"
                onClick={() => setPicked(picked === point.day ? null : point.day)}
                aria-label={point.label}
                aria-pressed={picked === point.day}
                data-value={point.value}
                className={`grid aspect-square w-full place-items-center rounded-chip bg-ngoc ${step(point.value)} ${
                  picked === point.day ? "ring-2 ring-muc ring-offset-1 ring-offset-nuoc" : ""
                }`}
              >
                {/* Le jour creux reste une case, jamais un trou : l'absence est une donnée. */}
                <span className="sr-only">{point.label}</span>
              </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/* --------------------------------------------------------------- Répartition */

export interface ShareRow {
  key: string;
  label: string;
  /** Part de l'effort, entre 0 et 1. */
  share: number;
  /** Ce qui s'écrit à droite (« 128 réponses · 82 % »). */
  detail: string;
  /** Verdict textuel — la couleur ne le dit jamais seule (voir l'en-tête du fichier). */
  verdict?: string | undefined;
  tone?: "ngoc" | "nghe" | "son-mai" | undefined;
}

/**
 * Barres horizontales étiquetées. Un seul ton par défaut : **l'identité vient du libellé**, pas
 * de la couleur — quatre teintes pour quatre lignes nommées n'ajouteraient rien et exclueraient
 * les daltoniens. Le ton ne sert qu'à porter un verdict, et il est alors doublé d'un mot.
 */
export function ShareBars({ rows, labelledBy }: { rows: readonly ShareRow[]; labelledBy?: string | undefined }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.share));
  return (
    <ul className="flex flex-col gap-3.5" aria-labelledby={labelledBy} data-testid="stats-shares">
      {rows.map((row) => (
        <li key={row.key} data-key={row.key} data-share={row.share.toFixed(3)}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{row.label}</span>
            <span className="text-sm text-phu-sa tabular-nums">{row.detail}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-phu-sa/10">
            <div
              className={`h-full rounded-full motion-safe:parlo-fill ${
                row.tone === "son-mai" ? "bg-son-mai" : row.tone === "nghe" ? "bg-nghe" : "bg-ngoc"
              }`}
              // Part relative à la plus grande : quatre barres à 25 % seraient toutes minuscules.
              style={{ width: `${(row.share / max) * 100}%` }}
            />
          </div>
          {/* Toujours présente : le verdict arrive avec les données et ne pousse pas la liste (CLS). */}
          <p className="mt-0.5 min-h-[1.3125rem] text-sm text-phu-sa">{row.verdict ?? ""}</p>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- Tendance */

/** Flèche de tendance, toujours accompagnée de son mot : jamais une couleur seule. */
export function TrendChip({ trend, label }: { trend: "up" | "flat" | "down" | "unknown"; label: string }) {
  if (trend === "unknown") return <span className="text-sm text-phu-sa">{label}</span>;
  const icon = trend === "up" ? "arrowUp" : trend === "down" ? "arrowDown" : "minus";
  const color = trend === "up" ? "text-ngoc" : trend === "down" ? "text-son-mai" : "text-phu-sa";
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${color}`} data-testid="stats-trend" data-trend={trend}>
      <Icon name={icon} size={15} strokeWidth={2.4} />
      {label}
    </span>
  );
}
