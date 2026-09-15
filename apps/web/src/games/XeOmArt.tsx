import { xeOmIsBridge, type XeOmCell, type XeOmIcon, type XeOmMap } from "@parlo/core";
import { memo } from "react";

/**
 * Dessins de Xe ôm en SVG inline (spec §13) : canaux jade, rues curcuma,
 * moto laquée. La carte est statique (dessinée une fois par itinéraire) ;
 * seule la moto bouge, en transform CSS sur une couche à part.
 */

export const XE_OM_CELL = 64;
export const XE_OM_PAD = 30;

export function xeOmViewBox(map: Pick<XeOmMap, "cols" | "rows">): { width: number; height: number } {
  return { width: XE_OM_PAD * 2 + (map.cols - 1) * XE_OM_CELL, height: XE_OM_PAD * 2 + (map.rows - 1) * XE_OM_CELL };
}

/** Coordonnées (unités du viewBox) d'un carrefour. */
export function xeOmPoint([x, y]: XeOmCell): { x: number; y: number } {
  return { x: XE_OM_PAD + x * XE_OM_CELL, y: XE_OM_PAD + y * XE_OM_CELL };
}

const STREET = 13;

/** Fond de carte : pâtés, canaux, rues, ponts, repères. Mémoïsé : ne se redessine pas à chaque coup. */
export const XeOmMapBase = memo(function XeOmMapBase({ map }: { map: XeOmMap }) {
  const { width, height } = xeOmViewBox(map);
  const blocks: XeOmCell[] = [];
  for (let by = 0; by < map.rows - 1; by++) for (let bx = 0; bx < map.cols - 1; bx++) blocks.push([bx, by]);
  const isCanal = (bx: number, by: number) => map.canals.some(([cx, cy]) => cx === bx && cy === by);

  const segments: { from: XeOmCell; to: XeOmCell }[] = [];
  for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
    if (x + 1 < map.cols) segments.push({ from: [x, y], to: [x + 1, y] });
    if (y + 1 < map.rows) segments.push({ from: [x, y], to: [x, y + 1] });
  }

  return (
    <>
      <rect width={width} height={height} rx="18" fill="#e9efe9" />
      {blocks.map(([bx, by]) => {
        const p = xeOmPoint([bx, by]);
        return isCanal(bx, by) ? (
          <rect key={`c${bx},${by}`} x={p.x - 1} y={p.y - 1} width={XE_OM_CELL + 2} height={XE_OM_CELL + 2} fill="var(--color-ngoc)" />
        ) : (
          <rect key={`b${bx},${by}`} x={p.x + 9} y={p.y + 9} width={XE_OM_CELL - 18} height={XE_OM_CELL - 18} rx="6" fill="#d9e1db" />
        );
      })}
      {/* Rides sur les canaux */}
      {blocks.filter(([bx, by]) => isCanal(bx, by)).map(([bx, by]) => {
        const p = xeOmPoint([bx, by]);
        return (
          <path
            key={`w${bx},${by}`}
            d={`M${p.x + 14} ${p.y + 26} q6 -3 12 0 t12 0 M${p.x + 26} ${p.y + 42} q5 -2.5 10 0 t10 0`}
            fill="none"
            stroke="var(--color-ngoc-sang)"
            strokeOpacity="0.45"
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      })}
      {segments.map(({ from, to }) => {
        const a = xeOmPoint(from);
        const b = xeOmPoint(to);
        const bridge = xeOmIsBridge(map, from, to);
        const horizontal = a.y === b.y;
        return (
          <g key={`s${from.join(",")}-${to.join(",")}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-nghe)" strokeWidth={STREET} strokeLinecap="round" />
            {bridge && (
              <>
                <line
                  x1={horizontal ? a.x + 14 : a.x - STREET / 2 - 2} y1={horizontal ? a.y - STREET / 2 - 2 : a.y + 14}
                  x2={horizontal ? b.x - 14 : b.x - STREET / 2 - 2} y2={horizontal ? b.y - STREET / 2 - 2 : b.y - 14}
                  stroke="var(--color-muc)" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round"
                />
                <line
                  x1={horizontal ? a.x + 14 : a.x + STREET / 2 + 2} y1={horizontal ? a.y + STREET / 2 + 2 : a.y + 14}
                  x2={horizontal ? b.x - 14 : b.x + STREET / 2 + 2} y2={horizontal ? b.y + STREET / 2 + 2 : b.y - 14}
                  stroke="var(--color-muc)" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round"
                />
              </>
            )}
          </g>
        );
      })}
      {map.landmarks.map((landmark) => {
        const p = xeOmPoint(landmark.block);
        const cx = p.x + XE_OM_CELL / 2;
        const cy = p.y + XE_OM_CELL / 2;
        return (
          <g key={landmark.id}>
            <circle cx={cx} cy={cy - 6} r="15" fill="var(--color-nuoc)" stroke="var(--color-ngoc)" strokeWidth="2" />
            <g transform={`translate(${cx - 10} ${cy - 16})`}>
              <LandmarkIcon icon={landmark.icon} />
            </g>
            <text
              x={cx}
              y={cy + 22}
              textAnchor="middle"
              lang="vi"
              fontFamily="var(--font-serif)"
              fontSize="11.5"
              fontWeight="600"
              fill="var(--color-muc)"
              stroke="#e9efe9"
              strokeWidth="3.5"
              paintOrder="stroke"
            >
              {landmark.vi}
            </text>
          </g>
        );
      })}
    </>
  );
});

/** Pictogrammes 20×20, trait simple (pas d'emojis, §5.4). */
export function LandmarkIcon({ icon }: { icon: XeOmIcon }) {
  const stroke = { fill: "none", stroke: "var(--color-ngoc)", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (icon) {
    case "market":
      return (
        <g {...stroke}>
          <path d="M3 8h14l-1.5-4h-11z" fill="var(--color-son-mai)" stroke="var(--color-son-mai)" />
          <path d="M4 8v8h12V8M8 16v-4h4v4" />
        </g>
      );
    case "school":
      return (
        <g {...stroke}>
          <path d="M2 8l8-4 8 4-8 4z" />
          <path d="M5 10v4c3 2 7 2 10 0v-4M18 8v5" />
        </g>
      );
    case "hospital":
      return (
        <g {...stroke}>
          <rect x="3" y="3" width="14" height="14" rx="3" />
          <path d="M10 6.5v7M6.5 10h7" stroke="var(--color-son-mai)" strokeWidth="2.6" />
        </g>
      );
    case "pagoda":
      return (
        <g {...stroke}>
          <path d="M3 8q7-5 14 0M5 12.5q5-3.5 10 0M10 2v2" stroke="var(--color-son-mai)" />
          <path d="M6 8.5v3M14 8.5v3M7 13v4h6v-4" />
        </g>
      );
    case "cafe":
      return (
        <g {...stroke}>
          <path d="M4 8h10v4a5 5 0 0 1-10 0z" />
          <path d="M14 9h1.5a2 2 0 0 1 0 4H14M7 2.5q1 1.5 0 3M10.5 2.5q1 1.5 0 3" />
        </g>
      );
    case "pho":
      return (
        <g {...stroke}>
          <path d="M3 10h14a7 6 0 0 1-14 0z" />
          <path d="M11 9L17 2M13 9l5.5-5" stroke="var(--color-son-mai)" />
        </g>
      );
    case "park":
      return (
        <g {...stroke}>
          <circle cx="10" cy="8" r="5.5" />
          <path d="M10 13.5V18M7 18h6" />
        </g>
      );
    case "station":
      return (
        <g {...stroke}>
          <rect x="5" y="2.5" width="10" height="12" rx="3" />
          <path d="M5 9h10M7.5 12h.01M12.5 12h.01M7 17.5l1.5-3M13 17.5l-1.5-3" />
        </g>
      );
    case "gas":
      return (
        <g {...stroke}>
          <rect x="4" y="3" width="8" height="14" rx="1.5" />
          <path d="M6 6h4v3H6zM12 8l3 2v5a1.2 1.2 0 0 0 2.4 0V7l-2-2" />
        </g>
      );
  }
}

/** Moto vue de dessus, avant vers le haut (la rotation suit le cap). */
export function Scooter({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <ellipse cx="20" cy="22" rx="9" ry="15" fill="var(--color-muc)" opacity="0.18" />
      <rect x="17.5" y="3" width="5" height="7" rx="2.5" fill="var(--color-muc)" />
      <rect x="17.5" y="30" width="5" height="7" rx="2.5" fill="var(--color-muc)" />
      <path d="M13 12q7-4 14 0l-1.5 18q-5.5 3-11 0z" fill="var(--color-son-mai)" />
      <path d="M9 11.5h22" stroke="var(--color-muc)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="20" cy="20" r="5" fill="var(--color-nghe)" stroke="var(--color-muc)" strokeWidth="1.2" />
      <circle cx="20" cy="4.5" r="1.6" fill="var(--color-nghe)" />
    </svg>
  );
}
