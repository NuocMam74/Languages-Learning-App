# Contrat — savoir avant de faire

Constat à l'usage de l'app sur téléphone, en une phrase : **on demande d'assembler une phrase avec
des mots qu'on n'a jamais vus, et sans avoir jamais appris comment une phrase s'assemble.**

Le contrat phase10 avait ajouté la marche manquante au début d'une leçon — la fiche de découverte,
« présenter avant de faire pratiquer ». Elle présentait `review.srsIntroduce` : ce que la leçon
*introduit*. Mais les exercices ne puisent pas là. Ils puisent dans tout le corpus.

Mesuré sur `content/vi-south` avant ce contrat :

| | avant | après |
|---|---|---|
| Leçons qui font **produire** un mot que rien n'a présenté avant | **55 sur 194** | **0** |
| Occurrences, dont 68 en `build_sentence` | 79 | 0 |
| Première occurrence | `u01.l02` — la **deuxième leçon** du cursus | — |
| Fiches conseils rattachées à une unité | **0 sur 14** | 14, sur 13 unités |
| Rang de `build_sentence` dans l'ordre d'apparition des formats | 2ᵉ leçon sur 194 | inchangé, mais préparé |

La fiche « Construire une phrase » existait depuis le contrat phase15, avec `order: 1` dans son
rayon. Elle était rangée dans « Réviser › Conseils », et rien n'y menait avant la leçon 2, qui
demande déjà d'assembler.

## 1. Ce qu'une leçon exige

`packages/core/src/prerequisites.ts` nomme une distinction que le moteur confondait :

- ce que l'étape fait **reconnaître** — les leurres d'un `listen_pick_text`, les deux formes d'une
  paire minimale, les jetons en trop d'un `build_sentence`. S'y tromper est le but de l'exercice :
  on n'a rien à connaître d'avance ;
- ce que l'étape fait **produire** — la phrase cible, la réponse d'un trou, les concepts d'un
  appariement, la réplique d'un jeu de rôle. Là, ne pas connaître, c'est être bloqué.

Seul le second est un prérequis. `stepDemands` le donne étape par étape, `lessonDemands` pour la
leçon entière, `unmetDemands` confronte au lexique connu.

Deux règles de lexique, apprises du corpus :

- **un mot composé ouvre ses syllabes** : qui connaît « cảm ơn » peut assembler une phrase qui
  contient « cảm » et « ơn ». Une phrase entièrement faite de mots connus est donc couverte sans
  avoir jamais été vue — c'est exactement ce qu'un `build_sentence` doit demander ;
- **les tons comptent** : `ma` et `má` ne sont pas le même mot, jamais. Le lexique compare des
  formes accentuées.

Et une exception : **noms propres et nombres**. « Chào Lan », « Sài Gòn », « đường Lê Lợi », « 1 »
ne sont pas du vocabulaire à apprendre — la traduction de l'exercice les donne, et les ajouter au
vocabulaire polluerait la bibliothèque. Un mot capitalisé ailleurs qu'en tête de phrase est traité
comme tel ; en tête de phrase, non, sinon le premier mot de chaque phrase passerait à la trappe.

**Garde de contenu.** `checkContent` parcourt le cursus dans l'ordre et signale chaque leçon qui
fait produire un mot que rien n'a présenté, avec le concept du pack qui le porte déjà :

```
⚠  vi-south.u01.l02 — build_sentence fait produire « em », que rien n'a présenté avant
   — à présenter plus tôt : c_em
⚠  vi-south.u10.l06 — build_sentence fait produire « tiệm », que rien n'a présenté avant
   — aucun concept du pack ne porte ce mot : il reste à écrire
```

Cette garde a d'abord tourné en `warning` — le corpus en comptait 45 — le temps de solder la
dette (§7). Elle est passée en **`error`** : le compte est à zéro, et une phrase écrite demain avec
un mot que le cursus n'a pas encore donné bloque la CI.

## 2. La fiche de préparation est une porte

La fiche de découverte devient la **fiche de préparation** : elle couvre tout ce que la leçon
exige, en volets.

| Volet | Ce qu'il montre |
|---|---|
| Les mots de cette leçon | comme avant : forme, sens, audio, ton, exemple, équivalent du Nord |
| Ce que tu vas réutiliser | les mots plus anciens que les exercices vont faire produire |
| Les phrases à assembler | quand un mot de la cible échappe au corpus : la phrase entière, traduite |
| Les fiches conseils de l'unité | résumé, exemples, pièges — et un lien vers la fiche entière |
| Les consignes | un format d'exercice jamais rencontré s'explique avant d'être noté |

