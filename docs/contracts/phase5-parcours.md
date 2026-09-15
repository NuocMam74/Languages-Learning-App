# Contrat « parcours complet » — corrections et compléments issus des audits

Sources : audits mobile, parcours réel et écarts de spec (septembre 2026). Règles partagées TS (packages/core,
apps/web) et Python (apps/api) : **toute règle ci-dessous doit être identique des deux côtés, avec tests de parité**.

## 1. Disponibilité des médias (audio natif absent aujourd'hui)

- Le bundle d'un pack expose `mediaIndex: string[]` : chemins relatifs des fichiers présents (`audio/…`, `pitch/…`, `img/…`),
  généré par `apps/web/vite-plugin-content.ts` (et par l'API à partir de CONTENT_DIR + studio media).
- `hasNativeAudio(concept, mediaIndex)` : au moins une piste `source: "native"` dont `src` est dans l'index.
  `hasPitchRef(concept|step, mediaIndex)` : `pitch`/`pitchRef` présent dans l'index.
- **Politique** (build `VITE_TTS_TONE_FALLBACK`, défaut `false`) :
  - étapes tonales (`tone_identify`, `tone_minimal_pair`, `tone_produce`) et items tonals de Chợ nổi/placement sans audio natif :
    **retirées de la séance** (non affichées, non notées) ; si le drapeau est `true` (bêta interne) elles utilisent la synthèse
    avec le marqueur « voix de synthèse ».
  - `speak_repeat` sans référence F0 : écoute non notée (inchangé) ; karaoké et entrée « Karaoké » masqués sans référence.
  - Placement : proposé seulement si ≥ 6 items jouables ; sinon passé automatiquement (entrée = début du parcours).
- **Examens** : un item `speaking` sans référence F0 **n'est pas noté** (retiré du dénominateur). Une compétence sans aucun item
  noté a un score `null` et est **exclue** de la règle « chaque compétence ≥ 0,5 ». L'examen blanc applique exactement la même règle.
  Items d'écoute tonals sans audio natif : non notés également. Si moins de 15 items restent notés, l'examen est
  « indisponible pour le moment » (`GET /exams` → `unavailableReason: "media_missing"`).
- Transcriptions du mode silencieux : **jamais** affichées pour les items d'écoute pendant un examen (blanc ou certifiant).

## 2. Progression, déblocage, parcours personnalisé

- **Test d'unité réussi** = `lesson_completed` d'une leçon `kind: "unit_test"` avec `score ≥ 0.7` (meilleur score).
  Seul un test réussi débloque les unités qui en dépendent et compte pour les examens. En dessous : écran « Presque ! Refais le test ».
- **Graphe d'unités** : `curriculum.units[].requires: UnitId[]` (facultatif ; défaut = unité précédente dans la liste).
  Une unité est disponible quand chaque unité requise a son test réussi (ou a été sautée au placement). Les prérequis de leçons
  **inter-unités** sont ignorés par le moteur (seuls les prérequis intra-unité comptent). Le tri par `boostTags` s'applique
  aux unités disponibles → le parcours famille/voyage change réellement l'ordre.
- **Placement** : niveaux 0..3 → entrée au début de u01 / u03 / u05 / u07 (première unité existante ≥ cible) ; les unités
  antérieures sont « sautées » (débloquées sans être terminées).
- **Garde de lien profond** : ouvrir une leçon non débloquée redirige vers le hub avec un message.

## 3. XP, niveaux, séries, badges

- **Séance vide** (aucun item noté ni leçon terminée) : aucun XP, pas de `session_completed`, pas de jour de série.
- **Plafonds serveur** : `itemsCount ≤ 200`, `durationMs` borné à 4 h (client et serveur), `xpGained ≤ min(1000, 15·itemsCount + 50)` ;
  au-delà : valeur écrêtée (pas de rejet). Colonnes de durée/XP en `BigInteger` côté API.
- **Niveaux de profil 1–50** : XP cumulée requise pour atteindre le niveau L = `25·(L−1)·(L+2)` (L=2 → 100 ; L=50 → 63 700).
  Noms : `pack.levelNames: Localized[10]` — un nom par tranche de 5 niveaux (1–5, 6–10, …), thème fleuve/marché du Sud.
  `GET /me` → `level: {value, name: {fr,en}, xpIntoLevel, xpForNext}` ; affiché sur le hub et le bilan (montée de niveau = moment orchestré).
- **Série à la lecture** : `current` affiché = 0 si `lastActiveDate` < hier (jour local) et que les jours manqués ne sont couverts ni
  par `frozenUntil` ni par les protections disponibles. `frozenUntil` ne couvre que les jours **≥ `frozenFrom`** (jour local de la
  déclaration) : pas de réparation rétroactive. Annuler un gel = `streak_frozen` avec `frozenUntil = null` (accepté).
- **Badges** (familles §5.4) — ajouts : `streak_100`, `streak_365`, `words_500`, `no_north_accent` (≥ 95 % sur les 30 derniers
  `spot_the_south`), `culture_explorer` (20 cartes culture réussies), `culture_unit` (test réussi d'une unité taguée `culture`).
  Évaluation identique client/serveur ; les badges de défi `challenge_*` sont serveur seulement **et affichés** dans la page Badges.

## 4. Synchronisation et comptes

- **Restauration** : `GET /me/state?pack=<code>` →
  `{profile, placement: {levelEstimate, entryLessonId}|null, lessonProgress: [{lessonId, bestScore, attempts, completedAt}],
    srsCards: [SrsCard], badges: [{code, earnedAt}], streak, xpTotal, level}`.
  Client à la connexion (et au démarrage si connecté et base locale vide) : fusion — progression = max, cartes = `mergeCards`,
  badges = union ; si le compte a un enrollment, l'onboarding et le placement ne sont **pas** reproposés.
- Le serveur accepte une carte SRS inconnue (nouvelle) sans la rejeter par la règle de fusion.
- **Profil** : réponses d'onboarding et réglages envoyés par `PATCH /me/profile` à l'inscription puis à chaque changement
  (motivation, entourage, niveau déclaré, objectif, rappel, leaguesEnabled, timezone, interfaceLocale, dictation non).
- **Flush** de l'outbox à la fin de chaque séance (en plus des déclencheurs existants).
- **Lot empoisonné** : réponse 5xx → le client scinde le lot en deux et réessaie ; un événement seul qui échoue 3 fois est mis en
  quarantaine dans `syncLog`. Le serveur applique chaque événement dans un SAVEPOINT et rejette l'événement fautif
  (`reason: "server_error"`) au lieu de faire échouer le lot.
- **Déconnexion** : efface les données d'apprentissage locales de ce compte (packs en cache conservés) ; si l'outbox n'est pas vide,
  avertissement et tentative de flush avant.
- **Mot de passe oublié** : `POST /auth/password/forgot {email}` → 204 toujours ; `POST /auth/password/reset {token, password}` → 204
  (jeton 1 h, usage unique, révoque les sessions). **Email** : `POST /auth/email/verify {token}` → 204 ; `POST /auth/email/resend` → 204.
  `EMAIL_BACKEND=console|smtp` (+ `SMTP_*`), liens vers `PUBLIC_WEB_URL/compte/reinitialiser?token=` et `/compte/verifier?token=`.
  `/me` → `emailVerified: bool`.
- **RGPD** : `GET /me/export` → JSON complet (profil, événements, progression, cartes, conversations, certificats) ;
  `DELETE /me` body `{password}` (ou `{confirm: "SUPPRIMER"}` pour les comptes OAuth) → 204, suppression effective + cookies effacés.
- **OAuth** : `GET /auth/oauth/providers` → `[{id:"google"|"apple", name}]` (seulement ceux configurés) ;
  `GET /auth/oauth/{id}/start?next=` → redirection ; callback → cookie refresh + redirection `PUBLIC_WEB_URL/compte?oauth=ok&next=`.
  Boutons affichés seulement pour les fournisseurs configurés.
- **Refresh** : fenêtre de grâce de 30 s — rejouer le jeton qui vient d'être tourné renvoie le même nouveau jeton (pas de révocation).
- **Sécurité** : démarrage refusé en production si `JWT_SECRET` est la valeur par défaut ou < 32 caractères (`ENV=production`) ;
  rate limit par IP client réelle derrière proxy de confiance (`TRUSTED_PROXIES`) ; `/push/subscribe` ne réattribue pas un endpoint
  d'un autre utilisateur ; un rappel par utilisateur ; `reminderHour`/`timezone` du profil pris en compte.
- **Certificats** : recherche par (utilisateur, pack, niveau). **Cache « pourquoi ? »** : clé incluant `expected`, TTL 30 jours.
- **Studio** : chaque publication incrémente la version du pack ; tous les caches serveur sont indexés par version (multi-workers).

## 5. Cô Mai et packs

- `GET /tutor/status?pack=` → `{available: bool, reason: "no_model"|"pack_unsupported"|null, personaName: string|null}`.
  Sans modèle configuré : l'app n'affiche pas la conversation ni Đối đáp (« bientôt »), garde l'accueil (gabarits) et
  « pourquoi ? » retombe sur l'explication du contenu **sans** message d'erreur. Persona définie par pack (`pack.tutor`), absente → indisponible.
- Pack `es` : `comingSoon: true` (non proposé aux apprenants ; visible en DEV et pour les rôles editor/admin).

## 6. Contenu mis à jour sans rebuild

- Au démarrage (en ligne), le client lit `GET /courses/{code}/manifest` (ou `/content/<code>/latest.json` statique) ; si la version
  diffère de la version locale, il télécharge le nouveau bundle (examens, placement et données de jeux **inclus dans le bundle**).
  La reprise d'une séance commencée sur l'ancienne version reste possible (le snapshot porte la version).
