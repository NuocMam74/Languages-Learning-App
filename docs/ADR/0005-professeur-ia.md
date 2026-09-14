# ADR 0005 — Professeur IA (Cô Mai)

- Statut : accepté
- Date : 2026-09-14

## Décision

- Appel au modèle **exclusivement côté serveur** (`POST /tutor/message`, SSE ; `GET /tutor/greeting`),
  endpoint authentifié et rate-limité. Clé `ANTHROPIC_API_KEY` en variable d'environnement.
- Modèle configurable par `TUTOR_MODEL`. La spec fixe `claude-sonnet-4-6` ; on garde cette valeur
  par défaut et on évaluera la montée de version sur un jeu de dialogues de référence avant de changer.
- **Contexte injecté par le serveur** : contenu de la leçon courante, concepts vus, points faibles
  (issus de `answers`). Le client n'envoie jamais de prompt système.
- **Garde du Sud** : toute réponse contenant du vietnamien passe par `south-lint`. Forme du Nord
  détectée → une régénération avec consigne corrective → sinon message préécrit du contenu.
  En streaming, le texte est tamponné par phrase et vérifié avant envoi au client.
- **Budget** : quota quotidien de messages par utilisateur (`TUTOR_DAILY_QUOTA`), dégradation vers
  un message préécrit et la fiche de grammaire de la leçon.
- **Cache** : salutation du jour mise en cache 12 h par (utilisateur, date) ; explications
  « pourquoi ? » mises en cache par (étape de leçon, erreur, langue d'interface), non personnalisées.
- `tutor_messages` purgé en glissant à 90 jours.

## Conséquences

- Le vérificateur de variante est un paquet TypeScript : l'API l'utilise via sa donnée
  (`lexical-variants.json`) et une implémentation Python équivalente, testée sur le même jeu
  de cas (`packages/south-lint/cases.json`) pour garantir qu'elles restent alignées.
- Hors Phase 1, aucune fonctionnalité ne dépend de la disponibilité du modèle.