Un volet vide disparaît. Les quatre vides, il n'y a rien à préparer : la phase est sautée et la
séance démarre directement.

**Et c'est une porte.** Le bouton « Commencer les exercices » reste fermé tant qu'un volet n'a pas
été déplié ; une barre et un compte le disent en clair (« Encore 2 à ouvrir avant de commencer »).
Un volet ouvert ne se referme pas : on ne défait pas une consultation, et rien n'incite à recliquer.

Pourquoi des volets à ouvrir plutôt que la liste déroulée du contrat phase10 : une liste entièrement
ouverte se saute d'un coup de pouce. Ouvrir, c'est le geste minimal qui prouve qu'on est passé — et
pour un mot, c'est aussi le geste qui l'écoute.

Ce qui ne change pas : **ce n'est pas un exercice.** Rien n'est noté, rien n'entre dans le SRS,
aucun événement n'est émis, la barre de progression de la séance ne bouge pas. Jamais en
entraînement (contrat phase8 §2) : rejouer une leçon terminée, c'est s'exercer, pas découvrir.

**Jamais sur un test d'unité.** Un test vérifie ce qui a été appris ; lui poser une fiche en amont,
ce serait distribuer l'antisèche avec l'épreuve. Trois tests exigeaient pourtant un mot jamais
présenté (`u01.l09`, `u02.l08`, `u07.l08`) : cela ne se corrige pas par une fiche mais par le
contenu, en présentant le mot dans une leçon amont de la même unité — c'est ce qui a été fait (§7).

La fiche est **figée au démarrage** de la séance, comme `knownAtStart` : une reprise retrouve
exactement la même, même si on a révisé entre-temps (contrat phase5 : reprise exacte). Un snapshot
écrit avant ce contrat n'en a pas et retombe sur les seuls mots introduits — le comportement d'avant.

## 3. Le contenu dit ce qu'il faut avoir lu

`Unit.guides` dans `curriculum.json` : les fiches conseils à lire avant les leçons de l'unité. Le
contenu décide, comme il décide déjà de l'ordre des fiches (`Guide.order`, contrat phase15 §1).

Les quatorze fiches sont placées sur treize unités. Deux choix méritent d'être dits :

- `g_construire_phrase` est sur **u01**, parce que `build_sentence` arrive à la leçon 2. La fiche
  qui explique l'ordre des mots doit passer avant le premier exercice qui le demande, pas après ;
- une fiche n'est attachée qu'à l'unité où elle devient **nécessaire**. Trop tôt, elle parle de mots
  qu'on n'a pas. Et elle n'est proposée qu'une fois : lue, elle ne revient pas à chaque leçon de
  l'unité (`guidesRead`, trace locale dans `kv`, propre à la langue — pas une progression, rien
  n'est envoyé au serveur).

## 4. « Par où commencer », dans Réviser

Constat : huit rayons de même poids — vocabulaire, catégories, thèmes, grammaire, leçons, dialogues,
conseils, notes — et douze catégories grammaticales dans l'un d'eux. Tout y est. Rien ne dit par où
débuter. L'écran répondait à « où est telle chose ? », jamais à « que dois-je travailler ? ».

`packages/core/src/study-path.ts` range la bibliothèque en **échelle**, et l'accueil de « Réviser »
s'ouvre sur une carte qui nomme le barreau du jour.

| | Barreau | Pourquoi là |
|---|---|---|
| ⚡ | Ce qui revient aujourd'hui | la répétition espacée l'a replacé : le laisser passer, c'est refaire le chemin |
| ⚡ | Ce qui résiste | oublié au moins deux fois ; c'est ce qui coûte le plus cher plus tard |
| 1 | Nommer les choses | noms, verbes, adjectifs, adverbes : ce qui porte le sens |
| 2 | À qui tu parles | en vietnamien le pronom décide de tout : l'âge, le respect, la distance |
| 3 | Comment ça se construit | les fiches grammaire et usage : l'ordre des mots, la question, la négation |
| 4 | Les outils de la phrase | classificateurs, particules, interrogatifs, nombres — les classes fermées |
| 5 | Se débrouiller | phrases toutes faites et fiches de situation : le marché, le taxi, le médecin |

