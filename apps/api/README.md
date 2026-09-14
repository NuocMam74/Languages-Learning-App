# Parlo API (FastAPI)

API de la Phase 0 : auth, `/me`, synchronisation des événements hors ligne, plan de séance.
Le contenu pédagogique est lu depuis `content/` (jamais en base, spec §11).

## Démarrage local sans Docker (SQLite)

```sh
cd apps/api
uv sync
uv run alembic upgrade head          # crée apps/api/parlo.db
uv run python -m app.seed            # demo@parlo.local / parlo-demo-2026
COOKIE_SECURE=false uv run uvicorn app.main:app --reload
```

Documentation interactive : http://localhost:8000/docs.
`COOKIE_SECURE=false` n'est nécessaire qu'en http local (le cookie de refresh est `Secure` par défaut).
Variables : voir `.env.example` à la racine (lu automatiquement s'il est copié en `.env`).

## Avec Docker (PostgreSQL)

```sh
docker compose up --build
docker compose exec api python -m app.seed
```

## Tests et lint

```sh
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
```

Les tests utilisent une base SQLite temporaire et le contenu réel du dépôt ;
`tests/test_south_lint.py` rejoue `packages/south-lint/cases.json`.

## Repères

| Route | Rôle |
|---|---|
| `POST /auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` | JWT d'accès 15 min + refresh en cookie `httpOnly` (30 j, rotation, révocable) |
| `GET /me` · `PATCH /me/profile` | Utilisateur, profil, inscription, série |
| `GET /courses` · `GET /courses/{code}/manifest` | Packs disponibles, fichiers et URL de base versionnée |
| `POST /me/events` | Lot d'événements (`{events: [...]}`, ≤ 500), idempotent sur `id` |
| `GET /me/srs/due?limit=` · `GET /me/session/next` | Cartes dues, plan de séance |
| `GET /healthz` | Sonde |

- `app/services/planner.py`, `streak.py`, `srs.py` : portages fidèles de `packages/core` (mêmes constantes).
- `app/south_lint.py` : portage de `packages/south-lint`.
- Nouvelle migration : `uv run alembic revision --autogenerate -m "..."`, puis remplacer
  `app.db.UTCDateTime()` par `sa.DateTime(timezone=True)` dans le fichier généré.
