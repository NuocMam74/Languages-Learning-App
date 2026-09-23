# Contrat — les bases avant le parcours

Retour d'usage, après avoir joué le parcours de bout en bout : dès le premier niveau, on croise des
mots jamais vus — dans les réponses proposées, dans les conseils, dans les cartes culture — et rien
n'a présenté l'alphabet, les sons, les pronoms ni les nombres avant d'y plonger. Ce lot remet les
bases **avant** le parcours, et fait respecter une règle simple : on ne montre pas un mot qu'on n'a
pas appris.

## 1. « Changer d'appareil » se range

Le geste est rare. Il quitte la section Données des réglages pour un menu dépliant, **Autres
options**, fermé par défaut (`data-testid="settings-more"`). Plus aucun autre écran n'y renvoie :
le lien du compte « sans serveur » est retiré, son texte indique le chemin. L'écran lui-même et son
adresse `/reglages/appareil` ne changent pas.

## 2. Les bases, avant le premier niveau

Une unité **u00 « Les bases : lettres, sons, pronoms, nombres »** ouvre le parcours (bloc b0,
renommé « Les bases et l'oreille »). u01 la requiert. Neuf niveaux :

| Niveau | Contenu | Fiche lue avant |
| --- | --- | --- |
| l01 | Les 29 lettres et les 12 voyelles | `g_alphabet` |
| l02 | Les consonnes qui surprennent (đ, d/gi, x, ch, tr, nh, ng, kh, ph, th) et leurs syllabes | — |
| l03 | La syllabe et les six tons (cinq au Sud), avec ma / mà / má / mả / mạ | `g_syllabe_tons` |
| l04 | Je et tu : tôi, tui, bạn, anh, chị, em, cô, chú, ông, bà | `g_pronoms_sujets` |
| l05 | Il, elle, nous, ils : ảnh, chỉ, ổng, bả, họ, chúng tôi, tụi mình, mình | — |
| l06 | Les nombres de 0 à 10 | `g_nombres` |
| l07 | De 11 à 100 : mười một, lăm, mươi, mốt, trăm | — |
| l08 | Révision | — |
| l09 | Épreuve | — |

Les lettres et les syllabes sont des concepts `sound` (`p_*`), les tons des concepts `tone` (`t_*`),
sans enregistrement : les exercices qui les emploient (appariement, choix à l'écoute d'une syllabe)
se jouent en synthèse vocale. Tout reste `reviewed: false`.

Le test de niveau place désormais le niveau 0 au début de u00 (`PLACEMENT_ENTRY_UNITS = [0, 3, 5,
7]`, côté client comme côté serveur) : qui ne sait rien commence par les bases, les autres les
sautent comme ils sautaient u01.

**Conséquence pour les comptes existants** : u01 requiert u00. Les leçons de u01 déjà commencées
restent ouvertes (règle inchangée), les suivantes attendent l'épreuve des bases.

## 3. Une fiche par niveau

`Lesson.guides` (facultatif) : les fiches conseils à lire avant **ce** niveau, en plus de celles de
l'unité. Attachées à l'unité, les quatre fiches des bases seraient toutes tombées sur le premier
niveau. Dans la fiche de préparation, celles du niveau passent **en tête** : ce sont la leçon
elle-même, on les lit avant les mots qu'elles présentent.

## 4. On ne montre pas un mot qu'on n'a pas appris

La garde des prérequis (contrat phase16) ne regardait que ce qu'on **produit**. Mesuré au début de
ce lot : **191 niveaux sur 194** montraient au moins un mot jamais présenté — 2 295 leurres tirés de
tout le pack par `derive-practice.ts`, et près de 400 mots cités par des conseils ou des cartes
culture.

`unmetExposure` (`packages/core/src/prerequisites.ts`) pose deux règles, vérifiées en `error` par la
validation du contenu :

- **les leurres sont des mots appris** : options d'un choix, jetons en trop, images voisines, reste
  d'une phrase à trous. Seule exception : les variantes tonales de la bonne réponse (ma / má / mà),
  dont la différence est l'exercice même ;
- **les mots cités par un conseil ou une carte culture** sont appris, variante tonale d'un mot
  appris, forme du Nord mise en regard du Sud (variantes lexicales, `northernEquivalent`), ou
  **présentés par la fiche de préparation** : nouveau volet « Les mots des conseils », qui montre le
  concept avec sa traduction avant la séance. Une expression citée entière (thời tiết) est traduite
  par l'expression. Ne comptent pas : ce qui est entre guillemets français (prononciation figurée :
  on écrit bạn, on entend « bạng »), et les noms propres.

