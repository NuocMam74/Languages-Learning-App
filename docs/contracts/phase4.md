# Contrat Phase 4 — studio de contenu, espace enseignant

JSON camelCase ; JWT requis partout sauf mention. Rôles vérifiés côté serveur.

## 0. Rôles

`users.roles` : ensemble parmi `learner` (implicite), `reviewer` (locuteur natif relecteur), `editor`, `teacher`, `admin`.
Attribution : `uv run python -m app.maintenance grant-role <email> <role>` et `PUT /admin/users/{id}/roles` (admin).
`GET /me` renvoie `roles: string[]`.

## 1. Studio de contenu (spec §15 Phase 4) — `reviewer`, `editor`, `admin`

Principe : le contenu reste des fichiers JSON versionnés (ADR 0002). Le studio édite des **brouillons** en base,
les valide (mêmes schémas et `checkContent` que la CI) et les **publie** en écrivant les fichiers dans `CONTENT_DIR`
(dépôt de travail : l'équipe relit le diff et committe). Rien n'est publié sans validation sans erreur.

```
GET    /studio/packs                                   -> [{code, name, version}]
GET    /studio/packs/{code}/tree                       -> {units:[{id,title,status,lessons:[{id,title,kind,reviewed,draft: bool}]}],
                                                          concepts:[{id,vi,reviewed,draft}], culture:[{id,reviewed,draft}]}
GET    /studio/packs/{code}/documents/{kind}/{id}      -> {kind, id, published: object|null, draft: {data, updatedAt, updatedBy}|null}
PUT    /studio/packs/{code}/documents/{kind}/{id}      body {data, baseUpdatedAt|null} -> {updatedAt}   409 si conflit (baseUpdatedAt périmé)
DELETE /studio/packs/{code}/documents/{kind}/{id}/draft -> 204
POST   /studio/packs/{code}/validate                   -> {errors:[{where,message}], warnings:[...]}  (brouillons superposés au publié)
POST   /studio/packs/{code}/publish                    body {documents:[{kind,id}], message} -> {written:[paths], packVersion}
                                                          422 si validation en erreur ; 403 si STUDIO_PUBLISH_ENABLED=false
```

- `kind` ∈ `lesson`, `concept`, `culture`, `curriculum`, `lexical-variants`, `exam`, `pack`.
- Validation serveur : l'API exécute le **même validateur que la CI** via `npx tsx scripts/validate-content.ts --root <dir temporaire>`
  sur une copie superposée (le script doit accepter `--root`). Sortie JSON avec `--json`.
- Publication : écrit les fichiers (NFC, indentation 2, LF), incrémente `pack.version` si des fichiers ont changé,
  journalise (`content_publications`: user, message, fichiers, date).

### Relecture native

```
GET  /studio/packs/{code}/review-queue?kind=&unit=     -> [{kind, id, title, vi: string[], doubts: string[]}]   (reviewed:false)
POST /studio/packs/{code}/documents/{kind}/{id}/review body {verdict:"approve"|"changes", comment} -> {reviewedBy, reviewedAt}
```

- `approve` par un `reviewer` : met `reviewed: true` dans le brouillon (publication par un `editor`).
- `doubts` : fichier facultatif `content/<pack>/_review/doubts.json` `{ "<id>": ["…"] }` (listes produites par les agents de contenu).

### Audio et courbes F0

```
POST /studio/packs/{code}/audio            multipart {file: wav|webm, conceptId|path, voice, pitch?: json}
                                           -> {files:[{path, durationMs}], pitch: {path}|null}
GET  /studio/packs/{code}/audio/{path}     -> fichier (aperçu)
```

- Enregistrement dans le navigateur (48 kHz mono), conversion WAV côté client ; la courbe F0 de référence est calculée
  **côté client** avec `@parlo/core/pitch` (`extractContour` → `toPitchReference` → `serializePitchReference`) et envoyée.
- Le serveur applique le pipeline `docs/AUDIO.md` avec ffmpeg (loudnorm −16 LUFS, opus 48 kbps, m4a, version lente
  rubberband/atempo) et écrit `audio/<id>_<voice>.opus|m4a`, `_slow`, et `pitch/<id>.json` dans le brouillon média
  (`STUDIO_MEDIA_DIR`), copiés dans `CONTENT_DIR` à la publication. Le concept est mis à jour (`audio[]` source `native`).

## 2. Espace enseignant (spec §15 Phase 4) — `teacher`

```
POST   /classes                               body {name, packCode} -> 201 {id, name, joinCode, packCode}
GET    /classes                               -> [{id, name, joinCode, packCode, studentCount}]
GET    /classes/{id}                          -> {id, name, joinCode, students:[{id, displayName, joinedAt, lastActiveDate,
                                                  streak, xpWeek, lessonsCompleted, currentLessonId, weakConcepts:[{id, vi, errorRate}],
                                                  exams:[{level, passed, global}] }], assignments:[...]}
POST   /classes/{id}/assignments              body {title, lessonIds[]|unitId, dueDate} -> 201 {id}
DELETE /classes/{id}/assignments/{aid}        -> 204
POST   /classes/{id}/regenerate-code          -> {joinCode}
DELETE /classes/{id}/students/{userId}        -> 204
POST   /classes/join/{joinCode}               (élève) body {consent: true} -> {classId, name, teacherName}   400 sans consentement
GET    /me/classes                            (élève) -> [{id, name, teacherName, assignments:[{id,title,lessonIds,dueDate,completed:number,total:number}]}]
DELETE /me/classes/{id}                       (élève) quitter la classe -> 204
```

- Consentement explicite de l'élève au partage de sa progression avec l'enseignant (RGPD §14) ; révocable (quitter).
- Pas de messagerie élève↔élève ni enseignant↔élève (§14) ; `displayName` uniquement, jamais l'email.
- `joinCode` : 6 caractères Crockford base32. Une classe ≤ 60 élèves.
- Élèves mineurs : âge minimum inchangé (13/16) ; l'enseignant ne voit aucune donnée d'audio (il n'y en a pas).
