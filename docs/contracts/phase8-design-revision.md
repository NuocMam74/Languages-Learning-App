# Contrat — esthétique, révision libre et notes personnelles

Trois chantiers complémentaires. Objectif : une app **désirable** (pas seulement correcte), **homogène**
d'un écran à l'autre, et où l'on peut **revenir sur ce qu'on a appris** et **garder ses propres notes**.

## 1. Système de design (homogénéité et envie)

Base : spec §13 (palette nước/mực/ngọc/sơn mài/nghệ/phù sa, Be Vietnam Pro + Source Serif 4, une colonne,
action en bas, contraste AA, `prefers-reduced-motion`). Restent interdits : dégradés décoratifs, libellés en
majuscules espacées, flèches collées aux boutons, cartes arrondies identiques empilées sans hiérarchie, emojis.

Ce qui manque et qu'il faut ajouter — dans `apps/web/src/design/` (source unique, documentée) :
- **Surfaces et profondeur** : `--color-surface` (blanc cassé), `--color-surface-2`, bordures 1 px `mực/8 %`,
  ombre douce unique (`--shadow-card`), rayon unique par famille (carte 20 px, jeton 12 px, pastille pleine).
  Le fond `nước` reste, mais **aucun écran ne doit être un mur blanc** : fond texturé discret (motif d'eau SVG,
  opacité ≤ 4 %), bandeaux `ngọc` pleins pour les en-têtes de section forte, encarts `nghệ/12 %` pour les rappels.
- **Primitives** : `Card`, `SectionTitle`, `Stat`, `ProgressRing`, `ProgressBar`, `Chip`, `EmptyState`, `Sheet`,
  `IconButton`, `Avatar`, `Illustration`. Tous les écrans existants sont **refactorés dessus** (homogénéité).
- **Icônes** : un seul jeu de lignes (2 px, bouts arrondis) dans `design/icons.tsx` ; remplacer les SVG isolés
  dupliqués dans les pages.
- **Illustrations originales** (SVG, palette du pack, `design/illustrations/`) : delta au lever du jour (accueil),
  barque (états vides), marché flottant (jeux), lanternes (série), diplôme (examens), carnet (notes). Légères
  (< 4 ko), sans texte, lisibles en 96 px comme en pleine largeur.
- **Mouvement utile** (toujours `motion-safe:`, jamais bloquant) : pression des boutons (scale 0.98),
  remplissage des barres et anneaux (400 ms), comptage de l'XP au bilan, entrée en cascade des cartes
  (≤ 40 ms d'écart, ≤ 6 éléments), flamme de série au gain d'un jour, transition d'écran via
  `document.startViewTransition` quand disponible, squelettes animés au chargement. Une seule animation
  « héroïque » par écran ; les micro-retours ne comptent pas comme telle.
- **États vides** : illustration + une phrase + une action. Jamais d'écran blanc ni de liste vide muette.
- **Accessibilité** : contraste AA maintenu (vérifié), focus visible, cibles ≥ 44 px, mouvement réduit respecté.

## 2. Réviser : bibliothèque de tout ce qui a été vu

Nouvelle section `/reviser` (onglet du bas « Réviser »), propre à la langue active :
- **Vocabulaire** : tous les concepts rencontrés — mot (serif), sens, ton, audio (naturel/lent), exemple,
  équivalent du Nord, état SRS (nouveau / à revoir dans X / maîtrisé), note personnelle.
  Filtres : unité, état (`à revoir`, `difficile` = lapses ≥ 2, `maîtrisé`), recherche (sans accents).
  Actions : écouter, « revoir maintenant » (force l'échéance), ajouter une note.
- **Grammaire et culture** : les explications du contenu (champs `explain`, notes de concept, cartes culture)
  regroupées par unité, consultables hors séance.
- **Leçons** : la liste par unité avec leur état ; **rejouer** une leçon terminée en *mode entraînement*
  (pas de XP nouvelle, pas de double comptage de progression ; le SRS reçoit quand même les réponses).
- **Dialogues**, **mini-jeux**, **défis**, **examens blancs** : accessibles depuis la même page, chacun relançable.
- Tout doit fonctionner **hors ligne** pour les unités téléchargées, et rester lisible sans audio natif.

## 3. Notes personnelles

- Stockage local par pack : table Dexie `notes` `{id, packCode, targetKind: "concept"|"lesson"|"dialogue"|"culture"|"free",
  targetId|null, text, createdAt, updatedAt}` ; jamais envoyé au serveur (minimisation, §14), inclus dans l'export RGPD local.
- Écriture depuis : la fiche d'un mot, une carte grammaire/culture, la fin d'une leçon, un dialogue, ou libre.
- Page `/notes` : liste par date ou par élément, recherche, édition, suppression, **export** en Markdown
  (`.md`) et en JSON, plus « copier » ; une note exportée cite le mot ou la leçon d'origine.
- Sur mobile : champ de saisie confortable (police ≥ 16 px), clavier vietnamien Telex/VNI disponible dans la note.

## 4. Navigation

Barre basse à 4 entrées : **Accueil · Apprendre · Réviser · Profil**. Les jeux restent accessibles depuis
« Apprendre » et « Réviser » (ils ne méritent pas un onglet). Les notes vivent dans « Réviser ».

## 5. Définition de « prêt à l'usage »

Une passe finale doit vérifier, écran par écran : cohérence visuelle, textes fr/en, états vides, chargement,
erreur, hors ligne, focus clavier, contraste, cibles tactiles, et qu'aucun écran ne renvoie vers une
fonctionnalité absente. Le résultat est consigné dans `docs/audits/ready-checklist.md`.
