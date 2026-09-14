# Parlo

Apprendre le vietnamien du Sud, 5 à 10 minutes par jour. PWA mobile-first, installable, hors ligne.
Spécification : [SPEC-parlo-vietnamien-sud.md](SPEC-parlo-vietnamien-sud.md) · Décisions : [docs/ADR](docs/ADR).

## Démarrer

### Avec Docker (une commande)

```bash
cp .env.example .env
docker compose up --build
docker compose exec api python -m app.seed   # utilisateur démo : demo@parlo.local / parlo-demo-2026
```

- PWA : http://localhost:5173 — API : http://localhost:8000/docs

### Sans Docker

Prérequis : Node 24, [uv](https://docs.astral.sh/uv/).

```bash
npm install
npm run dev                          # PWA sur http://localhost:5173 (fonctionne seule, en mode invité)

cd apps/api
uv sync
uv run alembic upgrade head          # SQLite local par défaut
uv run python -m app.seed
COOKIE_SECURE=false uv run uvicorn app.main:app --reload
```

## Structure

```
apps/web/             PWA React + Vite (Dexie, service worker Workbox)
apps/api/             FastAPI + SQLAlchemy + Alembic
packages/core/        types, moteur d'exercices, FSRS, planificateur de séance, série
packages/south-lint/  garde du Sud : détecte les formes lexicales du Nord
content/              packs de langue en JSON + schémas (aucun contenu dans le code)
scripts/              validation du contenu
docs/ADR/             décisions d'architecture
```

## Vérifier

```bash
npm run check                        # types + tests + schémas de contenu + south-lint
npm run build                        # build PWA (service worker compris)
cd apps/web && PW_CHANNEL=msedge npx playwright test   # parcours critiques (Chrome/Edge installé)
cd apps/api && uv run pytest -q
```

Le contenu se valide avec `npm run content:validate` (ajouter `-- --production` pour refuser le
contenu non relu et les médias manquants). Voir [CONTENT.md](CONTENT.md) pour la relecture.

## État d'avancement

**Phase 0 — fondations : livrée.** Critère d'acceptation vérifié par
[apps/web/e2e/guest-offline.spec.ts](apps/web/e2e/guest-offline.spec.ts) : un invité termine une leçon
hors ligne, et sa progression est conservée après un redémarrage à froid.

Pas encore fait (Phase 1 et suivantes) : enregistrements audio natifs, synchronisation de l'outbox
vers l'API et écrans de compte, test de placement, écran de choix de langue, mini-jeu Chợ nổi,
professeur IA, karaoké tonal, pages de démonstration par composant d'exercice.
