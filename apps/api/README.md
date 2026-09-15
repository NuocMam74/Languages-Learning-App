# Parlo API (FastAPI)

API Parlo : auth, `/me`, synchronisation des événements hors ligne, plan de séance, Cô Mai (Phase 1).
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

## Derrière un préfixe `/api` (PWA)

Le web appelle l'API en même origine via `/api/*` (proxy Vite en dev), ou via `VITE_API_BASE` en prod.

- **Proxy qui retire le préfixe** (Vite `rewrite: p => p.replace(/^\/api/, "")`, nginx `proxy_pass http://api:8000/;`) :
  lancer l'API avec `ROOT_PATH=/api`. FastAPI publie alors ses URLs (`/docs`, OpenAPI) sous `/api`, et le cookie
  de refresh est posé sur `Path=/api/auth`, le chemin que voit le navigateur. Un proxy qui conserve le préfixe
  fonctionne aussi (le `root_path` est retiré avant le routage).
- **Appel direct** (`VITE_API_BASE=https://api.exemple.fr`) : laisser `ROOT_PATH` vide (cookie sur `/auth`),
  ajouter l'origine du web à `CORS_ORIGINS` ; le cookie étant `SameSite=Lax`, web et API doivent partager le même
  site (ex. `app.exemple.fr` et `api.exemple.fr`).

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
| `GET /me?localDate=` · `PATCH /me/profile` | Utilisateur, profil, inscription, série, `levelEstimate`, `badges`, `dailyGoal` |
| `GET /courses` · `GET /courses/{code}/manifest` | Packs disponibles, fichiers et URL de base versionnée |
| `POST /me/events` | Lot d'événements (`{events: [...]}`, ≤ 500), idempotent sur `id` (dont `placement_completed`, `badge_earned`) |
| `GET /me/srs/due?limit=` · `GET /me/session/next` | Cartes dues, plan de séance |
| `GET /tutor/greeting?locale=fr\|en&localDate=` | Salutation de Cô Mai → `{text, cached, source}` (cache 12 h) |
| `POST /tutor/why` | `{lessonId, stepIndex, given, expected, locale}` → `{text, cached, source}` (cache partagé) |
| `GET /exams` · `POST /exams/{id}/start` · `POST /exams/attempts/{id}/submit` | Examens A0/A1 (contrat `docs/contracts/phase2.md` §2), notation serveur |
| `GET /certificates` · `GET /certificates/{id}.pdf` · `GET /verify/{code}` (public) | Certificats PDF et vérification |
| `GET /challenges/current` · `POST /challenges/{id}/claim` | Défi de la semaine (+50 XP, badge `challenge_<kind>`) |
| `GET /push/vapid-public-key` (public) · `POST`/`DELETE /push/subscribe` | Rappels Web Push |
| `POST /tutor/conversations` · `POST /tutor/conversations/{id}/messages` (SSE) · `GET …/{id}` · `POST …/{id}/end` | Conversation avec Cô Mai et Đối đáp (contrat `docs/contracts/phase3.md` §1) |
| `GET /tutor/debrief/weekly?locale=` | Débriefing hebdomadaire (cache par semaine/langue, repli construit des données) |
| `GET /leagues/me` | Ligue de la semaine (groupes de 30, divisions 1..5) |
| `POST`/`GET /challenges/friends` · `POST /challenges/friends/join/{code}` | Défis entre amis (7 jours, 10 participants) |
| `POST /challenges/express/scores` · `GET /share/express/{id}` (public) | Défi express : meilleur score et rang du jour, partage |
| `GET /healthz` | Sonde |

- `app/services/planner.py`, `streak.py`, `srs.py` : portages fidèles de `packages/core` (mêmes constantes).
- `app/south_lint.py` : portage de `packages/south-lint`.
- `app/services/tutor.py` : Cô Mai. Prompt système figé (persona, garde-fous §5.7, lexique du Sud) marqué
  pour le cache de prompt, contexte injecté dans le tour `user`. Sortie vérifiée par `south_lint` (+ longueur,
  formulations culpabilisantes) → une régénération corrective → repli préécrit (`source: "fallback"`) ;
  même repli sans `ANTHROPIC_API_KEY`, sur erreur/délai, ou quota `TUTOR_DAILY_QUOTA` atteint.
  Le client modèle est derrière `TutorLLM` (`app/services/tutor_llm.py`) : les tests n'appellent jamais le réseau.
- Conversation (`app/services/conversation.py`) : flux du modèle tamponné par phrase, garde du Sud avant chaque
  émission (régénération corrective une fois, puis `fallback`), vocabulaire limité aux concepts vus (+15 %),
  gloses (contenu, sinon bloc JSON `[[META]]` du modèle), correction douce ; formule de fluidité en tête du module.
- Plusieurs packs : inscription courante = dernier `pack_switched`, sinon `vi-south` ; les événements portent le
  pack par l'id de leçon (`es.u01.l01`) ou de concept (`es_…`, `c_es_…`) ; `GET /me/session/next?pack=`.
- Purge glissante (à planifier quotidiennement, cron ou tâche planifiée) :
  `uv run python -m app.maintenance purge-tutor` (messages > `TUTOR_RETENTION_DAYS`, cache expiré).
- Badges : codes connus seulement (`streak_7`, `streak_30`, `first_lesson`, `unit_1_done`, `words_50`, `tone_ear`,
  voir `app/services/badges.py` et la migration 0002) ; code inconnu → rejet `unknown_badge`.
- Examens (`app/services/exams.py`, `engine.py`, `text.py`) : portage de `buildExam`/`gradeExam`, `buildExercise`,
  `evaluate` et de l'aléa déterministe de `packages/core`. Graine d'un item : `${attemptId}:${examId}:${rang}`.
  Parité vérifiée par `tests/test_core_parity.py` sur `tests/fixtures/core_parity.json` ; à régénérer depuis la
  racine après toute modification de engine/text/session/exams/challenges :
  `npx tsx apps/api/tests/fixtures/generate_core_fixtures.ts`.
- Certificats PDF (`app/services/pdf.py`) : WeasyPrint en production (Pango installé dans l'image Docker),
  repli pur Python fpdf2 (Windows sans GTK). Polices OFL embarquées (`app/assets/fonts`). Stockage local
  (`MEDIA_DIR`) ou S3 (`STORAGE_BACKEND=s3`), PDF régénéré si absent.
- Tâches planifiées (`app/scheduler.py`, `SCHEDULER_ENABLED=true` sur un seul processus) : défi du lundi
  00:00 UTC, passage de semaine des ligues, rappels push horaires. Sans planificateur intégré : `python -m app.maintenance weekly-challenge`
  et `push-reminders` (cron), `leagues-rollover` (lundi 00:00 UTC, idempotent). Clés VAPID : `uv run python -m app.maintenance vapid-keys`.
- Nouvelle migration : `uv run alembic revision --autogenerate -m "..."`, puis remplacer
  `app.db.UTCDateTime()` par `sa.DateTime(timezone=True)` dans le fichier généré.
