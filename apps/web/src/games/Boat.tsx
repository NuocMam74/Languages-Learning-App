/**
 * Barque du marché flottant, en SVG inline : coque laquée (sơn mài), liseré
 * curcuma, œil peint à la proue comme sur les barques du delta.
 */
export function BoatHull({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 44" className={className} aria-hidden>
      <path d="M4 8 Q40 12 80 12 Q120 12 156 4 L144 30 Q138 40 124 40 L36 40 Q22 40 16 30 Z" fill="var(--color-son-mai)" />
      <path d="M10 16 Q80 22 150 12" fill="none" stroke="var(--color-nghe)" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="134" cy="22" rx="6" ry="4" fill="var(--color-nuoc)" />
      <circle cx="135" cy="22" r="2.2" fill="var(--color-muc)" />
    </svg>
  );
}

/** Rides d'eau statiques (décor), dessinées une fois. */
export function Ripples() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
      {[18, 38, 58, 78, 94].map((y, i) => (
        <path
          key={y}
          d={`M${-10 + i * 7} ${y} q6 -2 12 0 t12 0 M${48 + i * 5} ${y + 4} q5 -1.6 10 0 t10 0`}
          fill="none"
          stroke="var(--color-ngoc-sang)"
          strokeOpacity="0.28"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
