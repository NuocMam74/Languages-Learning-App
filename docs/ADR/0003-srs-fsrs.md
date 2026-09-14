# ADR 0003 — Répétition espacée : FSRS

- Statut : accepté
- Date : 2026-09-14

## Décision

- Algorithme **FSRS** via `ts-fsrs`, encapsulé dans `packages/core/src/srs.ts` : le reste du code
  ne dépend jamais directement de `ts-fsrs` (remplaçable, testable).
- Une carte SRS porte sur un **concept**, jamais sur un exercice.
- La note FSRS (Again/Hard/Good/Easy) est **dérivée automatiquement** par `deriveRating()` :
  justesse, temps de réponse relatif au format, poids du format (production orale > QCM).
  L'utilisateur ne note jamais lui-même.
- Calcul **côté client** (fonctionne hors ligne) ; l'état est persisté localement puis synchronisé.
- Le planificateur de séance applique un **plafond d'items** calculé depuis la durée annoncée ;
  les révisions en surplus glissent au lendemain.

## Conflits de synchronisation

Pour une même carte, l'état « le plus avancé » gagne : `reps` le plus élevé, puis `last_review`
le plus récent. Les réponses (`answers`) sont en ajout seul et jamais écrasées.

## Conséquences

- Le serveur peut recalculer tout l'état SRS à partir du journal `answers` si besoin (rejeu).
- Les paramètres FSRS par défaut sont utilisés au MVP ; l'optimisation par utilisateur viendra
  quand il y aura ≥ 1000 révisions par profil.