Corrections du corpus :

- `scripts/fix-exposure.ts` remplace les leurres inconnus par des mots appris (même tirage que
  `derive-practice.ts`, partagé dans `scripts/lib/distractors.ts`) ; 1 425 étapes corrigées, 34
  retirées faute de leurres connus. `derive-practice.ts` ne pioche plus que dans les mots appris, et a
  complété les barèmes ;
- 35 concepts écrits pour les mots utiles que les conseils citaient sans traduction (hộp, gió, đói,
  thời tiết…), et 14 textes reformulés ou mis entre guillemets.

Les niveaux qui ouvrent un thème restent sous les 20 exercices notés (avertissement, comme avant) :
avec des leurres limités aux mots appris, u01.l01 n'en compte que 8.

## 5. Un pense-bête à la fin de chaque niveau

La fiche mémoire du bilan (contrat phase23 §4) n'offrait qu'un bouton de téléchargement : rien à
relire sur place. Elle affiche désormais **le pense-bête lui-même** (`memoEssentials`,
`packages/core/src/memo.ts`) : jusqu'à 8 mots du niveau avec leur sens (« et 12 autres dans la
fiche » au-delà), 3 règles à ne pas oublier — les pièges des fiches conseils lues avant le niveau
d'abord, puis ses explications —, et les pièges Nord/Sud. Le PDF et la fiche complète restent à un
geste.

À l'**épreuve** d'un thème, la fiche est celle **du thème entier** (`unitMemoSheet`) : la réunion
des fiches de ses niveaux, sans doublon, titrée du nom du thème (« La fiche du thème »). Elle n'est
pas tenue à une page ; son pense-bête au bilan l'est.

## 6. Le test de niveau à l'écrit

Sans voix natives, le test de niveau était sauté (contrat phase5 §1) et tout le monde commençait au
premier niveau. `placementPlan` choisit maintenant le mode : **à l'écoute** quand au moins 6 items
ont leur enregistrement, **à l'écrit** sinon. Mêmes items, mêmes seuils, même point d'entrée ; seule
la question change :

| Compétence | À l'écoute | À l'écrit |
| --- | --- | --- |
| tone | entendre le ton | nommer le ton que porte l'accent du mot écrit |
| comprehension | entendre le mot, choisir son sens | lire le mot, choisir son sens |
| vocab | entendre le mot, choisir sa forme | lire le sens, choisir le mot |

Un test d'écoute muet reste exclu (il se répondait au hasard). Un exercice à lire porte `read`
(`{ vi }` ou `{ gloss }`) : l'écran affiche le mot ou le sens à la place du bouton d'écoute.
L'écran d'accueil du test le dit (`data-testid="placement-mode"`, `data-mode`).

## Hors lot, constaté en chemin

Le jeu de parité serveur ↔ moteur (`apps/api/tests/fixtures/core_parity.json`) datait du 15
septembre. Régénéré, il révèle deux écarts **antérieurs** à ce lot :

- **la maîtrise** : le client juge une leçon réussie à sa maîtrise (contrat phase25), le serveur à
  sa complétion, à dessein. Les cas de parcours du générateur passent désormais des leçons
  maîtrisées, là où les deux jugent pareil ;
- **l'oral dans les examens** : le moteur écarte les items de production orale (20 septembre), le
  serveur les liste et les note encore. Sans enregistrement, ils ne sont pas notés, donc rien ne se
  voit aujourd'hui ; le jour où les voix arriveront, un examen compterait faux un oral jamais
  montré. La section `mediaGrades` du jeu garde donc son ancienne valeur, et **régénérer le jeu
  fera échouer ces tests** tant que `apps/api/app/services/exams.py` n'écarte pas les oraux comme
  `examItemRefs`. À traiter à part : les tests d'examen du serveur vérifient explicitement la
  notation de l'oral.
