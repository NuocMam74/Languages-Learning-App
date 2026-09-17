/**
 * Système de design de Parlo — source unique (contrat phase8 §1).
 *
 *   import { Card, SectionTitle, Chip, Icon } from "../design/index.ts";
 *
 * Les jetons (surfaces, rayons, ombre, texture d'eau, animations) vivent dans `tokens.css`,
 * importé une fois par `app.css`. Voir `design/README.md`.
 */
export { EmptyState } from "./EmptyState.tsx";
export { Icon, type IconName } from "./icons.tsx";
export { BlankPage, DeltaDawn, Diploma, FloatingMarket, Illustration, Lanterns, Notebook, Sampan } from "./illustrations/index.tsx";
export { prefersReducedMotion, staggerStyle, withViewTransition } from "./motion.ts";
export { PageHeader } from "./PageHeader.tsx";
export { Avatar, Card, Chip, CountUp, IconButton, ProgressBar, ProgressRing, SectionTitle, Sheet, Skeleton, Stat, type ChipTone } from "./primitives.tsx";
