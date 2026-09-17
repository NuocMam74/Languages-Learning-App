import type { SVGProps } from "react";

/**
 * Jeu d'icônes unique (contrat phase8 §1) : **tracé au trait**, grille 24×24, 2 px, bouts et
 * jointures arrondis, jamais de remplissage. Il remplace les SVG isolés recopiés d'un écran à
 * l'autre — une seule définition, une seule graisse, un seul style.
 *
 * Rien ici ne parle : une icône est toujours accompagnée d'un texte ou d'un `aria-label` posé par
 * l'appelant (`IconButton`). Le `<svg>` est `aria-hidden` par construction.
 */

export type IconName = keyof typeof PATHS;

const PATHS = {
  // Navigation et structure
  home: "M4 11.5 12 5l8 6.5M6.5 10.5V19h11v-8.5M10.5 19v-4.5h3V19",
  boat: "M4 15.5c2.5 1.6 4.5 1.6 7 0s4.5-1.6 7 0M5.5 12h13l-2 3.2h-9zM12 12V5l5 5.5",
  book: "M12 7.5C10.5 6 8.5 5.5 5 5.5V18c3.5 0 5.5.5 7 2 1.5-1.5 3.5-2 7-2V5.5c-3.5 0-5.5.5-7 2M12 7.5V20",
  user: "M12 5.5a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4M5.5 19c.8-3.2 3.4-4.8 6.5-4.8s5.7 1.6 6.5 4.8",
  // Un vrai rouage : l'ancienne version (un point et huit rayons) se lisait « soleil », pas « réglages ».
  settings: "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M19.4 13.5a7.7 7.7 0 0 0 0-3l1.9-1.4-2-3.4-2.2.9a7.6 7.6 0 0 0-2.6-1.5L14.2 3h-4l-.3 2.1a7.6 7.6 0 0 0-2.6 1.5l-2.2-.9-2 3.4 1.9 1.4a7.7 7.7 0 0 0 0 3l-1.9 1.4 2 3.4 2.2-.9a7.6 7.6 0 0 0 2.6 1.5l.3 2.1h4l.3-2.1a7.6 7.6 0 0 0 2.6-1.5l2.2.9 2-3.4z",
  chevronRight: "M9 5l7 7-7 7",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronDown: "M5 9l7 7 7-7",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  external: "M14 5h5v5M19 5l-8 8M17 14v4.5H5.5V7H10",

  // Apprentissage
  play: "M8 5.5l10 6.5-10 6.5z",
  pause: "M9 5.5v13M15 5.5v13",
  slow: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M12 8v4.3l2.8 1.7",
  sound: "M11 6.5 7.5 9.5H4.5v5h3L11 17.5zM14.5 9.8a3.2 3.2 0 0 1 0 4.4M17 7.5a6.6 6.6 0 0 1 0 9",
  mute: "M11 6.5 7.5 9.5H4.5v5h3L11 17.5zM15 10l4 4M19 10l-4 4",
  mic: "M12 4.5a2.4 2.4 0 0 0-2.4 2.4v4.6a2.4 2.4 0 0 0 4.8 0V6.9A2.4 2.4 0 0 0 12 4.5M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v2.5",
  cards: "M7.5 8h9a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 16.5 19h-9A1.5 1.5 0 0 1 6 17.5v-8A1.5 1.5 0 0 1 7.5 8M9 5h8a2 2 0 0 1 2 2v8",
  notebook: "M7 4.5h10.5v15H7a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 7 4.5M5.5 9.5h3M5.5 14.5h3M11 8.5h4M11 12h4",
  dialogue: "M4.5 7A2.5 2.5 0 0 1 7 4.5h7A2.5 2.5 0 0 1 16.5 7v3A2.5 2.5 0 0 1 14 12.5H9L5.5 15v-2.6A2.5 2.5 0 0 1 4.5 10zM19.5 10v6a2.5 2.5 0 0 1-2.5 2.5h-1.5l-2.5 2v-2",
  // Deux crochets qui encadrent une ligne : la grammaire, c'est la structure — surtout pas un « A »
  // suivi d'une barre, qui se lit « AI » à petite taille.
  grammar: "M9 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h3M15 4.5h3A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-3M9 9.5h6M9 14.5h4",
  games: "M8.5 9.5v4M6.5 11.5h4M15 10.5h.01M17 13h.01M8 6.5h8a4 4 0 0 1 4 4v3a3.2 3.2 0 0 1-5.8 1.9l-.6-.9H8.4l-.6.9A3.2 3.2 0 0 1 2 13.5v-3a4 4 0 0 1 4-4z",
  karaoke: "M12 4.5a2.4 2.4 0 0 0-2.4 2.4v4.6a2.4 2.4 0 0 0 4.8 0V6.9A2.4 2.4 0 0 0 12 4.5M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v2.5M3 8.5c1.5-2 3-2 4.5 0M16.5 8.5c1.5-2 3-2 4.5 0",

  // Progression et récompense
  flame: "M12 3.5s4.5 3.7 4.5 8a4.5 4.5 0 0 1-9 0c0-1.7.8-3 1.7-4 .2 1.2.9 2 1.8 2 1.3 0 1.6-1.6 1-6M9.7 15.5a2.4 2.4 0 0 0 4.6 0",
  star: "M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z",
  trophy: "M7.5 5h9v4.5a4.5 4.5 0 0 1-9 0zM7.5 6.5H5a2.5 2.5 0 0 0 2.5 4M16.5 6.5H19a2.5 2.5 0 0 1-2.5 4M12 14v3M9 19.5h6",
  diploma: "M6 4.5h9l3 3v7.5H6zM15 4.5V8h3M9 9h4M9 12h6M12 15v2.5l-2 1.5v-4M12 17.5l2 1.5v-4",
  target: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M12 11.7h.01",
  chart: "M5 19V9.5M12 19V5M19 19v-6.5M4 19h16",
  lantern: "M12 3.5v2M9 5.5h6l2 5.5-2 5.5H9l-2-5.5zM10 16.5v2M14 16.5v2M12 5.5v11",

  // Temps, état, service
  calendar: "M6 6h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 6M8 4v4M16 4v4M4.5 10.5h15",
  clock: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M12 7.8V12l2.8 1.7",
  bell: "M12 4.2a5 5 0 0 0-5 5v3.3L5.5 15.5h13L17 12.5V9.2a5 5 0 0 0-5-5M10 18.5a2 2 0 0 0 4 0",
  search: "M11 4.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4M15.6 15.6 19.5 19.5",
  filter: "M4.5 6.5h15M7 12h10M10 17.5h4",
  pencil: "M16.2 4.8l3 3L9 18H6v-3zM14 7l3 3",
  trash: "M5.5 7.5h13M9.5 7.5V5.5h5v2M7 7.5l.9 11.2a1.4 1.4 0 0 0 1.4 1.3h5.4a1.4 1.4 0 0 0 1.4-1.3L17 7.5M10.5 11v5M13.5 11v5",
  download: "M12 4.5v9.5M8.2 10.5 12 14.3l3.8-3.8M5 17.5v1a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-1",
  share: "M12 4.5v10M8.5 8 12 4.5 15.5 8M5.5 13.5v5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5v-5",
  copy: "M9 9h8.5a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 19v-8.5A1.5 1.5 0 0 1 9 9M5 15V6a1.5 1.5 0 0 1 1.5-1.5H15",
  lock: "M7.5 10.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18v-6a1.5 1.5 0 0 1 1.5-1.5M8.8 10.5V8.2a3.2 3.2 0 0 1 6.4 0v2.3",
  refresh: "M19 12a7 7 0 1 1-2.1-5M19 4.5V9h-4.5",
  offline: "M6 8.5a5.5 5.5 0 0 1 9.8-1.2A4 4 0 0 1 19 14M8 19h7M4 4l16 16",
  cloud: "M7.5 18.5a4 4 0 0 1-.4-8A5.2 5.2 0 0 1 17 9.7a4.4 4.4 0 0 1-.5 8.8z",
  info: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M12 11v5M12 8h.01",
  alert: "M12 5l7.5 13.5H4.5zM12 10v4M12 16.5h.01",
  globe: "M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M4.7 9.5h14.6M4.7 14.5h14.6M12 4.5c-4 4.4-4 10.6 0 15M12 4.5c4 4.4 4 10.6 0 15",
  users: "M9 5.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6M3.5 19c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5M16 6.2a2.8 2.8 0 0 1 0 5.6M17.5 14.6c1.7.6 2.7 2 3 4.4",
  tutor: "M12 4.5a4 4 0 0 0-4 4v1.2c0 1 .3 1.6-.5 2.8h9c-.8-1.2-.5-1.8-.5-2.8V8.5a4 4 0 0 0-4-4M6.5 12.5h11M5 20c.8-3.2 3.6-5 7-5s6.2 1.8 7 5",
  send: "M20.5 3.5 2.8 10.1l7.5 3.6 3.6 7.5zM20.5 3.5 10.3 13.7",
  arrowUp: "M12 19.5v-15M5.5 11 12 4.5 18.5 11",
  arrowDown: "M12 4.5v15M5.5 13 12 19.5 18.5 13",
  scooter: "M6 12.5a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5M18 12.5a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5M8.75 15.25h6.5L12.5 8.5H10M12.5 8.5H15l3 6.75M14.5 5.5H18M6 12.5V9.5h3.25",
  bowl: "M4 11h16a8 8 0 0 1-16 0M3 19.5h18M9.5 8c1.3-1.2 1.3-2.4 0-3.6M14.5 8c1.3-1.2 1.3-2.4 0-3.6",
  logout: "M13.5 5.5h-7A1.5 1.5 0 0 0 5 7v10a1.5 1.5 0 0 0 1.5 1.5h7M10.5 12h9M16 8.5l3.5 3.5-3.5 3.5",
  userMinus: "M10.5 5.5a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4M4 19c.8-3.2 3.3-4.8 6.5-4.8 1.1 0 2.1.2 3 .5M15.5 18.5h5",
} as const;

export function Icon({ name, size = 24, className = "", ...rest }: { name: IconName; size?: number; className?: string } & Omit<SVGProps<SVGSVGElement>, "name" | "size">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