Les deux urgences passent devant, toujours. Ensuite l'ordre va du concret au propre-au-vietnamien.

Chaque barreau se déplie en étapes concrètes — une catégorie, une fiche — qui mènent aux écrans qui
existent déjà. **Aucun nouveau type de contenu, aucune nouvelle liste** : un chemin à travers ce
qu'il y a. Un barreau que rien n'a encore ouvert annonce sa taille (« 195 mots t'attendent ici »)
sans rien montrer : la bibliothèque ne divulgâche pas le cursus (contrat phase8 §2).

**Rien n'est verrouillé.** C'est un conseil, pas une porte — l'inverse de la fiche de préparation,
et c'est voulu : une leçon se joue dans un ordre, une révision se choisit. Un barreau plus haut se
clique ; il est seulement posé plus bas, et sans accent.

**Ce que l'échelle ne couvre pas, délibérément : les tons.** Ils ne se révisent pas dans une liste,
ils s'entendent et se répètent. Leur place est le parcours (unités « L'oreille ») et le karaoké
tonal. L'écran le dit au lieu de faire semblant. Le corpus confirme d'ailleurs ce choix : aucun
concept n'y est de type `tone` ou `sound` — les mots des leçons d'oreille sont des mots comme les
autres.

## 5. Un pack sans voix le dit une fois

Deux captures du test sur téléphone montrent le même manque sous deux formes : « Audio natif pas
encore enregistré » en rouge sous un mot, et un mini-jeu qui s'ouvre sur « Pas assez de mots avec un
audio natif pour jouer ici ».

Ce n'est pas une panne par mot. `content/vi-south` référence **1632 médias et n'en contient aucun** :
c'est un état du pack, et il se dit une fois.

- `packHasNativeAudio(content)` — le pack a-t-il au moins un enregistrement présent ?
- Quand non : une carte sur le parcours, ton de chantier annoncé (« Cette langue n'a pas encore de
  voix — les exercices d'écoute et les jeux d'oreille sont mis de côté, tout le reste fonctionne »),
  et les boutons audio passent du rouge `son-mai` à une ligne calme. Si des voix existent et qu'il
  en manque **une**, c'est bien une anomalie de ce mot-là : le rouge reprend sa place.
