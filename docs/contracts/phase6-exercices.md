# Contrat phase 6 — catalogue d'exercices complet (spec §4.4)

Moteur : `packages/core/src/engine.ts` ; schémas : `content/schema/lesson.schema.json`, `dialogue.schema.json`. L'interface ne
note jamais : elle envoie une `ExerciseResponse`, le moteur renvoie `Evaluation { correct, nearMiss, graded, expected, explain,
match? }`. Toute construction est déterministe pour une graine.

## 1. Règles transverses

- **Médias** : `NATIVE_AUDIO_STEP_TYPES` = étapes tonales + `listen_transcribe` + `listen_gist` → sans enregistrement natif dans
  `mediaIndex`, l'étape est **retirée de la séance** (`isStepPlayable` false), ni affichée ni notée ; le repli
  `VITE_TTS_TONE_FALLBACK` ne vaut **que** pour les tons. Un oral sans courbe F0 reste jouable : écoute non notée.
- **Score partiel** (`match_pairs`, `dialogue_choice`) : réussi si tout est juste, `nearMiss` dès `PARTIAL_NEAR_MISS_RATIO` (0,7).
- **Écrit** : `compareAnswer` en langue cible (diacritiques obligatoires, erreur de ton isolée), `compareLoose` en langue
  d'interface (accents, ponctuation, article initial facultatifs). `Evaluation.match` = `correct` / `tone_only` /
  `diacritics_only` / `wrong` → « presque : c'est *má*, pas *mà* ».

## 2. Types activés

| type | données | réponse | notation |
| --- | --- | --- | --- |
| `listen_transcribe` | `concept`, `accepted?` | `{kind:"text",text}` | `compareAnswer(text, [concept.vi, …accepted])`. **Audio natif requis.** |
| `match_pairs` | `concepts[3..6]`, `mode?` | `{kind:"pairs",pairs:[{leftId,rightId}]}` | tout juste = réussi, ≥ 70 % = presque. `mode` : `text_gloss` (défaut), `audio_text`, `audio_image`. |
| `fill_gap` | `text` (avec `___`), `answer`, `options[2..4]`, `translation?` | `{kind:"choice",optionId}` | bonne option ; confusion de ton = presque. |
| `translate_to_vi` | `source` (localisé), `accepted[]` | `{kind:"text",text}` | comme `listen_transcribe`, sans audio. |
| `translate_to_fr` | `source` (cible), `accepted:{fr:[…],en?:[…]}` | `{kind:"text",text}` | `compareLoose` sur toutes les langues listées ; pas de « presque ». |

UI : `listen_transcribe` / `translate_to_vi` ouvrent le clavier vietnamien (§5), `translate_to_fr` un champ ordinaire ;
`match_pairs` affiche `exercise.left` et `exercise.right` (déjà mélangés, ids distincts) — une carte « audio » n'a **ni `text`
ni `label`** → jouer `content.concepts.get(option.conceptId)` ; `fill_gap` remplace `___` par la case à remplir.

## 3. Types nouveaux

| type | données | exercice construit | réponse | notation |
| --- | --- | --- | --- | --- |
| `listen_gist` | `dialogue: dlg_…` | `dialogue`, `question`, `options` (localisées, ordre du fichier), `answerId` | `{kind:"choice",optionId}` | QCM noté. **Tous les tours doivent avoir leur audio présent.** |
| `dialogue_choice` | `situation?`, `turns[3..5]` `{id, vi, translation, audio?, replies[2..3]}`, réponse `{id, vi?/translation?, next?, best?, feedback?}` | `situation`, `startId`, `turns[]` (réponses mélangées), `bestReplyIds` | `{kind:"path",turnIds}` = ids des **réponses choisies**, dans l'ordre | noté sur les tours joués ; `bestReplyIds` vide = non noté. |
| `speak_answer` | `prompt` (cible), `translation`, `audio?`, `accepted: ConceptId[]` | `prompt`, `translation`, `audio`, `accepted: Concept[]`, `pitchRef` | `{kind:"speech",score}` | seuil `SPEAK_PASS_SCORE` ; `pitchRef` ou `score` à `null` → **non noté**. |
| `speak_roleplay` | `situation`, `prompts[2..4]` `{cue, concept}` | `situation`, `prompts[] {cue, concept, pitchRef}` | `{kind:"speech",score}` (moyenne des répliques notées) | noté si **au moins une** réplique a une courbe F0. |

UI : `listen_gist` joue les tours dans l'ordre (transcriptions masquées avant la réponse) ; `dialogue_choice` avance tour par
tour en suivant `reply.next` (absent = fin) et accumule les ids choisis ; `speak_roleplay` enchaîne les `cue` et fait dire `concept.vi`.

## 4. Dialogues — `content/<pack>/dialogues/*.json`

`{ id:"dlg_…", title, turns[2..8]:{speaker, vi, translation, audio?}, question?:{prompt, options[2..4], answer, explain?}, reviewed }`.
Exposés par `ContentIndex.dialogues` (Map) et `RawPackFiles.dialogues` ; dans le découpage ils vivent dans `core.json`
(`CoreFile.dialogues`, absent si aucun) et leur audio est compté dans l'unité qui les joue. `checkContent` vérifie : ≤ 8 tours,
locuteur et traduction française non vides, audio présent, réponse dans les options, NFC, `reviewed` (erreur en production).

## 5. Révisions SRS et clavier

- `reviewFormats` / `buildReviewExercise` produisent `fill_gap` (le concept retiré d'une de ses `examples`) et `match_pairs`
  (le concept + 2 voisins de même type, glosses distinctes) **uniquement avec `{ richFormats: true }`** : à activer dans
  `apps/web/src/session-store.ts` quand les composants existent.
- `packages/core/src/input/telex.ts` (spec §8.4) : `applyTelexKey(word, key, method)`, `telexToVietnamese(text, method)`,
  `telexInput(previous, typed, caret, method)`, `describeDiacritics(word?)` → `{id, label, kind, tone?, telex, vni, preview}[]`
  (13 touches, `preview` = mot obtenu ou `null`), `applyDiacritic(word, keyId)`. `method` : `"telex"` (défaut) ou `"vni"`.
  Sortie NFC, double frappe = annulation. Module de **référence** ; `apps/web/src/studio/telex.ts` en est une copie
  historique aux résultats identiques (table de compatibilité testée), remplaçable par l'import `@parlo/core`.

## 6. Reste à faire hors moteur

- `scripts/lib/load-pack.ts` + `scripts/validate-content.ts` : groupe `dialogues` et `validate("dialogue.schema.json", …)`
  (sans quoi la CI ne valide pas le nouveau dossier) ; `apps/web/src/studio/validation.ts#rawFromIndex` : reporter `index.dialogues`.
- `apps/api` : examens (`EXAM_SECTION_STEPS`, `isExamStepGraded`) et parité Python ignorent ces types — pas d'examen avant.
