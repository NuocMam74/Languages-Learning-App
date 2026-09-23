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

## 7. Des KPI partout où l'on en a besoin

L'écran Statistiques (contrat phase23 §1) répondait à « est-ce que ça avance ? » — mais sur
vingt-huit jours, et seulement si l'on allait le chercher. Trois questions restaient sans écran :
**où j'en suis cette semaine**, sans quitter le parcours ; **est-ce que ça avance depuis le
printemps** ; et, devant un thème noté 11/20, **lequel de ses niveaux, et quels mots ?**

### Le journal des semaines

Les deux journaux existants (`<pack>:stats`, `<pack>:activityLog`) sont bornés à 60 jours. Garder
chaque jour pendant un an ferait grossir `kv` sans rien apprendre de plus : à l'échelle de
plusieurs mois, la semaine est la bonne maille. Un troisième agrégat, `<pack>:weeklyLog`
(`packages/core/src/stats.ts`) : lundi de la semaine (jour local) → `{ answers, correct, seconds }`.

- Écrit **aux mêmes endroits** que les deux autres, dans les mêmes transactions : les réponses à
  chaque réponse notée (`submitSessionAnswer`), les secondes à chaque fin de séance
  (`finishSession`) — les mêmes secondes, plafonnées pareil.
- Borné à **53 semaines écrites**, jamais à un écart de dates : même politique que
  `recordActivitySeconds`. Une horloge qui recule ne vide pas un an d'historique.
- **Complété à la lecture** par les 60 jours déjà mesurés (`seedWeeklyLog`) : sans cela, un
  apprenant de deux mois ouvrirait son historique sur une seule semaine. Les deux sources sont des
  minorants exacts, chacune sur son terrain ; on garde, semaine par semaine, **la plus fournie** —
  jamais leur somme, qui compterait deux fois la même réponse. Rien n'est réécrit en base.
- Les **niveaux terminés** ne viennent pas du journal : ils sont déduits de
  `lessonProgress.completedAt`, ramené au jour local. L'historique des niveaux est donc complet
  même pour des données bien antérieures à ce lot. Limite connue : `completedAt` est la date de la
  **dernière** fin d'un niveau — un niveau refait compte à la semaine où il a été refait. C'est
  écrit sous le graphique.
- Clé propre au pack (`PACK_SCOPED_KEYS`), elle voyage comme `activityLog` : dans le fichier de
  transfert (contrat phase25 §2 — ce n'est ni une file d'envoi ni un état du navigateur), reposée
  telle quelle à l'import, et présente dans l'export RGPD, qui vide toute la table `kv`.

### L'onglet Historique

Un quatrième onglet, `/statistiques/history`, avec sa question : **est-ce que ça avance, sur des
mois ?** Trois périodes, 3, 6 ou 12 mois (13, 26, 52 semaines), lues une fois : changer de période
ne relit pas IndexedDB. Quatre compteurs de la période (minutes, niveaux terminés, réponses,
réussite moyenne), les minutes et les niveaux par semaine en deux cadres empilés, la réussite
semaine après semaine, et la tendance en toutes lettres (dernières semaines mesurées contre les
premières, même zone morte et même seuil de 10 réponses que les 28 jours).

Les règles de la série journalière tiennent à la semaine, plus une :

- **une semaine creuse est un zéro** — dès lors qu'on mesurait ;
- **rien n'est inventé avant la première mesure.** La série commence à la première semaine dont on
  sait quelque chose. Douze mois demandés à qui a commencé il y a six semaines rendent six semaines,
  et l'écran le dit (« Ton historique commence la semaine du… ») ;
- **une semaine inconnue n'est pas une semaine vide.** Entre un niveau daté de juin et le début
  des mesures, la semaine a ses niveaux mais ni réponses ni minutes : sa colonne garde sa place,
  **sans barre ni ligne de base** (`placeholder` dans `DayBars`), et sa ligne de lecture dit « pas
  encore mesurée ». La moyenne de minutes par semaine ne compte que les semaines mesurées.

Les quatre onglets tiennent sur deux rangées sous 640 px : « Compétences » n'entre pas dans un
quart de 360 px, et un libellé tronqué ne se lit plus.

### La fiche d'un thème

`/statistiques/theme/:unitId`, ouverte en touchant la ligne d'un thème dans l'onglet Parcours.
Un seul objet fort, l'anneau de la note moyenne sur 20 (son niveau écrit à côté) ; dessous, trois
compteurs, la note de chaque niveau, les mots qui résistent.

