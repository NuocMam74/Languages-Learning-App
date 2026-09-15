# Parlo — Spécification produit & technique

> Document destiné à Claude Code. Nom de code **Parlo** (à remplacer si besoin).
> Plateforme d'apprentissage des langues, mobile-first, accessible depuis une page web,
> installable sur Android et iOS. **Premier pack de contenu : vietnamien du Sud (Nam Bộ).**

---

## 0. Comment lire ce document

- Les sections 1 à 5 fixent le **produit** (ce qu'on construit et pourquoi).
- Les sections 6 à 9 fixent la **pédagogie et le contenu** (le cœur de la valeur).
- Les sections 10 à 14 fixent la **technique** (stack, modèle de données, API).
- La section 15 fixe le **plan d'exécution** par phases, avec critères d'acceptation.
- Tout ce qui est marqué **[DÉCIDÉ]** ne doit pas être rediscuté : implémenter tel quel.
- Tout ce qui est marqué **[À ARBITRER]** doit être proposé avec une recommandation avant codage.

---

## 1. Vision

Une application où quelqu'un ouvre son téléphone dans le métro, fait 7 minutes de vietnamien,
et a envie de revenir le lendemain. Pas un manuel numérisé : un parcours guidé, incarné par un
professeur, rythmé par des défis, qui produit des résultats visibles (« je comprends ma belle-mère »,
« j'ai commandé au restaurant »).

Trois promesses, dans cet ordre :

1. **Ça marche** — on parle vraiment après 3 mois, parce que le contenu est oral, fréquentiel et espacé dans le temps.
2. **Ça donne envie** — la séance quotidienne fait 5 à 10 minutes, elle commence par une victoire et finit par une récompense.
3. **C'est le vrai vietnamien du Sud** — pas la variante du Nord qu'on trouve dans 90 % des ressources existantes.

**Anti-objectifs** (à refuser explicitement) : un clone de Duolingo, un mur de grammaire, un abonnement
qui punit, des vies/cœurs qui bloquent l'apprentissage, des notifications culpabilisantes.

---

## 2. Utilisateurs cibles

| Persona | Motivation | Conséquence produit |
|---|---|---|
| **Gốc Việt** — descendant de Vietnamiens du Sud, comprend un peu, ne parle pas | Parler avec la famille, retrouver ses racines | Parcours « Famille » en priorité, vocabulaire domestique, pronoms familiaux, pas de honte sur le niveau réel |
| **Le conjoint / la belle-famille** | Être accepté, comprendre les repas de famille | Parcours « Belle-famille », formules de politesse, dạ / thưa, repas |
| **Le voyageur** | Se débrouiller 3 semaines au Vietnam | Parcours « Voyage », marchandage, transport, commande |
| **Le curieux / expat** | Travailler, vivre à Hô Chi Minh-Ville | Parcours complet A0 → A2, écrit inclus |

Interface disponible en **français** (langue par défaut) et **anglais**. L'architecture doit permettre
d'ajouter d'autres langues d'interface et d'autres langues cibles sans toucher au code (section 9).

---

## 3. Principes d'expérience [DÉCIDÉ]

1. **Une séance = 5 à 10 minutes.** Jamais plus par défaut. Si l'utilisateur veut continuer, il le demande.
2. **On commence par écouter et parler, on lit ensuite.** Le vietnamien est tonal : l'oreille avant l'œil.
3. **Zéro blocage.** Pas de système de vies. Une erreur relance l'exercice plus tard, elle n'interrompt pas.
4. **Une seule action principale par écran.** Gros boutons, zone de pouce, pas de menu caché en MVP.
5. **Feedback immédiat et explicatif.** Jamais « faux » seul : toujours pourquoi, en une phrase.
6. **Tout est reprenable.** Session interrompue = état sauvegardé localement, reprise exacte.
7. **Hors ligne par défaut** pour les leçons téléchargées (métro, avion, Vietnam sans data).
8. **La progression est visible sans compter les points** : une carte du parcours, des jalons nommés, des certificats.

---

## 4. Parcours utilisateur (ordre logique complet)

### 4.1 Première ouverture (avant tout compte)

1. **Écran d'accueil** — une phrase en vietnamien du Sud jouée en audio natif + sa traduction. On peut appuyer pour la réécouter. C'est la première chose qui se passe : on entend la langue.
2. **Choix de la langue à apprendre** — le vietnamien (Sud) est le seul actif ; les autres sont affichés « bientôt » avec possibilité de voter/s'inscrire (signal produit).
3. **Onboarding en 5 questions** (une par écran, réponses en gros boutons) :
   - Pourquoi ? → famille / voyage / travail / racines / curiosité
   - Qui parle vietnamien autour de toi ? → personne / mon/ma partenaire / mes parents-grands-parents / des collègues
   - Tu comprends déjà un peu ? → rien / quelques mots / je comprends mais je ne parle pas / je parle un peu
   - Combien de temps par jour ? → 5 / 10 / 15 / 20 min
   - Quand veux-tu qu'on te rappelle ? → matin / midi / soir / pas de rappel
4. **Mini-test de placement (90 secondes, optionnel)** — 8 items adaptatifs, audio uniquement : reconnaissance de tons, compréhension de 4 phrases courtes, 2 items de vocabulaire. Résultat : point d'entrée dans le parcours + profil de départ SRS.
5. **Première leçon immédiatement**, avant toute création de compte. L'utilisateur doit avoir réussi quelque chose avant qu'on lui demande son email.
6. **Création de compte proposée à la fin de la leçon 1** (« pour garder ta progression »). Email + mot de passe, ou Google/Apple. Possibilité de continuer en invité (progression locale, avertissement clair).

### 4.2 Écran d'accueil quotidien (le hub)

Éléments, du haut vers le bas :

- **Salutation contextualisée par le professeur** (« Chào buổi sáng ! Hier tu as buté sur le ton hỏi — on le reprend en douceur. »), générée côté serveur, mise en cache 12 h.
- **Le bouton unique : « Séance du jour »** avec durée estimée réelle (6 min).
- **La série (streak)** avec le nombre de jours et l'indication de la « protection » disponible.
- **Carte du parcours** : chemin vertical de leçons, unité courante dépliée, unités suivantes visibles mais grisées.
- **Défi de la semaine** (encart) + **ligue** si activée.
- **Accès révision** (« 12 mots à revoir ») séparé du parcours.

### 4.3 Anatomie d'une séance (le cœur) [DÉCIDÉ]

Toujours cette structure, adaptée à la durée choisie :

| Bloc | Durée | Rôle |
|---|---|---|
| 1. **Réveil** | 30 s | 3 items déjà maîtrisés, faciles → on commence par gagner |
| 2. **Rappel espacé** | 1–3 min | items dus selon FSRS, formats variés |
| 3. **Nouveau** | 2–4 min | 3 à 6 items nouveaux, toujours présentés en contexte audio d'abord |
| 4. **Mise en pratique** | 1–2 min | mini-jeu OU dialogue avec le professeur OU exercice de production orale |
| 5. **Bilan** | 20 s | ce que tu sais dire de plus qu'hier, XP, série, prochaine étape |

### 4.4 Types d'exercices [DÉCIDÉ]

Chaque type est un composant autonome, piloté par les données de la leçon.

**Compréhension orale**
- `listen_pick_image` — audio → 4 images
- `listen_pick_text` — audio → 4 transcriptions (piège = paires minimales tonales)
- `listen_transcribe` — audio → écrire ce qu'on entend (avec clavier vietnamien intégré, section 8.4)
- `listen_gist` — dialogue de 15 s → question de compréhension globale

**Production orale**
- `speak_repeat` — répéter, comparaison de la courbe tonale (section 8.3)
- `speak_answer` — répondre oralement à une question du professeur
- `speak_roleplay` — jeu de rôle guidé (commander un phở, saluer une tante)

**Tons (spécifique)**
- `tone_identify` — quel ton entends-tu ? (contours affichés en graphique)
- `tone_minimal_pair` — ma / mà / mả / mã / má / mạ : discriminer
- `tone_produce` — produire le mot avec le bon ton, validé par détection de hauteur

**Vocabulaire & structures**
- `match_pairs` — appariement audio/image/texte
- `build_sentence` — construire une phrase avec des jetons (ordre SVO, classificateurs)
- `fill_gap` — trou dans un dialogue
- `translate_to_vi` / `translate_to_fr` — usage modéré, jamais en entrée de leçon
- `spot_the_south` — variante Sud vs Nord : choisir la forme qu'on entendrait à Saïgon

**Culture & contexte**
- `culture_card` — carte courte (60 mots max) + audio + une question
- `dialogue_choice` — dialogue interactif à embranchements, 3 à 5 tours

### 4.5 Boucle de retour

- Bonne réponse : son court, +XP animé, on enchaîne sans écran intermédiaire.
- Mauvaise réponse : la bonne réponse s'affiche avec **une phrase d'explication écrite par le contenu** (pas générée à la volée), l'audio se rejoue, l'item est replanifié à la fin de la séance et revient le lendemain.
- Trois erreurs consécutives sur le même concept → le professeur intervient (encart) avec une micro-explication et propose un exercice plus simple.

---

## 5. Motivation, engagement, récompenses

### 5.1 Système de progression [DÉCIDÉ]

- **XP** : 10 par item nouveau maîtrisé, 5 par révision réussie, bonus de séance complète (+20), bonus de défi.
- **Niveaux de profil** (1 à 50) nommés en vietnamien avec un thème fluvial/marché du Sud, pas des numéros secs.
- **Série (streak)** : compte les jours avec au moins une séance terminée.
  - **Protection de série** : 1 crédit offert tous les 10 jours de série, max 2 en stock, consommé automatiquement. On ne punit jamais un oubli isolé.
  - **Série gelée** en cas d'absence déclarée (vacances) : bouton « je pars quelques jours ».
- **Objectif quotidien** choisi à l'onboarding, modifiable, avec une jauge visible.

### 5.2 Défis

- **Défi de la semaine** : un objectif thématique (« 50 mots de cuisine », « 5 jours de suite », « 10 minutes de parole »), barre de progression, badge à la clé.
- **Défi express** : 60 secondes, score, rejouable, partageable (image générée).
- **Défi entre amis** : lien d'invitation, comparaison sur 7 jours. [Phase 3]

### 5.3 Ligues [Phase 3]

Groupes de 30 utilisateurs, classement hebdomadaire par XP, 5 divisions, promotion/relégation.
**Garde-fou produit** : la ligue est *désactivable* dans les réglages, et désactivée par défaut pour
les profils qui déclarent apprendre « pour la famille » (motivation intrinsèque, la compétition les fait fuir).

### 5.4 Badges et jalons

Trois familles, avec icônes dessinées (pas d'emojis) :
- **Assiduité** — 7, 30, 100, 365 jours
- **Compétence** — « Oreille tonale » (95 % sur 50 items de tons), « Sans accent du Nord », « 500 mots »
- **Culture** — terminer une unité culturelle, écouter 20 dialogues

### 5.5 Diplômes / Chứng chỉ [DÉCIDÉ]

Le différenciant contre l'abandon : un objectif à échéance.

- Trois certificats : **A0 Bén rễ** (prendre racine), **A1 Mở lời** (ouvrir la parole), **A2 Trò chuyện** (converser).
- Chaque certificat s'obtient par un **examen final** : 25 items, 15 minutes, 4 compétences (écoute, lecture, vocabulaire, **production orale évaluée**), seuil 75 %, une seule tentative par 48 h.
- Le diplôme est un **PDF généré côté serveur** : nom, date, niveau, score par compétence, **code de vérification** unique et page publique `/verifier/{code}`.
- Partageable en image carrée pour les réseaux, avec un rendu soigné (c'est de la publicité gratuite).
- L'examen blanc est disponible à tout moment, gratuitement, et indique les lacunes.

### 5.6 Mini-jeux [DÉCIDÉ — 4 au MVP, les autres ensuite]

Tous jouables seuls depuis un onglet « Jeux », et utilisés comme bloc 4 des séances.

1. **Chợ nổi (marché flottant)** — *MVP*. Des barques descendent la rivière avec un mot écrit ; l'audio joue ; toucher la bonne barque avant qu'elle sorte de l'écran. Entraîne la reconnaissance tonale à vitesse croissante.
2. **Karaoké tonal** — *MVP*. L'utilisateur répète une phrase ; sa courbe de hauteur (F0) s'affiche en direct par-dessus la courbe du locuteur natif ; score de superposition. C'est la fonctionnalité signature (section 8.3).
3. **Xe ôm** — *MVP*. Un conducteur de moto-taxi donne des consignes orales ; on trace l'itinéraire sur une carte stylisée de Saïgon. Compréhension orale en situation.
4. **Bữa cơm (le repas)** — *MVP*. Construire la phrase avant que le plat refroidisse : jetons à assembler, chrono doux. Entraîne l'ordre des mots et les classificateurs.
5. **Đối đáp (la répartie)** — *Phase 3*. Conversation chronométrée avec le professeur IA, 6 tours, score de fluidité.
6. **Nhớ mặt (mémoire)** — *Phase 3*. Paires image/audio, grille 4×4.

Contraintes techniques communes : 60 fps sur un téléphone milieu de gamme, aucune dépendance de moteur de jeu,
Canvas 2D ou DOM + CSS transforms, audio préchargé, jouable en une main, respect de `prefers-reduced-motion`.

### 5.7 Professeur personnalisé [DÉCIDÉ]

**Persona : Cô Mai**, professeure originaire de Cần Thơ, installée à Hô Chi Minh-Ville. Chaleureuse,
directe, taquine, elle utilise *dạ*, *nghen*, *há* dans ses répliques vietnamiennes. Elle explique **en français**
(ou en anglais selon l'interface), donne les exemples **en vietnamien du Sud**.

Ce qu'elle fait :
- **Message d'accueil quotidien** contextualisé (progression, points faibles, série).
- **Micro-explications à la demande** : bouton « Cô Mai, pourquoi ? » sur chaque correction.
- **Conversation libre guidée** : chat texte + voix, limité au vocabulaire déjà vu (+15 % de mots nouveaux glosés), avec correction douce en fin de tour.
- **Débriefing hebdomadaire** : ce qui progresse, ce qui coince, l'objectif de la semaine.
- **Adaptation du parcours** : elle propose d'insérer une unité (« tu pars à Saïgon dans 3 semaines, on fait le module Voyage avant ? »).

Garde-fous **obligatoires** :
- L'appel au modèle se fait **côté serveur uniquement** (clé jamais exposée), via un endpoint authentifié et rate-limité.
- Le prompt système impose : vietnamien **du Sud** exclusivement, explications dans la langue d'interface, pas d'invention de règles grammaticales, s'appuyer sur le contenu de la leçon fourni en contexte, phrases courtes, jamais de mur de texte, jamais de sujets hors apprentissage.
- **Budget par utilisateur** : quota de messages/jour, dégradé proprement (« Cô Mai se repose, reviens demain — en attendant, voici la fiche de grammaire »).
- **Cache agressif** des messages non personnalisés.
- Toute réponse contenant du vietnamien doit passer par le **vérificateur de variante** (section 8.5) avant affichage ; si une forme du Nord est détectée, on régénère une fois puis on retombe sur un message préécrit.

### 5.8 Notifications

- Une par jour maximum, à l'heure choisie, dans la voix de Cô Mai, **jamais culpabilisante**.
- Exemples : « 6 minutes, et tu sais commander un café ce soir », « Ta série de 12 jours t'attend ».
- Interdits : « Tu nous manques », emojis tristes, compte à rebours anxiogène.
- Techniquement : Web Push (VAPID). Sur iOS, disponible uniquement si la PWA est installée à l'écran d'accueil → prévoir un écran d'explication d'installation.

---

## 6. Architecture pédagogique

### 6.1 Progression globale (vietnamien du Sud)

Découpage en **6 blocs, 24 unités, ~200 leçons** pour aller de zéro à A2.

| Bloc | Unités | Contenu | Certificat |
|---|---|---|---|
| **0. L'oreille** | 1–2 | Système tonal du Sud, alphabet et sons, 40 premiers mots, salutations | — |
| **1. Moi et toi** | 3–6 | Pronoms et rapports d'âge, famille, présentations, chiffres | **A0 Bén rễ** |
| **2. Le quotidien** | 7–11 | Manger et boire, marché et prix, temps et heures, lieux, se déplacer | — |
| **3. Échanger** | 12–16 | Questions, passé/futur, goûts et opinions, téléphone et messages, santé | **A1 Mở lời** |
| **4. Vivre là-bas** | 17–21 | Logement, travail, administratif, invitation et politesse, régionalismes | — |
| **5. Raconter** | 22–24 | Récit au passé, hypothèses, expression d'opinion nuancée | **A2 Trò chuyện** |

Chaque unité = 6 à 10 leçons + 1 leçon de révision + 1 « épreuve d'unité » (déblocage de la suivante).

### 6.2 Parcours personnalisés

Même colonne vertébrale, mais **ordre et exemples adaptés** au profil déclaré :

- **Famille / Gốc Việt** : unité Famille remontée en position 3, pronoms familiaux étendus (cô, chú, dì, cậu, bác…), vocabulaire des repas de famille, formules de respect envers les aînés.
- **Voyage** : unités Marché, Transport, Restaurant remontées, ajout d'un module « urgences ».
- **Travail** : registre formel, téléphone, email, chiffres et dates renforcés.

Implémentation : le parcours est un **graphe de leçons** avec prérequis ; le profil définit une **fonction de tri** des nœuds disponibles, pas un contenu différent. Un seul corpus, plusieurs chemins.

### 6.3 Répétition espacée [DÉCIDÉ]

- Algorithme : **FSRS** (bibliothèque `ts-fsrs`, exécution côté client, état persisté côté serveur).
- Granularité : la carte SRS porte sur un **concept** (mot, structure, paire tonale), pas sur un exercice ; un concept peut être testé par plusieurs formats.
- Note dérivée automatiquement : temps de réponse + justesse + format (une production orale réussie vaut plus qu'un QCM).
- Plafond de révisions par séance pour ne jamais dépasser la durée annoncée ; le reste déborde sur le lendemain.

---

## 7. Le vietnamien du Sud : ce qui doit être respecté

> Cette section est le **contrat de qualité linguistique**. Tout le contenu doit s'y conformer.
> Claude Code ne doit **pas inventer de contenu linguistique à grande échelle sans validation** :
> il produit la structure, les schémas, les outils et un corpus d'amorçage marqué `"reviewed": false`,
> destiné à être relu par un locuteur natif du Sud avant publication.

### 7.1 Tons

- L'orthographe vietnamienne note **6 tons** (ngang, huyền, sắc, hỏi, ngã, nặng).
- Le parler du Sud réalise couramment **5 contrastes** : **hỏi et ngã se confondent** (réalisés de façon similaire).
- Conséquences produit :
  - L'écrit conserve les 6 diacritiques (orthographe standard, indispensable pour écrire correctement).
  - Les exercices de **discrimination auditive** ne doivent **jamais** opposer hỏi à ngã.
  - La leçon sur les tons explique explicitement cette fusion, comme une bonne nouvelle (« 5 tons à entendre, 6 à écrire »).
  - Les courbes affichées sont celles du Sud, pas les contours du Nord.

### 7.2 Consonnes et finales

Points à traiter dans le bloc 0, avec audio comparatif Nord/Sud :
- **d, gi, v** : dans le Sud, *d* et *gi* se réalisent en [j] ; *v* est souvent [j] en parler familier, [v] en registre soigné.
- **s / x** et **tr / ch** : le Sud **distingue** ces paires (rétroflexes), contrairement au Nord qui les fusionne. C'est un marqueur fort.
- **r** : réalisé distinctement (roulé/rétroflexe selon les locuteurs), là où le Nord le rend [z].
- **Finales** : tendances du Sud sur `-n → -ng`, `-t → -c` selon la voyelle précédente ; à enseigner comme *reconnaissance* (comprendre), pas comme norme d'écriture.

### 7.3 Lexique — le tableau de référence

À inclure comme donnée (`data/vi-south/lexical-variants.json`), à afficher dans les exercices `spot_the_south`
et dans une fiche consultable.

| Français | Sud (Nam Bộ) | Nord (à reconnaître) |
|---|---|---|
| papa / maman | ba / má | bố / mẹ |
| oui (poli) | dạ | vâng |
| bol | chén | bát |
| verre | ly | cốc |
| cuillère | muỗng | thìa |
| assiette | dĩa | đĩa |
| porc | heo | lợn |
| maïs | bắp | ngô |
| arachide | đậu phộng | lạc |
| ananas | thơm / khóm | dứa |
| fruit (classificateur) | trái | quả |
| cher (prix) | mắc | đắt |
| chapeau | nón | mũ |
| couverture | mền | chăn |
| voiture | xe hơi | ô tô |
| avion | máy bay | máy bay |
| stylo | cây viết | bút |
| ainsi / comme ça | vậy | thế |
| gâteau | bánh | bánh |

Registre familier à enseigner en reconnaissance : *hông / hổng* pour *không*, particules finales *nghen, hen, há, nè, đó*.

### 7.4 Audio [DÉCIDÉ]

- **Priorité absolue à l'audio humain natif du Sud.** Prévoir le pipeline : fichiers sources `wav` 48 kHz → normalisation LUFS → export `opus` (48 kbps mono) + `m4a` de repli pour Safari ancien.
- **TTS en repli uniquement**, et **jamais** pour les exercices de tons ni pour le karaoké tonal. Le choix de la voix doit être vérifié à l'exécution : une voix `vi-VN` par défaut est souvent une voix du Nord. Stocker dans le contenu le champ `audio.source: "native" | "tts"` et afficher un marqueur discret si TTS.
- Deux vitesses par phrase : naturelle et ralentie (ralentissement par time-stretch sans altération de la hauteur — indispensable pour les tons, ne **jamais** ralentir par changement de `playbackRate` sans préservation du pitch).
- Voix : au minimum une femme et un homme, idéalement un accent de Saïgon et un du delta.

### 7.5 Écriture

- Le vietnamien s'écrit en alphabet latin : pas de système d'écriture à apprendre, **le dire dès l'accueil** (argument de motivation massif).
- Enseigner la saisie des diacritiques (clavier Telex/VNI) dans le bloc 1, avec un clavier intégré dans l'app (section 8.4).

---

## 8. Fonctionnalités techniques différenciantes

### 8.1 PWA installable [DÉCIDÉ]

- Manifeste complet, icônes maskable, `display: standalone`, thème et splash.
- **Écran d'aide à l'installation** détecté par plateforme : sur iOS, instructions Safari (Partager → Sur l'écran d'accueil) ; sur Android, `beforeinstallprompt`.
- Service worker (Workbox) : app shell en `precache`, contenu de leçon en `stale-while-revalidate`, audio en cache dédié avec quota et purge LRU.
- Téléchargement explicite d'une unité pour le hors ligne (« Disponible hors ligne », taille indiquée).

### 8.2 Hors ligne et synchronisation

- Stockage local : **IndexedDB** via Dexie — contenu, état SRS, file d'événements non synchronisés.
- Toute action pédagogique produit un **événement horodaté** (`answer_submitted`, `lesson_completed`…).
- Synchronisation à la reconnexion : envoi de la file, résolution de conflits **par horodatage client, l'état SRS le plus avancé gagne**.
- Le compte invité conserve tout en local et peut être migré vers un compte au moment de l'inscription.

### 8.3 Karaoké tonal / analyse de la prononciation [DÉCIDÉ — fonctionnalité signature]

Approche, à implémenter sans service externe :
1. Capture micro via `getUserMedia` + `AudioWorklet`.
2. Détection de fréquence fondamentale (F0) par **autocorrélation normalisée / YIN**, fenêtre ~40 ms, pas de 10 ms.
3. Nettoyage : suppression des segments non voisés, lissage médian, normalisation de la hauteur par locuteur (conversion en demi-tons relatifs à la médiane de l'utilisateur → un homme et une femme obtiennent la même courbe normalisée).
4. Comparaison à la courbe de référence (pré-calculée hors ligne et stockée dans le contenu) par **DTW** (déformation temporelle dynamique) sur la courbe normalisée.
5. Score 0–100 + affichage des deux courbes superposées + indication ciblée (« ton descendant pas assez bas sur *mà* »).

Contraintes : traitement **100 % local**, aucun envoi audio au serveur, permission micro demandée au moment utile avec explication, repli propre si le micro est refusé (l'exercice devient de l'écoute).

La reconnaissance vocale (Web Speech API) peut compléter pour les mots isolés, mais son support est inégal et sa qualité en vietnamien est faible : **ne pas en faire une dépendance**.

### 8.4 Clavier vietnamien intégré

Composant de saisie avec conversion **Telex** et **VNI** en direct (`aa → â`, `as → á`, `dd → đ`, `a1 → á`…),
barre de diacritiques tactile en secours, et normalisation Unicode NFC systématique côté client et serveur.
La comparaison des réponses doit être tolérante : normalisation NFC, casse ignorée, espaces multiples réduits,
ponctuation ignorée — mais **les diacritiques comptent**, avec un message spécifique en cas d'erreur de ton seul
(« presque : c'est *má*, pas *mà* »).

### 8.5 Vérificateur de variante (« garde du Sud »)

Utilitaire partagé (`packages/south-lint`) qui scanne tout texte vietnamien — contenu ou sortie du modèle —
et signale les formes du Nord présentes dans `lexical-variants.json`. Utilisé :
- dans la CI sur tout le corpus (erreur bloquante) ;
- à l'exécution sur les réponses du professeur IA (régénération puis repli).

---

## 9. Contenu piloté par les données (multi-langue dès le départ)

**Règle absolue : aucune chaîne de contenu pédagogique dans le code.** Une langue = un « pack » versionné.

```
content/
  vi-south/
    pack.json                 # métadonnées : code, nom, variante, voix, écriture, sens de lecture
    curriculum.json           # unités, leçons, prérequis (le graphe)
    concepts/                 # unité atomique de savoir (mot, structure, paire tonale)
      c_ba.json
    lessons/
      u01/l01.json
    dialogues/
    culture/
    lexical-variants.json     # spécifique aux langues à variantes régionales
    audio/                    # opus + m4a, nommés par id de concept
    pitch/                    # courbes F0 de référence pré-calculées (json compact)
  schema/
    pack.schema.json
    lesson.schema.json
    concept.schema.json
```

Le moteur ne connaît que les **types d'exercices** ; il ne connaît pas le vietnamien.
Ajouter l'espagnol = ajouter `content/es/` conforme aux schémas, plus éventuellement des types d'exercices
spécifiques déclarés dans `pack.json` (`features: ["tones"]` active le module tonal).

### 9.1 Exemple de leçon (référence normative)

```json
{
  "id": "vi-south.u03.l02",
  "unit": "vi-south.u03",
  "title": { "fr": "Ba, má et les autres", "en": "Ba, má and the others" },
  "goal": { "fr": "Présenter ta famille proche en 4 phrases." },
  "estimatedMinutes": 7,
  "prerequisites": ["vi-south.u03.l01"],
  "concepts": ["c_ba", "c_ma", "c_anh", "c_chi", "c_em", "s_day_la"],
  "steps": [
    { "type": "culture_card", "ref": "cc_family_south" },
    { "type": "listen_pick_image", "concept": "c_ba", "distractors": ["c_ma", "c_anh", "c_em"] },
    { "type": "tone_minimal_pair", "pair": ["ba", "bà"], "explain": { "fr": "Ton plat contre ton descendant : bố contre grand-mère." } },
    { "type": "build_sentence",
      "target": "Đây là ba tôi.",
      "tokens": ["Đây", "là", "ba", "tôi", "má", "của"],
      "explain": { "fr": "Đây là… = « voici… ». Pas de verbe être conjugué." } },
    { "type": "speak_repeat", "concept": "s_day_la", "pitchRef": "pitch/s_day_la.json" },
    { "type": "game", "game": "cho_noi", "conceptPool": "lesson" }
  ],
  "review": { "srsIntroduce": ["c_ba", "c_ma", "s_day_la"] },
  "reviewed": false
}
```

### 9.2 Exemple de concept

```json
{
  "id": "c_ba",
  "type": "word",
  "vi": "ba",
  "ipaSouth": "ɓaː˧",
  "tone": "ngang",
  "gloss": { "fr": "papa", "en": "dad" },
  "northernEquivalent": "bố",
  "register": "neutral",
  "audio": [
    { "voice": "mai_hcm_f", "src": "audio/c_ba_mai.opus", "source": "native", "speed": "natural" },
    { "voice": "mai_hcm_f", "src": "audio/c_ba_mai_slow.opus", "source": "native", "speed": "slow" }
  ],
  "image": "img/family/dad.webp",
  "examples": [
    { "vi": "Đây là ba tôi.", "fr": "Voici mon père.", "audio": "audio/ex_day_la_ba.opus" }
  ],
  "note": { "fr": "Au Sud on dit ba ; au Nord, bố. Les deux se comprennent partout." },
  "reviewed": false
}
```

---

## 10. Stack technique [DÉCIDÉ]

**Frontend**
- React 19 + TypeScript (strict) + Vite
- Tailwind CSS v4 + quelques primitives Radix pour l'accessibilité (dialog, tabs)
- Routage : React Router
- État : Zustand (état de session, léger) + TanStack Query (serveur) + Dexie (local)
- Animations : Motion (ex-Framer Motion), sobrement, avec `prefers-reduced-motion`
- Audio : Web Audio API, `AudioWorklet` pour l'analyse
- PWA : `vite-plugin-pwa` (Workbox)
- Tests : Vitest + Testing Library, Playwright pour les parcours critiques

**Backend**
- **FastAPI** (Python 3.12), Pydantic v2, SQLAlchemy 2 + Alembic
- **PostgreSQL** (Neon ou Supabase en base managée)
- Auth : JWT d'accès court + refresh en cookie `httpOnly`, `argon2` pour les mots de passe, OAuth Google/Apple
- Stockage média : S3-compatible (Cloudflare R2) + CDN
- Génération PDF des diplômes : WeasyPrint ou Playwright, côté serveur
- Professeur IA : endpoint proxy vers l'API Anthropic (modèle `claude-sonnet-4-6`), **streaming SSE**, clé en variable d'environnement, quotas par utilisateur
- Tâches planifiées : rappels push, calcul des ligues, agrégats (APScheduler ou cron du PaaS)
SSS
**Infra**
- Front sur Vercel/Cloudflare Pages ; API sur Railway/Fly.io ; contenu servi en statique depuis le CDN avec version (`/content/vi-south/v3/...`)
- CI GitHub Actions : lint, types, tests, **validation des schémas de contenu**, `south-lint`, build, Lighthouse (budget perf mobile ≥ 90)
- Observabilité : Sentry (front + back), journal d'événements produit dans Postgres

**Monorepo**
```
apps/web/          # PWA
apps/api/          # FastAPI
packages/core/     # types partagés, moteur d'exercices, FSRS, scoring
packages/south-lint/
content/
docs/
```

---

## 11. Modèle de données (Postgres, esquisse)

```sql
users(id, email, password_hash, display_name, locale, created_at, is_guest, apple_sub, google_sub)
profiles(user_id, motivation, daily_goal_min, reminder_hour, level_estimate, path_variant, leagues_enabled)
courses(id, lang_code, variant, version, published_at)         -- 'vi', 'south'
enrollments(user_id, course_id, started_at, current_lesson_id, xp_total, level)
lesson_progress(user_id, lesson_id, status, score, completed_at, attempts)
srs_cards(user_id, concept_id, stability, difficulty, due_at, reps, lapses, last_review, state)
answers(id, user_id, exercise_type, concept_id, correct, response_ms, created_at, session_id)  -- append-only
sessions(id, user_id, started_at, ended_at, xp_gained, items_count, source)
streaks(user_id, current, longest, last_active_date, freezes_available, frozen_until)
challenges(id, kind, period_start, period_end, spec_json)
challenge_progress(user_id, challenge_id, progress, completed_at)
badges(id, code, family, criteria_json)  /  user_badges(user_id, badge_id, earned_at)
exams(id, course_id, level, spec_json)
exam_attempts(id, user_id, exam_id, started_at, submitted_at, score_json, passed)
certificates(id, user_id, level, issued_at, verification_code, pdf_url)
tutor_messages(id, user_id, role, content, tokens, created_at)   -- purge glissante 90 j
push_subscriptions(user_id, endpoint, keys_json, created_at)
pronunciation_scores(user_id, concept_id, score, created_at)     -- score seul, jamais l'audio
```

Le contenu (`courses`, leçons, concepts) **n'est pas en base** : il est servi en JSON statique versionné.
La base ne stocke que des **identifiants** de contenu. Cela permet de déployer du contenu sans migration.

---

## 12. API (esquisse)

```
POST   /auth/register | /auth/login | /auth/refresh | /auth/oauth/{provider}
GET    /me                              -> profil, inscription, série, XP
PATCH  /me/profile                      -> objectifs, rappels, réglages
GET    /courses                         -> langues disponibles
GET    /courses/{code}/manifest         -> version de contenu + URLs CDN
GET    /me/session/next                 -> plan de séance (mix SRS + nouveau), calculé serveur
POST   /me/events                       -> lot d'événements hors ligne (idempotent, clé client)
GET    /me/srs/due?limit=               -> cartes dues
POST   /me/lessons/{id}/complete
GET    /challenges/current | POST /challenges/{id}/claim
GET    /leagues/me                      [phase 3]
POST   /exams/{id}/start | POST /exams/attempts/{id}/submit
GET    /certificates/{id}.pdf
GET    /verify/{code}                   -> page publique de vérification
POST   /tutor/message                   -> SSE, contexte pédagogique injecté serveur
GET    /tutor/greeting                  -> message d'accueil du jour (caché)
POST   /push/subscribe
```

Toutes les routes `/me/*` exigent le JWT. Rate limiting sur `/tutor/*` et `/auth/*`.
Idempotence obligatoire sur `/me/events` (clé d'événement générée côté client).

---

## 13. Direction artistique

**Ancrage** : le delta du Mékong et Saïgon — laque (sơn mài), eau, marchés, lumière chaude.
Ni « app corporate », ni carte postale touristique. Chaleureux, net, adulte, jamais infantilisant.

**Palette (6 valeurs nommées)**
| Rôle | Nom | Hex |
|---|---|---|
| Fond | Nước (eau claire) | `#F2F6F3` |
| Encre / texte | Mực | `#14201E` |
| Primaire | Ngọc (jade) | `#0E5E55` |
| Accent | Sơn mài (laque) | `#C2352A` |
| Signal / récompense | Nghệ (curcuma) | `#E5A21B` |
| Neutre profond (surfaces) | Phù sa (limon) | `#3A3A34` |

Interdits explicites : le crème `#F4F1EA` avec accent terracotta `#D97757`, les dégradés décoratifs,
les cartes arrondies identiques empilées, les libellés en majuscules espacées, les flèches `→` collées aux boutons.

**Typographie**
- Interface et corps : **Be Vietnam Pro** — conçue pour le vietnamien, gère les diacritiques empilés.
- Titres et mots vietnamiens mis en valeur : **Source Serif 4** (ou Lora), taille généreuse, le mot vietnamien est l'objet visuel, pas une étiquette.
- **Vérification obligatoire** de toute police avec la chaîne de test : `Nghiễm nhiên, tôi nghĩ rằng ườm ữỡ — Đây là ba tôi, ổng ở Cần Thơ.` Les tons doivent rester lisibles et non rognés à 14 px.
- Échelle typographique fixe, hauteurs de ligne plus généreuses que d'habitude : **les diacritiques vietnamiens prennent de la place verticale** (`line-height` ≥ 1.5 sur le corps, ≥ 1.25 sur les titres, jamais de `overflow: hidden` sur une ligne de texte vietnamien).

**Mise en page**
- Une colonne, largeur max 480 px sur mobile, centrée jusqu'à 720 px au-delà.
- Zone d'action en bas (pouce), contenu au-dessus, jamais d'action critique en haut d'écran.
- La carte du parcours est l'élément mémorable : un chemin fluvial vertical, dessiné en SVG, pas une liste de cartes.

**Mouvement** : un seul moment orchestré par écran (la validation de réponse, la remontée du score de séance).
Pas d'entrée en fondu sur chaque section, pas de transition sur chaque survol.

**Accessibilité** : contraste AA minimum, focus clavier visible, cibles tactiles ≥ 44 px, sous-titres sur tout audio,
`prefers-reduced-motion` respecté, application utilisable sans son (mode « silencieux » avec transcriptions).

---

## 14. Conformité et données

- **RGPD** : minimisation (pas d'audio envoyé, pas de localisation), consentement explicite pour l'analytics, export et suppression de compte accessibles depuis les réglages, base hébergée en UE.
- **Analytics** : outil sans cookies tiers (Plausible ou équivalent auto-hébergé) + événements produit internes en base.
- **Audio utilisateur** : traité uniquement en mémoire côté client, jamais téléversé, jamais persisté. Le dire dans l'interface au moment de la demande de permission.
- **Mineurs** : âge minimum 13 ans (16 dans certains pays UE) affiché à l'inscription ; pas de chat social entre utilisateurs en MVP.
- **Contenu** : n'utiliser que des médias dont les droits sont clairs (images produites ou sous licence explicite, audio enregistré pour le projet). Aucune reprise de corpus ou de manuel existant.

---

## 15. Plan d'exécution

### Phase 0 — Fondations (à livrer en premier)
- Monorepo, CI, schémas JSON du contenu, `packages/core` (types, moteur d'exercices, intégration FSRS).
- API FastAPI : auth, `/me`, `/me/events`, `/me/session/next`.
- PWA squelette installable, service worker, Dexie, mode invité.
- **Critère d'acceptation** : un utilisateur invité termine une leçon codée en dur, hors ligne, et sa progression est conservée après redémarrage.

### Phase 1 — MVP jouable (le vrai jalon)
- 6 types d'exercices : `listen_pick_image`, `listen_pick_text`, `tone_identify`, `tone_minimal_pair`, `build_sentence`, `speak_repeat`.
- Unités 1 à 4 du pack `vi-south` (≈ 30 leçons, ≈ 150 concepts), audio de travail, corpus marqué `reviewed: false`.
- Onboarding complet + test de placement + hub + séance complète + SRS opérationnel.
- Série, XP, objectif quotidien, 6 badges.
- Mini-jeu **Chợ nổi**.
- Professeur IA : message d'accueil + bouton « pourquoi ? ».
- **Critère d'acceptation** : 7 jours d'usage réel sans bug bloquant, séance ≤ durée annoncée ±20 %, Lighthouse mobile ≥ 90, installation réussie sur iOS et Android.

### Phase 2 — Motivation et voix
- Karaoké tonal complet (F0 + DTW + affichage des courbes).
- Mini-jeux **Xe ôm** et **Bữa cơm**.
- Défis hebdomadaires, notifications push, protection de série.
- Examens A0 et A1, génération des certificats PDF + page de vérification.
- Unités 5 à 11.
- **Critère d'acceptation** : un utilisateur passe l'examen A0 et télécharge un diplôme vérifiable ; le score de prononciation est stable entre deux enregistrements du même locuteur (écart < 10 points).

### Phase 3 — Social et échelle
- Conversation libre avec Cô Mai (texte + voix), débriefing hebdomadaire.
- Ligues, défis entre amis, partage d'images.
- Unités 12 à 24, certificat A2.
- Deuxième pack de langue en preuve d'extensibilité (proposer lequel).
- Abonnement [À ARBITRER] : modèle proposé = tout le parcours gratuit, payant pour le professeur illimité, les examens certifiants et le hors ligne étendu.

### Phase 4 — Ouverture
- Studio de contenu interne (édition des leçons, enregistrement audio, calcul des courbes F0).
- Espace enseignant / classe.

---

## 16. Ce que Claude Code doit produire, dans l'ordre

1. `docs/ADR/` — 5 décisions d'architecture courtes (stack, contenu en données, SRS, hors ligne, IA).
2. Le monorepo et la CI.
3. Les **schémas JSON** et le validateur, avec 3 leçons d'exemple conformes.
4. `packages/core` avec tests unitaires (moteur d'exercices, sélection de séance, FSRS).
5. L'API, puis la PWA, dans l'ordre du parcours utilisateur (section 4).
6. Un `CONTENT.md` expliquant à un locuteur natif **non technique** comment relire et corriger le contenu.
7. Un `README.md` avec démarrage local en une commande (`docker compose up` + seed).

**Règles de travail**
- Ne pas générer 200 leçons d'un coup. Produire l'outillage, puis 3 leçons parfaites qui servent de gabarit.
- Tout texte vietnamien produit par le modèle est marqué `"reviewed": false` et passe par `south-lint`.
- Chaque composant d'exercice est isolé, testable seul, et documenté par une page de démonstration.
- Pas de bibliothèque de composants lourde, pas de moteur de jeu, pas de dépendance non justifiée dans un ADR.
- Commits atomiques, TypeScript strict, aucune utilisation de `any`.

---

## 17. Questions ouvertes à trancher avec le porteur du projet

1. Qui enregistre les voix natives du Sud, et sous quel accord de cession de droits ?
2. Budget mensuel maximal pour l'API du professeur IA (détermine les quotas) ?
3. Modèle économique au lancement : gratuit total, ou freemium dès la phase 2 ?
4. Nom définitif et nom de domaine.
5. Deuxième langue visée, pour valider l'architecture multi-pack.
