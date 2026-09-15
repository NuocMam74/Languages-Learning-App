# Contrat Phase 3 — conversation avec Cô Mai, ligues, défis entre amis, partage, 2e pack

JSON camelCase ; JWT requis sauf mention « public ». Événements : `packages/core/src/events.ts`.

## 1. Conversation libre avec Cô Mai (spec §5.7)

```
POST /tutor/conversations                  body {locale, mode: "free"|"doi_dap", topicLessonId?}
                                           -> 201 {conversationId, opening: {text, glosses}}
POST /tutor/conversations/{id}/messages    body {text, inputMode: "text"|"voice"}
                                           -> text/event-stream
GET  /tutor/conversations/{id}             -> {id, mode, turns: [{role, text, glosses, correction|null}], endedAt|null, fluency|null}
POST /tutor/conversations/{id}/end         -> {fluency: 0..100|null, summary: {fr|en: string}}
GET  /tutor/debrief/weekly?locale=         -> {weekStart, progress: string, struggles: string, goal: string, source: "model"|"fallback", cached}
```

Flux SSE de `messages` (une ligne `data:` JSON par événement) :

| event | data |
|---|---|
| `sentence` | `{text}` — une phrase **déjà vérifiée** par la garde du Sud (tampon par phrase) |
| `gloss` | `{vi, gloss: {fr, en}}` — mot nouveau (hors vocabulaire vu) glosé |
| `correction` | `{original, corrected, explanation}` — correction douce du message de l'utilisateur, en fin de tour |
| `done` | `{turn, remainingToday}` |
| `fallback` | `{text, reason: "quota"|"south_guard"|"error"}` — remplace le tour |

Règles serveur : vocabulaire limité aux concepts vus par l'utilisateur (+15 % de mots nouveaux, tous glosés) ;
Sud exclusivement ; explications dans la langue d'interface ; phrases courtes (≤ 3 phrases par tour) ;
hors sujet refusé gentiment ; quota partagé avec `TUTOR_DAILY_QUOTA` ; historique `tutor_messages` purgé à 90 j.

**Mode `doi_dap` (mini-jeu Đối đáp, §5.6.5)** : 6 tours, 20 s par réponse (chronométré côté client, envoyé
dans `messages` avec `responseMs`), `end` renvoie `fluency` = f(tours répondus, temps de réponse, corrections).

Voix : saisie vocale via Web Speech API quand disponible (jamais obligatoire) ; la voix de Cô Mai peut être
synthétisée (marqueur « voix de synthèse ») — autorisé hors exercices de tons.

## 2. Ligues (spec §5.3)

```
GET   /leagues/me        -> {enabled, division: 1..5, divisionName: {fr,en}, weekStart, weekEnd,
                             standings: [{rank, displayName, xp, isMe}], promoteTop: 5, relegateBottom: 5} | {enabled:false}
PATCH /me/profile        -> leaguesEnabled (déjà existant)
```

- Groupes de 30 par division, formés le lundi 00:00 UTC parmi les utilisateurs actifs la semaine précédente
  et `leaguesEnabled = true`. XP de la semaine = somme des `xpGained` (session_completed) + XP de défis.
- Fin de semaine : top 5 montent, bottom 5 descendent (bornes 1..5). Désactivée par défaut pour motivation
  family/roots (déjà en place). Noms de divisions : thème fluvial/marché du Sud (contenu, dans le pack).
- Pas de chat entre utilisateurs (§14). `displayName` seulement.

## 3. Défis entre amis & défi express (spec §5.2)

```
POST /challenges/friends                 body {kind: "xp_7d"} -> 201 {id, inviteCode, inviteUrl, endsAt}
POST /challenges/friends/join/{code}     -> {id, participants: [{displayName, xp, isMe}], endsAt}
GET  /challenges/friends                 -> [{id, inviteCode, endsAt, participants: [...] }]
POST /challenges/express/scores          body {game: "cho_noi", score, correct, total, localDate} -> {id, best, rankToday: number|null}
GET  /share/express/{id}                 -> public : {displayName, game, score, createdAt}
```

- Défi entre amis : jusqu'à 10 participants, 7 jours, XP gagnée pendant la période. Lien `/{locale?}/defi/:code`.
- Défi express : 60 s de Chợ nổi, score = justes × 10 + bonus vitesse ; rejouable ; image de partage générée
  côté client (canvas 1080×1080) ; `share/express/{id}` pour une page publique `/partage/:id`.

## 4. Nouveaux événements

| type | payload |
|---|---|
| `conversation_turn` | `{conversationId, mode, words: number, responseMs, localDate}` (défis « parole », statistiques) |
| `pack_switched` | `{fromPack: string|null, toPack: string}` |

## 5. Deuxième pack (preuve d'extensibilité)

- Pack `es` (espagnol, variante neutre d'Amérique latine), `features: []` (pas de tons, pas de variantes lexicales),
  1 unité de 3 leçons `reviewed:false`. Aucun changement de moteur spécifique à l'espagnol : si un changement est
  nécessaire, il doit être générique (piloté par `pack.features`).
- L'app gère plusieurs packs : progression, SRS, outbox et snapshot **par pack** (clé `packCode`) ; choix de langue
  actif ; l'API accepte `enrollments` multiples (`course_id` = code de pack) et les événements portent le pack
  via la leçon/le concept (préfixe d'id) — les concepts de `es` sont préfixés `c_es_` / `s_es_` (motif du schéma) pour éviter toute collision ; l'API accepte `es_`, `c_es_`, `s_es_`.

## 6. Convention de numérotation des unités 12 à 24

Chaque unité a exactement 8 leçons : l01–l06 régulières, l07 révision, l08 test d'unité. La première leçon d'une
unité requiert `vi-south.u(N-1).l08` (u12.l01 requiert le test d'unité de u11, quel que soit son numéro).
