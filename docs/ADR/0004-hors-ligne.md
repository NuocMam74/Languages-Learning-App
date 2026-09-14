# ADR 0004 — Hors ligne d'abord, synchronisation par événements

- Statut : accepté
- Date : 2026-09-14

## Décision

- **Stockage local** : IndexedDB via Dexie. Tables : `packs`, `lessons`, `concepts`, `srsCards`,
  `lessonProgress`, `outbox` (événements non synchronisés), `sessionSnapshot` (reprise exacte).
- **Service worker** (Workbox) : app shell en precache ; JSON de contenu en
  `StaleWhileRevalidate` ; audio en cache dédié `audio-v1` avec expiration LRU (quota 200 Mo).
- **Événements** : toute action pédagogique produit un événement `{ id (UUID v7 client),
  type, occurredAt, payload }` écrit dans `outbox` dans la **même transaction** que la mise à jour
  d'état local. Aucune écriture d'état sans événement.
- **Sync** : envoi par lots à `POST /me/events` à la reconnexion et au retour au premier plan.
  Le serveur est **idempotent** sur `id`. Réponse = ids acceptés → purge de l'outbox.
- **Invité** : tout fonctionne sans compte. À l'inscription, l'outbox complète (historique compris)
  est rejouée sous le nouvel utilisateur.

## Conséquences

- L'horodatage fait foi côté client ; le serveur enregistre aussi `received_at` pour détecter
  les horloges aberrantes (> 24 h dans le futur → rejet de l'événement).
- La reprise de séance repose sur `sessionSnapshot`, réécrit après chaque réponse.
