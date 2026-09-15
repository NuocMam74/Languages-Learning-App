import type { LivePoint, PitchCapture, PitchReference } from "@parlo/core/pitch";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { t } from "../i18n/index.ts";

/**
 * Tracé du karaoké tonal : Canvas 2D sur deux couches (SPEC §5.6 : 60 fps, sans moteur).
 *  - fond : grille + courbe native (jade), redessiné seulement au redimensionnement ;
 *  - premier plan : ta courbe (curcuma). En direct, on ne dessine que les nouveaux segments à chaque image ;
 *    après la note, la courbe est redessinée alignée sur la référence par le chemin DTW.
 * Hauteurs en demi-tons normalisés ; netteté selon devicePixelRatio.
 */

export interface AlignedResult {
  /** Courbe utilisateur (demi-tons) et chemin [utilisateur, référence] de la note. */
  userSt: readonly (number | null)[];
  path: readonly (readonly [number, number])[];
  offset: number;
}

interface Props {
  reference: PitchReference;
  labels: readonly string[];
  capture: RefObject<PitchCapture | null>;
  recording: boolean;
  aligned: AlignedResult | null;
}

const JADE = "#0E5E55";
const NGHE = "#E5A21B";
const PAD_X = 12;
const PAD_Y = 14;

interface Geometry {
  w: number;
  h: number;
  dpr: number;
  range: number;
}

