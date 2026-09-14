# Contrat Phase 2 — examens, certificats, défis, notifications, prononciation

Document de coordination entre agents (API, PWA, contenu, jeux). Toute divergence se
corrige ici d'abord. JSON en camelCase. Toutes les routes `/me/*`, `/exams/*`, `/challenges/*`,
`/push/*` exigent le JWT, sauf mention « public ».

## 1. Nouveaux événements (packages/core/src/events.ts — déjà ajoutés)

| type | payload | effet serveur |
|---|---|---|
| `pronunciation_scored` | `{sessionId: string\|null, conceptId, score: 0..100, exerciseType}` | ligne `pronunciation_scores` (score seul) ; progression des défis « parole » |
| `streak_frozen` | `{frozenUntil: "AAAA-MM-JJ", localDate}` | `streaks.frozen_until` (max 14 jours après localDate, sinon rejet `invalid`) |
| `game_played` | `{game, correct, total, durationMs, localDate}` | progression des défis ; aucune XP côté serveur |

## 2. Examens (spec §5.5)

### 2.1 Fichier de contenu `content/<pack>/exams/<level>.json` — schéma `content/schema/exam.schema.json`

```json
{
  "id": "vi-south.exam.a0",
  "level": "A0",
  "certificate": { "fr": "A0 Bén rễ", "en": "A0 Bén rễ" },
  "requiresUnits": ["vi-south.u01", "vi-south.u02", "vi-south.u03", "vi-south.u04"],
  "durationMinutes": 15,
  "passThreshold": 0.75,
  "retryAfterHours": 48,
  "sections": [
    { "skill": "listening",  "items": [ /* LessonStep : listen_pick_image, listen_pick_text, tone_identify, tone_minimal_pair */ ] },
    { "skill": "reading",    "items": [ /* LessonStep : spot_the_south, build_sentence (lecture de la traduction), listen_pick_text avec "silent": true */ ] },
    { "skill": "vocabulary", "items": [ /* LessonStep : listen_pick_image, build_sentence */ ] },
    { "skill": "speaking",   "items": [ /* LessonStep : speak_repeat, tone_produce */ ] }
  ],
  "reviewed": false
}
```

- Chaque item est `{ "step": LessonStep, "silent"?: true }` où `step` suit `lesson.schema.json#/$defs/step`
  (sans `culture_card` ni `game`). `silent: true` = pas d'audio (lecture pure). Les commentaires ci-dessus
  listent les types de `step` attendus par section.
- **25 items au total**, chaque section ≥ 4 items. Tous les concepts référencés appartiennent aux `requiresUnits`.

### 2.2 Notation (identique client et serveur)

- Score par compétence = items justes / items de la compétence. Score global = moyenne **pondérée par le nombre d'items**.
- `speaking` : item juste si score de prononciation ≥ `SPEAK_PASS_SCORE` (60). Micro refusé → item faux (l'examen certifiant exige l'oral ; l'examen blanc l'autorise en non noté).
- Réussite si global ≥ `passThreshold` **et** chaque compétence ≥ 0.5.
- Le serveur est l'autorité : il rejoue `evaluate` sur les réponses brutes (ordre des options déterminé par la graine `attemptId`).

### 2.3 API

```
GET  /exams                       -> [{id, level, certificate, requiresUnits, durationMinutes, unlocked: bool,
                                       lastAttempt: {id, submittedAt, passed, scores}|null, nextAttemptAt: ISO|null}]
POST /exams/{examId}/start        -> 201 {attemptId, seed, startedAt, expiresAt, items: [{section, index}]}
                                     409 {detail:"retry_locked", nextAttemptAt}   403 {detail:"locked_units"}
POST /exams/attempts/{id}/submit  body {answers: [{section, index, response: ExerciseResponse, responseMs}]}
                                  -> {passed, global: 0..1, scores: {listening, reading, vocabulary, speaking},
                                      gaps: [{skill, conceptIds}], certificate: {id, verificationCode}|null}
                                     410 si expiré (> durationMinutes + 2 min de grâce)
GET  /certificates                -> [{id, level, issuedAt, verificationCode, pdfUrl, shareImageUrl}]
GET  /certificates/{id}.pdf       -> application/pdf
GET  /verify/{code}               -> public : {valid, displayName, level, certificate, issuedAt, scores}
                                     404 {valid:false}
```

- `ExerciseResponse` = type de `packages/core/src/engine.ts`. Pour `speak_repeat`/`tone_produce` : `{kind:"speech", score}` (score calculé localement, audio jamais envoyé).
- L'**examen blanc** est 100 % client (même fichier, notation core `exams.ts`), sans appel serveur, disponible à tout moment, indique les lacunes.
- `verificationCode` : 10 caractères Crockford base32, unique. Page publique web `/verifier/:code` qui appelle `/verify/{code}`.
- PDF : nom, date, niveau, score par compétence, code, URL de vérification. Image de partage carrée générée côté client (canvas).

## 3. Défis de la semaine (spec §5.2)

```
GET  /challenges/current          -> [{id, kind, title:{fr,en}, target, unit, progress, completedAt|null,
                                       claimedAt|null, periodStart, periodEnd, badgeCode}]
POST /challenges/{id}/claim       -> {claimedAt, xp}   409 si non terminé ou déjà réclamé
```

- `kind` ∈ `words_theme` (mots nouveaux appris, `unit` = unitId), `streak_days`, `speaking_minutes` (via `pronunciation_scored`, 1 item = 10 s), `lessons`, `game_score` (parties avec ratio ≥ 0.7).
- Généré chaque lundi 00:00 UTC (APScheduler), 1 défi par semaine, rotation déterministe ; progression recalculée depuis les événements de la période.
- Client : affichage sur le hub + calcul local optimiste hors ligne (core `challenges.ts` avec les mêmes règles).

## 4. Notifications push (spec §5.8)

```
GET  /push/vapid-public-key       -> public : {key}
POST /push/subscribe              body {endpoint, keys:{p256dh, auth}, reminderHour, timezone} -> 204
DELETE /push/subscribe            body {endpoint} -> 204
```

- Une notification par jour max, à `reminderHour` dans `timezone` (IANA), seulement si aucune séance terminée ce jour local.
- Textes : gabarits non culpabilisants dans la langue d'interface (interdits §5.8), voix de Cô Mai. Clic → ouvre `/`.
- iOS : uniquement si installé ; la PWA affiche l'écran d'explication d'installation avant de proposer.

## 5. Profil

`PATCH /me/profile` accepte en plus `timezone` (IANA) et `notificationsEnabled`.
