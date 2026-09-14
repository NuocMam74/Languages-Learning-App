import type { ContentIndex, LessonId } from "@parlo/core";
import { Link } from "react-router";
import { l } from "../i18n.ts";

/**
 * Carte du parcours : un fleuve vertical en SVG, les leçons sont des
 * embarcadères sur ses méandres (spec §13 — l'élément mémorable).
 */

const STEP_Y = 112;
const AMPLITUDE = 26; // % de la largeur

export function RiverPath({ content, completed, current }: { content: ContentIndex; completed: ReadonlySet<LessonId>; current: LessonId | null }) {
  const nodes = content.curriculum.units.flatMap((unit) =>
    unit.status === "available"
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
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <path d={d} fill="none" stroke="var(--color-ngoc-sang)" strokeWidth="14" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="var(--color-ngoc)" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <ol className="absolute inset-0">
        {nodes.map((node, i) => {
          const done = completed.has(node.id);
          const isCurrent = node.id === current;
          const locked = !node.lesson || (!done && !isCurrent);
          const showUnit = node.unit.id !== lastUnit;
          lastUnit = node.unit.id;
          const left = xOf(i);
          const labelSide = left > 50 ? "right-[calc(100%+0.75rem)] text-right" : "left-[calc(100%+0.75rem)]";

          const planned = !node.lesson;
          const dot = (
            <span
              className={`grid place-items-center rounded-full ${
                planned
                  ? "size-6 border-4 border-phu-sa/15 bg-nuoc"
                  : isCurrent
                    ? "size-20 border-4 border-nghe bg-ngoc text-nuoc"
                    : done
                      ? "size-14 border-4 border-ngoc bg-ngoc text-nuoc"
                      : "size-14 border-4 border-phu-sa/15 bg-nuoc text-phu-sa/40"
              }`}
            >
              {planned ? null : done ? (
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              ) : (
                <span className="font-serif text-xl">{i + 1}</span>
              )}
            </span>
          );

          return (
            <li key={node.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${left}%`, top: yOf(i) }}>
              {locked || !node.lesson ? <div aria-disabled>{dot}</div> : <Link to={`/lecon/${node.id}`} aria-label={l(node.lesson.title)}>{dot}</Link>}
              <div className={`absolute top-1/2 w-36 -translate-y-1/2 ${labelSide}`}>
                {showUnit && <p className="text-xs text-phu-sa/70">{l(node.unit.title)}</p>}
                <p className={`text-sm leading-snug ${locked ? "text-phu-sa/50" : "font-medium"}`}>{node.lesson ? l(node.lesson.title) : ""}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