export function KaraokePlot({ reference, labels, capture, recording, aligned }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const geo = useRef<Geometry>({ w: 0, h: 0, dpr: 1, range: 4 });
  const drawn = useRef({ index: 0, scale: 1, onset: -1, last: null as { x: number; y: number; i: number } | null });
  const alignedRef = useRef(aligned);
  alignedRef.current = aligned;

  const refMs = Math.max(1, reference.st.length * reference.hopMs);
  const peak = reference.st.reduce<number>((m, v) => (v === null ? m : Math.max(m, Math.abs(v))), 0);
  const range = Math.min(9, Math.max(4, Math.ceil(peak + 1.5)));

  const y = (st: number) => {
    const { h } = geo.current;
    const clamped = Math.max(-range, Math.min(range, st));
    return h / 2 - (clamped / range) * (h / 2 - PAD_Y);
  };
  const xRef = (j: number) => PAD_X + (reference.st.length > 1 ? j / (reference.st.length - 1) : 0.5) * (geo.current.w - 2 * PAD_X);

  const drawBackground = () => {
    const canvas = back.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const { w, h, dpr } = geo.current;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(58,58,52,0.12)";
    g.lineWidth = 1;
    for (const st of [-range / 2, 0, range / 2]) {
      g.beginPath();
      g.setLineDash(st === 0 ? [] : [4, 6]);
      g.moveTo(PAD_X, y(st));
      g.lineTo(w - PAD_X, y(st));
      g.stroke();
    }
    g.setLineDash([]);
    for (const syl of reference.syllables ?? []) {
      if (syl.start <= 0) continue;
      const x = xRef(syl.start / reference.hopMs);
      g.beginPath();
      g.moveTo(x, PAD_Y);
      g.lineTo(x, h - PAD_Y);
      g.stroke();
    }
    strokeTrack(g, reference.st.map((v, j) => (v === null ? null : { x: xRef(j), y: y(v) })), JADE, 6, 0.9);
  };

  const clearFront = () => {
    const g = front.current?.getContext("2d");
    if (!g) return null;
    const { w, h, dpr } = geo.current;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return g;
  };

  /** Courbe alignée : moyenne des trames utilisateur associées à chaque trame de référence. */
  const drawAligned = (a: AlignedResult) => {
    const g = clearFront();
    if (!g) return;
    const sums = new Map<number, { s: number; n: number }>();
    for (const [i, j] of a.path) {
      const v = a.userSt[i];
      if (v == null) continue;
      const acc = sums.get(j) ?? { s: 0, n: 0 };
      acc.s += v - a.offset;
      acc.n++;
      sums.set(j, acc);
    }
    const points = reference.st.map((_, j) => {
      const acc = sums.get(j);
      return acc ? { x: xRef(j), y: y(acc.s / acc.n) } : null;
    });
    strokeTrack(g, points, NGHE, 4, 1);
  };

  /** Direct : x = temps depuis la première trame voisée, à l'échelle de la référence (compressé si plus long). */
  const liveX = (p: LivePoint, scale: number) => PAD_X + ((p.t - drawn.current.onset) / (refMs * scale)) * (geo.current.w - 2 * PAD_X);

  const redrawLive = () => {
    const g = clearFront();
    const c = capture.current;
    drawn.current.index = 0;
    drawn.current.last = null;
    if (!g || !c) return;
    drawLiveDelta(g, c.live);
  };

  const drawLiveDelta = (g: CanvasRenderingContext2D, live: readonly LivePoint[]) => {
    const d = drawn.current;
    if (d.index >= live.length) return;
    if (d.onset < 0) {
      const first = live.findIndex((p) => p.st !== null);
      if (first < 0) {
        d.index = live.length;
        return;
      }
      d.onset = live[first]!.t;
    }
    const latest = live[live.length - 1]!;
    const needed = (latest.t - d.onset) / refMs;
    if (needed > d.scale) {
      // Plus long que la référence : on compresse l'axe et on redessine tout (rare).
      d.scale = Math.max(needed * 1.25, d.scale * 1.25);
      d.index = 0;
      d.last = null;
      const { w, h } = geo.current;
      g.clearRect(0, 0, w, h);
    }
    g.strokeStyle = NGHE;
    g.lineWidth = 4;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    for (let i = d.index; i < live.length; i++) {
      const p = live[i]!;
      if (p.st === null || p.t < d.onset) continue;
      const pt = { x: liveX(p, d.scale), y: y(p.st), i };
      if (d.last && i - d.last.i <= 3) {
        g.moveTo(d.last.x, d.last.y);
        g.lineTo(pt.x, pt.y);
      } else {
        g.moveTo(pt.x, pt.y);
        g.lineTo(pt.x + 0.01, pt.y);
      }
      d.last = pt;
    }
    g.stroke();
    d.index = live.length;
  };

  // Dimensions (devicePixelRatio) et redessin complet au redimensionnement.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      geo.current = { w: rect.width, h: rect.height, dpr, range };
      for (const canvas of [back.current, front.current]) {
        if (!canvas) continue;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      drawBackground();
      if (alignedRef.current) drawAligned(alignedRef.current);
      else redrawLive();
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [reference]);

  // Boucle d'images pendant la prise : seulement les nouveaux segments.
  useEffect(() => {
    if (!recording) return;
    drawn.current = { index: 0, scale: 1, onset: -1, last: null };
    clearFront();
    let raf = 0;
    const tick = () => {
      const g = front.current?.getContext("2d");
      const c = capture.current;
      if (g && c) drawLiveDelta(g, c.live);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording]);

  useEffect(() => {
    if (aligned) drawAligned(aligned);
  }, [aligned]);

  const syllables = reference.syllables?.length === labels.length ? reference.syllables : null;

  return (
    <figure className="flex flex-col gap-1" data-testid="karaoke-plot">
      <div ref={wrap} role="img" aria-label={t("karaoke.plot")} className="relative h-44 w-full rounded-2xl bg-white/70">
        <canvas ref={back} className="absolute inset-0 size-full" />
        <canvas ref={front} className="absolute inset-0 size-full" />
      </div>
      <div className="relative h-10 w-full" aria-hidden>
        {syllables ? (
          syllables.map((s, i) => (
            <span
              key={i}
              lang="vi"
              className="absolute top-0 -translate-x-1/2 font-serif text-xl whitespace-nowrap"
              style={{ left: `calc(${PAD_X}px + (100% - ${2 * PAD_X}px) * ${(s.start + s.end) / 2 / refMs})` }}
            >
              {labels[i]}
            </span>
          ))
        ) : (
          <span lang="vi" className="absolute top-0 left-1/2 -translate-x-1/2 font-serif text-xl whitespace-nowrap">
            {labels.join(" ")}
          </span>
        )}
      </div>
      <figcaption className="flex gap-4 text-sm text-phu-sa">
        <span className="flex items-center gap-2"><span className="inline-block h-1.5 w-5 rounded-full bg-ngoc" />{t("karaoke.legend.native")}</span>
        <span className="flex items-center gap-2"><span className="inline-block h-1.5 w-5 rounded-full bg-nghe" />{t("karaoke.legend.you")}</span>
      </figcaption>
    </figure>
  );
}

function strokeTrack(g: CanvasRenderingContext2D, points: readonly ({ x: number; y: number } | null)[], color: string, width: number, alpha: number) {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  let open = false;
  for (const p of points) {
    if (!p) {
      open = false;
      continue;
    }
    if (open) g.lineTo(p.x, p.y);
    else {
      g.moveTo(p.x, p.y);
      g.lineTo(p.x + 0.01, p.y);
      open = true;
    }
  }
  g.stroke();
  g.restore();
}
