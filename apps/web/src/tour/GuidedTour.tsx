import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../components/ui.tsx";
import { prefersReducedMotion } from "../design/motion.ts";
import { ProgressBar } from "../design/index.ts";
import { t } from "../i18n/index.ts";

/**
 * Visite guidée **sur l'application elle-même** (contrat phase26 §8).
 *
 * La visite du contrat phase23 §3 était une suite de six écrans illustrés, vus une fois, juste
 * après le test de niveau : on y lisait ce qu'était l'onglet Réviser sans jamais le voir. Retour
 * d'usage : on ne sait toujours pas où cliquer. La visite se fait désormais **sur l'écran du
 * parcours**, bulle par bulle, chaque bulle posée sur le vrai bouton qu'elle explique, le reste de
 * l'écran assombri. Elle se relance à tout moment par le bouton « ? » de l'accueil.
 *
 * Rien à faire pendant la visite : on avance, on recule, on passe. Aucun clic ne traverse le voile
 * — on ne quitte pas l'écran au milieu d'une explication par mégarde.
 */

export interface TourStep {
  key: string;
  /**
   * Sélecteur de l'élément montré, ou plusieurs essayés dans l'ordre (le bouton de la séance s'il
   * y en a une, sinon la carte de l'objectif). Absent ou introuvable : la bulle se pose au centre.
   */
  target: string | readonly string[] | null;
  title: string;
  body: string;
}

/** Marge du projecteur autour de l'élément, et distance de la bulle. */
const HALO = 8;
const GAP = 14;
/** Gouttière d'écran (règle des 16 px du système de design). */
const GUTTER = 16;
const BUBBLE_MAX = 360;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function find(target: TourStep["target"]): Element | null {
  if (!target) return null;
  for (const selector of typeof target === "string" ? [target] : target) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function measure(target: TourStep["target"]): Rect | null {
  const el = find(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function GuidedTour({ steps, onClose }: { steps: readonly TourStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState(0);
  const bubble = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  // Amener l'élément à l'écran, puis le mesurer. Mesuré à nouveau à chaque défilement ou
  // redimensionnement : la bulle suit l'élément, elle ne reste pas plantée à son ancienne place.
  useLayoutEffect(() => {
    if (!step) return;
    const el = find(step.target);
    el?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    const update = () => setRect(measure(step.target));
    update();
    // Le défilement doux prend quelques centaines de millisecondes : on remesure à son arrivée.
    const late = window.setTimeout(update, 450);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
    // Par sa clé : une liste d'étapes recalculée au rendu ne relance pas la mesure en boucle.
  }, [step?.key]);

  useLayoutEffect(() => {
    setBubbleHeight(bubble.current?.offsetHeight ?? 0);
  }, [index, rect]);

  // Le focus suit la bulle : un lecteur d'écran lit le titre de l'étape dès qu'elle change.
  useEffect(() => {
    heading.current?.focus();
  }, [index]);

  const next = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  if (!step) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(BUBBLE_MAX, vw - GUTTER * 2);
  let position: React.CSSProperties;
  if (rect) {
    const centre = rect.left + rect.width / 2;
    const left = Math.min(Math.max(centre - width / 2, GUTTER), vw - width - GUTTER);
    // Sous l'élément s'il y a la place, au-dessus sinon (la barre basse, typiquement).
    const below = rect.top + rect.height + HALO + GAP;
    const fitsBelow = below + bubbleHeight + GUTTER <= vh;
    const top = fitsBelow ? below : Math.max(GUTTER, rect.top - HALO - GAP - bubbleHeight);
    position = { top, left, width };
  } else {
    position = { top: Math.max(GUTTER, (vh - bubbleHeight) / 2), left: (vw - width) / 2, width };
  }

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="tour-title" data-testid="guided-tour">
      {/* Le voile : un projecteur découpé autour de l'élément, ou un voile plein sans élément. */}
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-card ring-2 ring-nghe transition-[top,left,width,height] duration-300 motion-reduce:transition-none"
          style={{
            top: rect.top - HALO,
            left: rect.left - HALO,
            width: rect.width + HALO * 2,
            height: rect.height + HALO * 2,
            boxShadow: "0 0 0 9999px rgb(10 30 25 / 0.62)",
          }}
          data-testid="tour-spotlight"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-[rgb(10_30_25/0.62)]" />
      )}

      <div
        ref={bubble}
        key={step.key}
        className="absolute flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-sheet motion-safe:parlo-enter"
        style={position}
        data-testid="discovery-step"
        data-step={step.key}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-phu-sa">{t("discovery.step", { i: index + 1, n: steps.length })}</span>
          {/* Passer reste offert à chaque bulle : une visite dont on ne peut pas sortir est une prison. */}
          <button type="button" onClick={onClose} data-testid="discovery-skip" className="min-h-11 px-1 text-sm font-semibold text-ngoc">
            {t("discovery.skip")}
          </button>
        </div>
        <ProgressBar value={index + 1} max={steps.length} size="sm" label={t("discovery.step", { i: index + 1, n: steps.length })} />
        <h2 id="tour-title" ref={heading} tabIndex={-1} className="font-serif text-xl text-balance outline-none">
          {step.title}
        </h2>
        <p className="text-balance">{step.body}</p>
        <div className="flex items-center gap-3 pt-1">
          {index > 0 && (
            <Button variant="quiet" onClick={back} data-testid="discovery-back">
              {t("discovery.back")}
            </Button>
          )}
          <Button onClick={next} data-testid="discovery-next">
            {t(last ? "discovery.done" : "discovery.next")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
