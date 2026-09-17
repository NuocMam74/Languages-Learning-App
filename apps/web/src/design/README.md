# Système de design

Source unique de l'apparence de Parlo (contrat `phase8-design-revision.md` §1, spec §13).
Un écran d'apprentissage n'invente **ni couleur, ni rayon, ni ombre, ni animation** : tout vient d'ici.

```ts
import { Card, Chip, EmptyState, Icon, PageHeader, ProgressBar, SectionTitle, Stat } from "../design/index.ts";
```

## Jetons (`tokens.css`, importé une fois par `app.css`)

| Rôle | Classe | Valeur |
|---|---|---|
| Surface posée | `bg-surface` | blanc cassé `#FDFEFD` (jamais du blanc pur) |
| Surface creuse | `bg-surface-2` | `#F7FAF8` |
| Bandeau fort | `bg-surface-ngoc` | jade plein, texte `text-nuoc` |
| Rappel / récompense | `bg-surface-nghe` | curcuma dilué |
| Avertissement doux | `bg-surface-son-mai` | laque diluée |
| Bordure | `border-line` (1 px) · `border-line-strong` | mực 8 % / 15 % |
| Rayons | `rounded-card` 20 px · `rounded-chip` 12 px · `rounded-field` 14 px · `rounded-full` | un par famille |
| Ombre | `shadow-card` · `shadow-raised` · `shadow-sheet` | une seule ombre douce |

Le fond `nước` reste, et **`body::before` pose la texture d'eau** (motif SVG en data-URI, 4 % d'opacité,
couche `fixed`, zéro requête, zéro CLS). Aucun écran n'est un mur blanc : un écran se compose de
surfaces sur cette texture, pas de cartes blanches sur du blanc.

## Primitives (`primitives.tsx`)

- `Card` — `tone`: `plain` (courant) · `raised` (ombre douce) · `feature` (l'élément mémorable) ·
  `quiet` (regroupement) · `notice` (curcuma) · `alert` (laque). **Deux cartes identiques empilées
  sans hiérarchie sont interdites** : si une liste est homogène, aucune n'est `raised`/`feature`.
  `stagger={i}` déclenche l'entrée en cascade (≤ 6 éléments, 40 ms d'écart).
- `SectionTitle` — `tone`: `quiet` (étiquette), `strong` (serif), `banner` (bandeau jade plein).
- `Stat` — un chiffre, son étiquette dessous, un ton de palette.
- `ProgressBar` / `ProgressRing` — `label` obligatoire (nom accessible), remplissage 400 ms.
- `Chip` — état, filtre ou compte. Jamais de majuscules espacées.
- `EmptyState` (`EmptyState.tsx`) — illustration + une phrase + une action. `art`: `boat`,
  `notebook`, `page`, `market`, `lanterns`, `diploma`.
- `IconButton` — 44 px, `label` obligatoire. `Avatar`, `Skeleton`, `Sheet`, `CountUp`.
- `PageHeader` (`PageHeader.tsx`) — retour + titre serif + commandes, identique sur tous les écrans.

## Icônes (`icons.tsx`)

Un seul jeu : `<Icon name="flame" />`. Trait 2 px, grille 24×24, bouts arrondis, jamais de
remplissage, toujours `aria-hidden`. **Ne pas recopier de `<svg>` dans une page** : ajouter le tracé
ici. Le sens vient du texte ou de l'`aria-label` de l'`IconButton`.

## Illustrations (`illustrations/`)

`DeltaDawn` (accueil), `Sampan` (états vides), `FloatingMarket` (jeux), `Lanterns` (série),
`Diploma` (examens, certificat), `Notebook` (notes), `BlankPage` (recherche sans résultat).
SVG dessinés à la main, < 4 ko, sans texte, lisibles à 96 px comme en pleine largeur, palette du
pack, `aria-hidden`. Le cadre `Illustration` fixe le ratio : rien ne saute au chargement.

## Mouvement (`motion.ts` + utilitaires `tokens.css`)

| Intention | Comment |
|---|---|
| Pression d'un bouton | déjà dans `Button` / `IconButton` (`scale .98`) |
| Barre / anneau qui se remplit | `ProgressBar`, `ProgressRing` (400 ms) |
| XP qui monte au bilan | `<CountUp to={xp} />` |
| Entrée en cascade | `Card stagger={i}` ou `motion-safe:parlo-enter` + `staggerStyle(i)` |
| Flamme de série gagnée | `motion-safe:parlo-flame` |
| Changement d'écran | `withViewTransition(() => navigate(...))` |
| Chargement | `Skeleton`, jamais un écran vide |

Règles : tout sous `motion-safe:` (ou `prefersReducedMotion()`), **une seule** animation héroïque par
écran, et jamais d'animation qui retarde une entrée.

## Accessibilité

Contraste AA, focus visible (`:focus-visible` global), cibles ≥ 44 px, `prefers-reduced-motion`
respecté. Aucun libellé français en dur dans ces fichiers : tout texte arrive par `t()` chez
l'appelant (garde `npm run i18n:check`).
