# Modèle économique — recommandation [À ARBITRER]

Statut : **proposition, rien n'est codé côté paiement.** Décision attendue du porteur du projet (spec §15 Phase 3, §17 q.3).

## Contraintes posées par la spec

- Anti-objectifs : « un abonnement qui punit », des vies qui bloquent, des notifications culpabilisantes.
- Le parcours doit rester motivant sans payer : la séance quotidienne, le SRS et la carte du parcours sont le cœur.
- Coûts variables réels : appels au modèle de Cô Mai (par message), stockage audio/CDN, génération de PDF.

## Recommandation

**Freemium sans mur pédagogique, lancé en fin de Phase 2 (quand examens et Cô Mai existent).**

| Gratuit, pour toujours | Parlo+ (payant) |
|---|---|
| Tout le parcours A0 → A2, toutes les leçons, SRS, jeux, séries, badges, défis | Conversation illimitée avec Cô Mai (gratuit : 5 messages/jour + accueil + « pourquoi ? » en cache) |
| Examens **blancs** illimités | Examens **certifiants** A0/A1/A2 et diplômes PDF vérifiables |
| Hors ligne pour l'unité en cours | Hors ligne étendu (tout le pack téléchargeable) |
| Karaoké tonal | Débriefing hebdomadaire détaillé de Cô Mai |

Pourquoi ce découpage :
1. **Le payant suit le coût variable** (modèle de langue, certification) — pas la progression. Personne n'est bloqué
   au milieu d'une unité, conformément aux anti-objectifs.
2. **Le certificat a une valeur perçue forte** et un coût (vérification, PDF) : c'est le déclencheur d'achat naturel,
   au moment d'une réussite, pas d'une frustration.
3. **Les personas famille/racines** (motivation intrinsèque) obtiennent l'essentiel gratuitement : c'est aussi le
   meilleur canal de bouche-à-oreille (partage des diplômes, défis entre amis).

## Prix indicatifs (à valider par un test)

- Mensuel 7,99 € · Annuel 49,99 € (≈ 4,17 €/mois) · Examen certifiant à l'unité 9,99 € (sans abonnement).
- Essai 7 jours de Parlo+ déclenché **après** la première unité terminée, jamais à l'installation.

## Ce qu'il faudrait construire une fois la décision prise

- Droits (`entitlements`) côté API, vérifiés sur `/tutor/*` et `/exams/*/start` ; aucun contrôle sur les leçons.
- Paiement : Stripe (web) ; si les stores deviennent nécessaires (Capacitor), achats intégrés Apple/Google avec
  réconciliation serveur (RevenueCat simplifie). Coût d'intégration estimé : 1 à 2 semaines.
- Quotas gratuits de Cô Mai configurables (`TUTOR_DAILY_QUOTA` existe déjà).

## Alternatives écartées

- **Tout gratuit + dons** : ne couvre pas le coût du modèle à l'échelle.
- **Paywall après l'unité 2** : contraire à « un abonnement qui punit » ; mauvais pour la rétention des personas famille.
- **Publicité** : incompatible avec l'expérience calme visée (§13) et avec la minimisation des données (§14).