| Chiffre | D'où il vient |
| --- | --- |
| Niveaux terminés `x/n` | `themeMarks`, comme la ligne du thème |
| Note de chaque niveau | `lessonProgress.bestScore` sur 20 ; un niveau pas encore fait garde sa colonne, sans barre — ce n'est pas un 0/20 |
| Mots acquis `x/n` | les concepts que les niveaux du thème font entrer en révision (`review.srsIntroduce`), dont la carte a quitté l'état « nouveau » |
| Révisions tenues | part des révisions des cartes du thème qui n'ont pas été un oubli (`1 − lapses / reps`) |
| Mots qui résistent | les 5 cartes du thème les plus souvent oubliées (`lapses`), avec le mot et son sens |

La réussite par thème **ne vient pas des réponses** : les journaux de réponses ne savent pas à quel
thème une réponse appartenait, et ne gardent que 60 jours. La carte de révision, elle, garde toute
l'histoire d'un mot, ses oublis compris. D'où « révisions tenues » plutôt que « réussite » : le
chiffre ne prétend pas être ce qu'il n'est pas. `themeDetail` (`packages/core/src/marks.ts`) est
pur ; l'écran y ajoute seulement le mot et sa traduction.

Thème pas encore commencé (aucun niveau noté, aucun mot en révision) : une invitation vers le
parcours, pas une grille de zéros. Thème inconnu de ce pack : une phrase, pas un écran cassé.

### Les chiffres sur le parcours

Une carte sur `/apprendre`, sous l'anneau de l'objectif du jour (`data-testid="hub-kpis"`) :
la série, les minutes depuis lundi, les niveaux terminés depuis lundi, la réussite des 7 derniers
jours, et les minutes de ces 7 jours en barres. Un lien mène aux statistiques.

- **Absente avant toute activité** : quatre zéros sur l'écran d'un débutant ne disent rien, sinon
  qu'il n'a encore rien fait.
- **Discrète** : ni ombre ni ton. L'anneau reste l'objet fort du haut de l'écran (contrat phase8 §1).
- **Lue avec le reste du parcours**, dans le même `Promise.all` : la carte n'arrive pas après coup
  et ne pousse pas le fleuve (CLS). Trois agrégats déjà tenus à jour, aucun calcul d'historique ;
  le module (`apps/web/src/stats/hub-kpis.ts`) est séparé de celui des statistiques pour que le
  premier écran n'embarque pas les notes, les examens et les compétences.

### Ce qui est vérifié

- `packages/core/src/stats.test.ts` : la semaine commence le lundi, le journal cumule et reste
  borné aux semaines écrites, le complément des 60 jours ne compte jamais deux fois, la série
  commence à la première semaine connue et distingue une semaine inconnue d'une semaine vide.
- `packages/core/src/marks.test.ts` : un niveau pas fait n'a pas zéro, les mots acquis sont ceux du
  thème, les mots qui résistent sont les plus oubliés, pas de taux sans révision.
- `apps/web/src/stats/data.test.ts` : un apprenant d'avant le journal retrouve ses mois ; la carte
  du parcours est absente avant toute activité et compte la semaine depuis lundi ; la fiche nomme
  les mots qui résistent.
- `apps/web/src/learner.test.ts` : une leçon jouée écrit ses réponses et ses secondes dans sa
  semaine, les mêmes que les journaux de 60 jours.
- `apps/web/src/transfer.test.ts` : le journal des semaines part dans le fichier, se repose à
  l'import et figure dans l'export RGPD.

## 8. La visite se fait sur l'application, en bulles

La visite du contrat phase23 §3 était une suite de six écrans illustrés, vus une fois après le test
de niveau : on y lisait ce qu'était l'onglet Réviser sans jamais le voir. Elle devient une **visite
guidée sur l'écran du parcours** (`apps/web/src/tour/`) : une bulle par étape, posée sur le vrai
élément qu'elle explique — l'élan du jour, le fleuve du parcours, les onglets Réviser et
Statistiques, le bouton « ? » —, le reste de l'écran assombri par un projecteur.

- Elle s'ouvre d'elle-même **une fois**, au premier passage sur le parcours (`discoveredAt` vide),
  puis à la demande : bouton « ? » de l'en-tête du parcours (`data-tour="help"`), ou « Revoir la
  visite » dans les Réglages. Les deux naviguent vers `/apprendre` avec `state.tour`.
- Passer, Précédent, Suivant à chaque bulle ; Échap ferme, les flèches avancent et reculent. Aucun
  clic ne traverse le voile. Le focus suit la bulle.
- Un élément absent (pas de séance à lancer, par exemple) : la bulle se pose au centre.
- Les identifiants de test restent ceux de l'ancienne visite (`discovery-step`, `discovery-next`,
  `discovery-skip`) ; l'adresse `/decouverte` renvoie sur le parcours, visite ouverte.
- L'onboarding et le test de niveau rejoignent directement `/apprendre`.
