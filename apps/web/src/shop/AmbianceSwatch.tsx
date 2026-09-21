import { ambiance } from "@parlo/core";
import { resolvedTheme } from "../theme.ts";

/**
 * L'aperçu d'une ambiance (contrat phase24 §3) : ses trois surfaces empilées, dans le mode
 * réellement affiché.
 *
 * Les couleurs sont écrites **en dur** ici, et c'est la seule fois de l'application : ce sont
 * celles de l'ambiance qu'on n'a pas encore choisie. Les lire dans les jetons CSS montrerait
 * l'ambiance courante quatre fois — une vitrine qui ne montre rien.
 *
 * Une pastille ne dit jamais le nom : il est écrit à côté (spec §13, jamais la couleur seule).
 */
export function AmbianceSwatch({ id, size = 64 }: { id: string; size?: number }) {
  const tokens = ambiance(id)[resolvedTheme()];
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className="shrink-0 overflow-hidden rounded-card">
      {/* L'eau du fond, la carte posée dessus, et deux rides : l'application en miniature. */}
      <rect x="0" y="0" width="64" height="64" fill={tokens.nuoc} />
      <g stroke={tokens.ripple} strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.28">
        <path d="M2 14q8-5 16 0t16 0t16 0t16 0" />
        <path d="M2 52q8-5 16 0t16 0t16 0t16 0" />
      </g>
      <rect x="10" y="20" width="44" height="24" rx="7" fill={tokens.surface} />
      <rect x="16" y="27" width="22" height="4" rx="2" fill={tokens.surface2} />
      <rect x="16" y="35" width="32" height="3" rx="1.5" fill={tokens.surface2} />
    </svg>
  );
}
