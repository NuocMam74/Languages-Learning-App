import type { ContentIndex, LessonId } from "@parlo/core";
import { Link } from "react-router";
import { Icon } from "../design/index.ts";
import { l, t } from "../i18n/index.ts";

/**
 * Carte du parcours : un fleuve vertical en SVG, les leçons sont des
 * embarcadères sur ses méandres (spec §13 — l'élément mémorable).
 */

const STEP_Y = 112;
const AMPLITUDE = 26; // % de la largeur

export function RiverPath({ content, completed, passed = completed, current, unlocked = completed, unitIds }: {
  content: ContentIndex;
  completed: ReadonlySet<LessonId>;
  /**
   * Leçons **réussies** (contrat phase10 §3). Une leçon terminée mais non réussie ne se coche pas :
   * elle s'affiche « à refaire », sinon on verrait une pastille verte suivie d'une étape verrouillée.
   * Défaut : `completed`, pour les appelants qui ne distinguent pas encore les deux.
   */
  passed?: ReadonlySet<LessonId>;
  current: LessonId | null;
  /** Leçons ouvertes sans être terminées (sautées grâce au test de placement). */
  unlocked?: ReadonlySet<LessonId>;
  /**
   * Unités à dessiner (contrat phase11 §2) : celles d'un monde quand on est entré dedans. Par
   * défaut, tout le cursus — le même fleuve, simplement tronçonné.
   */
  unitIds?: readonly string[];
}) {
  const units = unitIds ? content.curriculum.units.filter((u) => unitIds.includes(u.id)) : content.curriculum.units;
  // Unité courante dépliée ; les unités suivantes restent visibles mais repliées et grisées (spec §4.2).
  const withCurrent = units.findIndex((u) => current !== null && u.lessons.includes(current));
  const lastTouched = units.reduce((acc, u, i) => (u.lessons.some((id) => completed.has(id) || unlocked.has(id)) ? i : acc), -1);
  const currentUnit = withCurrent >= 0 ? withCurrent : Math.max(0, lastTouched);
  const nodes = units.flatMap((unit, i) =>
    unit.status === "available" && i <= currentUnit
      ? unit.lessons.map((id) => ({ id, unit, lesson: content.lessons.get(id) }))
      : [{ id: unit.id, unit, lesson: undefined }],
  );
  const height = nodes.length * STEP_Y + 40;
  const xOf = (i: number) => 50 + AMPLITUDE * Math.sin(i * 1.15);
  const yOf = (i: number) => 60 + i * STEP_Y;

  // Tracé du fleuve : courbes de Bézier passant par chaque embarcadère.
  const d = nodes
    .map((_, i) => {
      if (i === 0) return `M ${xOf(0)} 0 L ${xOf(0)} ${yOf(0)}`;
      const midY = (yOf(i - 1) + yOf(i)) / 2;
      return `C ${xOf(i - 1)} ${midY}, ${xOf(i)} ${midY}, ${xOf(i)} ${yOf(i)}`;
    })
    .join(" ");

  let lastUnit = "";
  return (
    <div className="@container relative w-full" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <path d={d} fill="none" stroke="var(--color-ngoc-sang)" strokeWidth="14" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="var(--color-ngoc)" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <ol className="absolute inset-0">
        {nodes.map((node, i) => {
          const done = passed.has(node.id);
          // Terminée mais pas réussie : accessible, et à refaire.
          const redo = !done && completed.has(node.id);
          const isCurrent = node.id === current;
          const locked = !node.lesson || (!done && !redo && !isCurrent && !unlocked.has(node.id));
          const showUnit = node.unit.id !== lastUnit;
          lastUnit = node.unit.id;
          const left = xOf(i);
          const labelSide = left > 50 ? "right-[calc(100%+0.75rem)] text-right" : "left-[calc(100%+0.75rem)]";
          const planned = !node.lesson;
          // Étiquette bornée à la place qui reste jusqu'au bord du fleuve (unités cqw du conteneur) :
          // jamais de défilement horizontal sur un téléphone de 360 px.
          const dotHalf = planned ? 12 : isCurrent ? 40 : 28;
          const room = left > 50 ? left : 100 - left;
          const labelWidth = `min(9rem, calc(${room.toFixed(2)}cqw - ${dotHalf + 12}px))`;

          const dot = (
            <span
              className={`relative grid place-items-center rounded-full ${
                planned
                  ? "size-6 border-4 border-line-strong bg-surface"
                  : isCurrent
                    ? "size-20 border-4 border-nghe bg-ngoc text-nuoc shadow-raised ring-[6px] ring-nghe/25"
                    : done
                      ? "size-14 border-4 border-ngoc bg-ngoc text-nuoc shadow-card"
                      : redo
                        ? "size-14 border-4 border-nghe bg-surface-nghe text-nghe-ecrit shadow-card"
                        : "size-14 border-4 border-line-strong bg-surface text-phu-sa"
              }`}
            >
              {/* L'onde du nœud courant (phase19 §2) : le seul mouvement de la carte, et il sert —
                  l'œil va droit à l'étape du jour. Calque derrière, sans toucher au flux. */}
              {isCurrent && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full border-4 border-nghe motion-safe:parlo-ripple"
                />
              )}
              {planned ? null : done ? (
                <Icon name="check" size={24} strokeWidth={3} />
              ) : redo ? (
                <Icon name="refresh" size={22} strokeWidth={2.6} />
              ) : (
                <span className="font-serif text-xl">{i + 1}</span>
              )}
            </span>
          );

          return (
            <li key={node.id} className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform motion-safe:active:scale-[.97]" style={{ left: `${left}%`, top: yOf(i) }}>
              {locked || !node.lesson ? (
                <div aria-disabled>{dot}</div>
              ) : (
                <Link to={`/lecon/${node.id}`} aria-label={redo ? t("journey.lesson.redo", { title: l(node.lesson.title) }) : l(node.lesson.title)} data-state={done ? "done" : redo ? "redo" : "open"}>
                  {dot}
                </Link>
              )}
              <div className={`absolute top-1/2 -translate-y-1/2 break-words ${labelSide}`} style={{ width: labelWidth }}>
                {showUnit && <p className="text-xs text-phu-sa">{l(node.unit.title)}</p>}
                <p className={`text-sm leading-snug ${locked ? "text-phu-sa" : "font-medium"}`}>{node.lesson ? l(node.lesson.title) : ""}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
