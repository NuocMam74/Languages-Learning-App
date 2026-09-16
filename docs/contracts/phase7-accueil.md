# Contrat — accueil général, profil, navigation multi-langues

But : l'app n'est plus « une langue », c'est **un compte qui apprend des langues**. L'entrée est un
tableau de bord global ; chaque langue a le même parcours (moteur identique, contenu différent).

## 1. Architecture des écrans

| Route | Écran | Rôle |
|---|---|---|
| `/` | **Accueil (tableau de bord)** | Vue d'ensemble : profil, langues, reprise, motivation. Jamais spécifique à une langue. |
| `/apprendre` | **Parcours** (ex-hub) | Tout ce qui existe déjà pour la langue active : séance du jour, carte fluviale, révisions, examens, jeux. |
| `/profil` | **Profil** | Identité, niveau, compétences, acquis, badges, historique, par langue. |
| `/langue` | **Choix / ajout de langue** | Langues disponibles + « bientôt » avec « Me prévenir ». |
| inchangées | `/lecon/:id`, `/seance`, `/revision`, `/jeux`, `/examens`, `/certificats`, `/co-mai`, `/ligue`, `/defis`, `/reglages`, `/compte`, `/prof`, `/studio`… | |

- **Barre de navigation basse** (visible, jamais un menu caché — spec §3.4) sur les écrans « de séjour »
  (accueil, parcours, jeux, profil), masquée pendant une séance, un examen ou un jeu :
  `Accueil · Apprendre · Jeux · Profil`. Cibles ≥ 44 px, `aria-current="page"`, zone de pouce, safe-area.
- Après une séance/leçon, « Retour au parcours » revient sur `/apprendre` (pas sur l'accueil).
- Un lien profond vers une leçon d'une **autre** langue bascule la langue active (confirmation) puis ouvre la leçon.
- Sans aucune langue commencée : l'accueil montre l'appel à commencer (carte langue unique) plutôt qu'un tableau vide.

## 2. Accueil (tableau de bord)

Ordre mobile, de haut en bas :
1. **En-tête** : salutation + prénom (ou « invité »), pastille de niveau global (`niveau N · nom de tranche`),
   XP totale, série (jours) ; accès `/profil` (avatar initiales) et `/reglages`.
2. **Reprendre** (carte principale) : la langue utilisée en dernier — nom, prochaine leçon (titre + minutes),
   barre de progression de l'unité en cours, nombre de révisions dues, **bouton unique** « Séance du jour · N min »
   (ou « Commencer » si rien n'a été fait). C'est l'action principale de l'écran.
3. **Mes langues** : une carte par langue **installée** (pack présent dans le build) avec progression réelle :
   anneau ou barre `leçons terminées / total`, unités validées, XP, série, révisions dues, dernière activité.
   Toucher la carte = rendre la langue active (`pack_switched`) puis aller sur `/apprendre`.
   En bas : **« Ajouter une langue »** → `/langue`.
4. **Motivation** (cartes courtes, masquées si vides) : défi de la semaine avec sa barre, ligue (si activée),
   derniers badges obtenus (3 + « tout voir »), prochain certificat accessible, devoirs de classe.
5. **Cô Mai** : entrée conversation/bilan si disponible pour la langue active (masquée sinon).
6. **Hors ligne / installation** : état hors ligne, invite d'installation (règles mobiles existantes).

Règles : aucune donnée d'une langue ne fuit dans une autre ; tout est lisible hors ligne (les résumés viennent
d'IndexedDB) ; le serveur (`/me`, `/me/state`) complète quand on est connecté.

## 3. Profil

- **Identité** : initiales, nom affiché (modifiable), compte (invité / connecté / email vérifié), membre depuis.
- **Niveau global** : niveau, nom de tranche (`pack.levelNames` de la langue principale), XP dans le niveau / XP requise.
- **Série** : actuelle, record, protections, gel en cours.
- **Compétences** (par langue, sélecteur) : écoute, lecture, vocabulaire, production orale — pourcentage de
  réussite et volume, calculés par `packages/core/src/skills.ts` à partir d'un agrégat local durable
  (`stats` en IndexedDB, mis à jour à chaque réponse : par compétence, réussites/total, 60 derniers jours)
  complété par les résultats d'examens. Chaque type d'exercice appartient à **une** compétence :
  écoute = listen_*, tone_* ; lecture = fill_gap, translate_to_fr, spot_the_south, build_sentence (lecture de la consigne) ;
  vocabulaire = match_pairs, listen_pick_image, translate_to_vi, culture_card ; oral = speak_*, tone_produce, dialogue_choice.
- **Acquis** : mots appris (cartes SRS en révision), structures, leçons terminées, unités validées, dialogues joués,
  certificats obtenus (liens PDF), minutes de parole, jours actifs, meilleur score par mini-jeu.
- **Badges** : toutes les familles (assiduité, compétence, culture), obtenus **et** à obtenir (condition affichée), date d'obtention.
- **Par langue** : mini-carte de progression + lien « continuer ».

## 4. Données et cœur

- `packages/core/src/skills.ts` : `SKILL_OF_STEP`, `skillSummary(stats, exams)` → `{skill, correct, total, ratio, level}`.
- `packages/core/src/progress.ts` : `overallLevel(xpTotalAllPacks)` réutilise la formule existante (niveaux 1–50).
- Web `src/dashboard/summary.ts` : `packSummary(code)` → `{code, name, lessonsDone, lessonsTotal, unitsPassed, unitsTotal,
  xp, streak, dueCount, lastActiveAt, nextLesson: {id, title, minutes} | null}` — lit `core.json` (léger) + IndexedDB,
  sans charger les unités ; mis en cache mémoire.
- Nouvel agrégat local `stats` (kv par pack) alimenté dans `learner.submitSessionAnswer` : `{bySkill: {…}, byDay: {…}}`,
  borné à 60 jours ; aucune donnée personnelle supplémentaire, aucun envoi serveur (le serveur a déjà les événements).

## 5. Cohérence visuelle (spec §13)

Palette et typo inchangées ; le tableau de bord reste **une colonne**, cartes sobres, jamais deux cartes identiques
empilées sans hiérarchie : un seul bouton plein (l'action principale), le reste en liens/cartes discrètes.
Le nom de la langue et les mots appris gardent la police serif ; les chiffres clés en gras, pas d'emoji.
Mouvement : une seule animation orchestrée (barre de progression de la carte « Reprendre »).
