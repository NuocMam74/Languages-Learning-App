# ADR 0002 — Contenu piloté par les données

- Statut : accepté
- Date : 2026-09-14

## Contexte

Le vietnamien du Sud est le premier pack, pas le dernier. Le contenu doit être relu par des
locuteurs natifs non techniques et déployé sans migration de base.

## Décision

- **Aucune chaîne pédagogique dans le code.** Une langue = un pack versionné sous `content/<code>/`.
- Le contenu est du **JSON statique** validé par les schémas `content/schema/*.schema.json`
  (JSON Schema 2020-12) et servi depuis le CDN sous une URL versionnée (`/content/vi-south/v3/…`).
- La base de données ne stocke que des **identifiants** de contenu (`vi-south.u03.l02`, `c_ba`).
- Le moteur ne connaît que des **types d'exercices**. Les modules spécifiques (tons) sont activés
  par `pack.json#features`.
- Tout contenu produit par un modèle porte `"reviewed": false`. Un build de production refuse
  de publier une leçon non relue (le build de développement l'accepte avec un avertissement).
- Les fichiers audio sources (`wav`) restent hors git ; seuls `opus`/`m4a` et les courbes F0
  sont versionnés ou poussés vers R2.

## Conséquences

- CI : `content:validate` (schémas + intégrité référentielle : prérequis, concepts, refs culture)
  et `content:lint` (south-lint) sont bloquants.
- Renommer un id de concept est une rupture : l'état SRS des utilisateurs y est attaché.
  Les ids sont donc **immuables** ; on déprécie, on ne renomme pas.
