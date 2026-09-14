# ADR 0001 — Stack technique

- Statut : accepté
- Date : 2026-09-14

## Contexte

Application mobile-first, installable (Android/iOS) sans passer par les stores au lancement,
utilisable hors ligne, avec traitement audio temps réel côté client et un backend léger.

## Décision

- **Front** : PWA React 19 + TypeScript strict + Vite, Tailwind CSS v4, React Router, Zustand
  (état de séance), TanStack Query (serveur), Dexie (IndexedDB), `vite-plugin-pwa` (Workbox).
- **Back** : FastAPI (Python 3.12), Pydantic v2, SQLAlchemy 2 + Alembic, PostgreSQL en UE.
- **Monorepo** : workspaces **npm** (pas de pnpm/turbo : zéro outil supplémentaire à installer).
  Le backend Python vit dans `apps/api`, géré par `uv`, hors workspaces npm.
- **Partagé** : `packages/core` (types, moteur d'exercices, FSRS, scoring) et
  `packages/south-lint` (garde du Sud), consommés par la PWA et les scripts CI.

## Dépendances justifiées

| Dépendance | Raison |
|---|---|
| `ts-fsrs` | Implémentation de référence de FSRS (ADR 0003) |
| `dexie` | IndexedDB avec transactions et requêtes indexées, sans ORM lourd |
| `vite-plugin-pwa` | Génération Workbox + manifeste intégrée au build |
| `ajv` | Validation JSON Schema du contenu en CI (ADR 0002) |
| `zustand` | État de séance local, ~1 ko, pas de boilerplate |
| `@radix-ui/*` (ciblé) | Accessibilité de dialog/tabs uniquement |

Refusées : bibliothèque de composants (MUI, Chakra…), moteur de jeu (Phaser, Pixi), Redux.

## Base de données en développement

La prod et `docker compose` utilisent PostgreSQL. Les tests de l'API et le démarrage sans Docker
utilisent SQLite via la même couche SQLAlchemy (aucune fonction SQL spécifique à Postgres
n'est autorisée dans le code applicatif sans test dédié).

## Conséquences

- iOS : notifications uniquement si la PWA est installée ; un écran d'aide à l'installation est obligatoire.
- Si les stores deviennent nécessaires, emballage Capacitor autour de la même PWA (pas de réécriture).
