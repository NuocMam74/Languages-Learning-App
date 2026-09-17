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
apps/web/             PWA React + Vite (Dexie, service worker Workbox) — apprenant, studio (/studio), enseignant (/prof)
apps/api/             FastAPI + SQLAlchemy + Alembic — comptes, synchro, Cô Mai, examens, ligues, studio, classes
packages/core/        types, moteur d'exercices, FSRS, séance, série, badges, examens, défis, jeux, hauteur tonale (pitch/)
packages/south-lint/  garde du Sud : détecte les formes lexicales du Nord
content/              packs vi-south (24 unités, examens A0–A2) et es (preuve d'extensibilité) + schémas
scripts/              validation du contenu, garde du Sud, pipeline audio (scripts/audio)
docs/                 ADR, contrats par phase, décision d'abonnement, guide audio
```

## Vérifier

```bash
npm run check                        # types + tests + schémas de contenu + south-lint
npm run build                        # build PWA (service worker compris)
cd apps/web && PW_CHANNEL=msedge npx playwright test   # parcours critiques (Chrome/Edge installé)
cd apps/api && uv run pytest -q

# Intégration réelle PWA + API (API sur :8000 avec ROOT_PATH=/api, `vite` sur :5173)
cd apps/web && PARLO_INTEGRATION=1 npx playwright test e2e/integration*.spec.ts
# (integration-studio.spec.ts exige aussi STUDIO_PUBLISH_ENABLED=true et PARLO_CONTENT_DIR = CONTENT_DIR de l'API)
```

Le contenu se valide avec `npm run content:validate` (ajouter `-- --production` pour refuser le
contenu non relu et les médias manquants). Voir [CONTENT.md](CONTENT.md) pour la relecture.

## Déployer

### Scénario A — la PWA seule (hébergement statique)

`npm run build` produit un site **entièrement statique** dans `apps/web/dist` (5,8 Mo, contenu des
packs compris). Aucun serveur, aucune base : le mode invité fonctionne hors ligne, et tout ce qui
est local le reste (progression, notes, xu, trophées, collections, personnage).

Réglages de l'hébergeur :

| | |
|---|---|
| Build | `npm ci && npm run build` |
| Dossier publié | `apps/web/dist` |
| Node | 24 |

Le déploiement passe par **Cloudflare Workers (Static Assets)** :

- [apps/web/wrangler.jsonc](apps/web/wrangler.jsonc) — la config. Le dépôt étant un monorepo npm,
  `wrangler deploy` lancé à la racine ne sait pas quoi déployer (« application detection logic has
  been run in the root of a workspace ») : il faut donc pointer la config explicitement.
- [apps/web/worker.js](apps/web/worker.js) — trois rôles, écrits en clair plutôt que déduits d'un
  `not_found_handling` : **404 JSON franc sur `/api/*`** (sans quoi l'appel de rafraîchissement
  recevrait `index.html` en 200 et l'app se croirait hors ligne en permanence), **repli monopage**,
  et `sw.js` servi en `no-cache`.
- [apps/web/public/_headers](apps/web/public/_headers) — `assets/` et `content/` immuables (noms
  hachés, version dans le chemin), coquille et manifeste revalidés.

Réglages côté Cloudflare, en plus du build :

| | |
|---|---|
| Deploy command | `npx wrangler deploy --config apps/web/wrangler.jsonc` |

Vérifié en local avec `npx wrangler dev --config apps/web/wrangler.jsonc` : `/`, `/missions`,
`/atelier`, `/recompenses`, `/jeux/lo_to` rendent l'app en `text/html`, `/api/*` renvoie
`{"detail":"api_unavailable"}` en 404, `content/` est immuable et `sw.js` en `no-cache`.

Sur un hébergeur de type Netlify, le même résultat s'obtient avec un fichier `_redirects`
(`/api/*  /no-api.json  404` puis `/*  /index.html  200`) au lieu du Worker.

**Deux contraintes à respecter :** l'app doit être servie à la **racine d'un domaine** (Vite n'a pas
de `base`, le routeur pas de `basename` — un sous-chemin la casse), et en **HTTPS** (sans quoi pas
de service worker, donc ni installation ni hors ligne).

Ce que ce scénario ne donne pas, faute d'API : compte, synchronisation entre appareils, Cô Mai,
ligues, défis entre amis, classes, certificats PDF. Les écrans concernés se replient proprement.

### Scénario B — avec l'API

[docker-compose.yml](docker-compose.yml) documente toutes les variables ; l'image de l'API est
[apps/api/Dockerfile](apps/api/Dockerfile). Il faut un hébergeur Docker et un Postgres. Ce qui
change par rapport au développement : `ENV=production` (l'API refuse de démarrer avec le
`JWT_SECRET` par défaut ou plus court que 32 caractères), `COOKIE_SECURE=true`, `CORS_ORIGINS` et
`PUBLIC_WEB_URL` / `PUBLIC_API_URL` sur les URL publiques réelles, `VAPID_*` pour le push,
`ANTHROPIC_API_KEY` pour Cô Mai.

Côté front, `VITE_API_BASE` (défaut `/api`) choisit la cible : même domaine derrière un proxy, ou
l'origine complète de l'API (`VITE_API_BASE=https://api.exemple.fr`).

## État d'avancement

Toutes les phases de la spécification (§15) sont implémentées et testées ; chaque critère d'acceptation
vérifiable sans matériel est couvert par un test e2e ou d'intégration réelle.

| Phase | Livré | Vérification |
|---|---|---|
| 0 Fondations | monorepo, schémas, moteur, PWA hors ligne, mode invité | `e2e/guest-offline.spec.ts` |
| 1 MVP | séance du jour + SRS, placement, comptes et synchro, badges, Cô Mai (accueil, « pourquoi ? »), Chợ nổi, unités 1–4 | `phase1.spec.ts`, `integration.spec.ts`, Lighthouse mobile 91 / a11y 100 |
| 2 Motivation et voix | karaoké tonal (F0 + DTW), Xe ôm, Bữa cơm, défis, push, gel de série, examens A0/A1 + certificats vérifiables, unités 5–11 | `karaoke.spec.ts` (écart < 10 pts), `phase2-exams.spec.ts`, `integration-exam.spec.ts` |
| 3 Social et échelle | conversation Cô Mai (SSE, texte/voix), Đối đáp, bilan hebdo, ligues, défis entre amis/express, Nhớ mặt, unités 12–24, A2, pack `es` | `phase3-*.spec.ts`, `integration-social.spec.ts` |
| 4 Ouverture | studio de contenu (éditeurs, validation, aperçu, relecture native, audio + F0, publication), espace enseignant | `phase4-*.spec.ts`, `integration-studio.spec.ts` |

### Reste à faire hors code

- **Voix natives du Sud** : aucun enregistrement n'existe ; en production les exercices de tons restent muets.
  Liste à enregistrer : `npm run audio:list` ; procédure : [docs/AUDIO.md](docs/AUDIO.md) ; import via le studio.
- **Relecture native** de tout le corpus (`reviewed: false`), doutes prioritaires dans `content/vi-south/_review/doubts.json`.
- **Modèle économique** à arbitrer : [docs/decisions/abonnement.md](docs/decisions/abonnement.md) (rien n'est codé côté paiement).
- **Non vérifiable ici** : image Docker et Postgres réel, envoi push réel, iOS/Safari et vrais téléphones, appels réels au modèle
  (clé `ANTHROPIC_API_KEY` absente : Cô Mai répond par ses messages de repli), calibration du karaoké sur de vraies voix.