- `cho_noi` fait trier des barques à l'oreille par leur ton, en synthèse les tons sont faux
  (spec §7.4). Sans voix native il n'est plus proposé — ni sur `/jeux`, ni comme étape de leçon
  (`isStepPlayable` le retire comme une étape d'écoute sans enregistrement). Une porte qui mène à un
  mur n'est pas une porte. Même règle et même endroit que le karaoké tonal, masqué depuis le
  contrat phase5 §1 quand aucune courbe n'est présente.
- Le repli de bêta `VITE_TTS_TONE_FALLBACK=true` rend `cho_noi` jouable de nouveau, exactement comme
  les étapes tonales : c'est la même décision, prise au même endroit.

## 6. Ce qui est vérifié

- `packages/core/src/prerequisites.test.ts` — reconnaître n'est pas produire ; les tons comptent ;
  les noms propres ne sont pas du vocabulaire ; **plus aucune leçon ne fait produire un mot que rien
  n'a présenté** ; **aucune leçon du corpus ne laisse un mot non préparé**, quel que soit l'état de
  l'apprenant ; un test d'unité n'a jamais de fiche.
- `packages/core/src/study-path.test.ts` — l'échelle va du simple au dur, urgences en tête ; un mot
  n'appartient qu'à un barreau ; un seul barreau est désigné à la fois ; une fiche lue ne réclame
  plus rien.
- `npm run content:validate` — la garde des prérequis, en `error`, et les fiches d'unité qui
  existent.
- `apps/web/e2e/phase16-prerequis.spec.ts` — la porte tient (le bouton reste fermé tant qu'un volet
  n'est pas ouvert, et un volet ouvert ne se referme pas) ; la consigne d'un format neuf se lit
  avant d'être notée ; « Réviser » ouvre sur l'ordre de travail et son échelle de sept barreaux ;
  sans voix native, le manque est dit une fois et `cho_noi` n'est pas proposé.
- `apps/web/e2e/helpers.ts` — `skipBriefing` et `openAllBriefingPanels` : les parcours de bout en
  bout consultent la fiche avant de commencer, comme un apprenant. Sans cela ils butent sur un
  bouton fermé — ce qui est précisément le comportement voulu.

### Ce qui a été réparé au passage

Ces tests échouaient **avant** ce contrat, pour des raisons sans rapport entre elles :

- `design.spec.ts` ne se **chargeait pas** : un `test.use({ browserName, channel })` dans un groupe,
  que Playwright refuse désormais — et tant qu'un fichier ne se charge pas, **toute la suite refuse
  de démarrer**. Les deux gabarits de référence n'y fixent plus que l'écran : la CI n'installe de
  toute façon que Chromium, et ce que cet audit promet (débordement, CLS, contraste, mouvement
  réduit) tient à la largeur, pas au moteur. Trois verdicts ont alors refait surface — deux bugs
  **de l'audit lui-même** (une composition alpha qui forçait l'opacité à 1 ; une lecture des
  couleurs par expression régulière qui avalait le signe des composantes `oklab`, d'où des fonds
  gris inventés sous du texte posé sur blanc) et un vrai défaut : le bouton désactivé de la
  préparation, à 2,8:1, rendu lisible ;
- `phase5-journey` semait une progression sans `mastered` : depuis le contrat phase10 §3, la suite
  s'ouvre sur des prérequis **réussis**, et le test d'unité restait donc verrouillé ;
- `phase6-exercices` attendait le premier exercice là où la leçon s'ouvre sur sa préparation.

## 7. La dette de contenu, soldée

Les 45 avertissements de la garde ont été corrigés, leçon par leçon :

- **8 mots que le pack portait déjà** — `em`, `ly`, `chưa`, `vậy`, `hay`, `lúc`, `thì`, `nè` — et
  **7 concepts entiers** — `s_em_oi`, `s_ngon_qua`, `s_co_xa_khong`, `s_gan_day`,
  `s_b_neu_co_tien`, `c_b_du_lich`, `c_b_dong_y` : introduits dans une leçon **enseignante** amont.
  `em` manquait à lui seul à dix leçons, dès `u01.l02` — où il figurait déjà dans `concepts` sans
  être dans `srsIntroduce` ;
- **15 mots que le pack ne portait pas** — `chút`, `nha`, `cho`, `lớp`, `canh`, `tiệm`, `và`,
  `đội`, `vô`, `nhờ`, `nhiều`, `với`, `đem`, `sợ`, `lên` — écrits comme concepts, chacun avec
  pour exemple la phrase du corpus qui l'employait. Ce sont des particules, des prépositions et des
  verbes du quotidien : ils manquaient au corpus, pas seulement aux leçons. Deux portent leur
  équivalent du Nord (`tiệm` / cửa hàng, `vô` / vào) ;
- `vệ` n'était pas un mot manquant : `c_nha_ve_sinh` existait, mais n'était introduit nulle part
  avant la leçon qui le fait traduire.

Trois règles ont guidé chaque placement, et elles se lisent dans le script qui les a posées :
jamais dans un test ni dans une révision ; dans la même unité que le besoin ; au plus près de la
phrase qui emploie le mot. Quand le premier besoin était un test, le mot est entré dans la leçon de
l'unité où il a un sens — `hay` (« ou ») avec « Commander au quán », `lớp` là où se forme
« ba mươi tư », `với` là où l'on énumère ses symptômes.

Les nouveaux concepts sont `reviewed: false`, comme le reste du corpus : ils attendent la relecture
d'un locuteur du Sud (voir `CONTENT.md`).

## 8. Ce qui reste, et qu'aucun code ne réglera

Deux chantiers, tous deux humains :

1. **Les voix.** `content/vi-south` référence 1662 médias et n'en contient aucun. Tant qu'aucun
   enregistrement n'existe, les exercices d'écoute, la transcription, les dialogues et `cho_noi`
   restent hors jeu — retirés proprement, et le manque annoncé une fois (§5). C'est une séance
   d'enregistrement, pas une règle de programme : voir `docs/AUDIO.md`.
2. **La relecture.** Tout le corpus est `reviewed: false`, y compris les quinze concepts ajoutés
   ici. Un build de production la refuse, et c'est voulu : rien de ce qu'une machine a écrit ne doit
   être publié avant qu'un locuteur du Sud l'ait validé (`CONTENT.md`).
