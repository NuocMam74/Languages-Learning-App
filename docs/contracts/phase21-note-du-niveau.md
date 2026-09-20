# Contrat — un niveau, une note sur 20, un thème à reprendre

Le contrat phase20 a fait en sorte que chaque mot montré soit demandé. Restait une question qu'on
se pose en terminant un niveau : **j'ai eu combien, et par rapport à quoi ?**

Le parcours affichait un pourcentage de séance. Deux problèmes. Il mélangeait le rappel espacé et le
niveau du jour, donc il ne disait rien du niveau. Et surtout, le nombre d'exercices notés variait de
**6 à 14** d'un niveau à l'autre, une fois retirées les étapes sans enregistrement : « 6 sur 8 » et
« 11 sur 14 » ne se moyennent pas. Sans barème commun, aucune moyenne, aucun classement des thèmes
par faiblesse.

## 1. Le barème : 20 exercices notés par niveau

`GRADED_STEPS_PER_LESSON = 20` (`packages/core/src/practice.ts`). Une bonne réponse, un point. Le
décompte est celui du contrat phase20 — étapes retirées faute d'enregistrement exclues, mini-jeu
exclu (il se passe, il se note au ratio de manches et dépend d'un chronomètre : il n'a pas sa place
dans un barème).

`checkGradedCount` tient la règle, avec **deux gravités, et la différence compte** :

- *dépasser 20 est une erreur* — le générateur sait s'arrêter à 20, donc un niveau à 22 est une
  étape écrite en trop, et sa note pèserait plus lourd que les autres dans la moyenne ;
- *rester en dessous n'est qu'un avertissement* — aucun script ne peut le corriger (voir §2).

**171 niveaux sur 194** sont à 20. Les 23 autres sont listés par la validation.

## 2. Le corpus complété, sans inventer de langue

`scripts/derive-practice.ts` (le même script qu'au contrat phase20, élargi) monte chaque niveau à 20
en assemblant des exercices avec ce qui est **déjà dans le pack** : les formes des concepts et leurs
phrases d'exemple, elles-mêmes tirées du corpus au contrat phase12. Cinq formats, passe par passe —
chacun traverse tous les mots du niveau avant que le suivant ne commence, pour qu'un mot n'ait pas
trois exercices pendant qu'un autre n'en a qu'un :

`listen_pick_text` → `listen_pick_image` → `fill_gap` → `build_sentence` → `translate_to_fr`,
puis `match_pairs` en dernier recours (il prend six mots d'un coup et n'exige ni image ni phrase).

2370 étapes ajoutées sur les deux packs. Aucune phrase rédigée, aucune traduction inventée, aucun
`explain` écrit par une machine.

### Une phrase n'entre que si tous ses mots ont été présentés

`unmetDemands` (contrat phase16 §1) ne regarde, pour un `fill_gap`, que la **réponse** : le reste de
la phrase est lu, pas produit. Correct pour une leçon écrite à la main ; insuffisant pour un
générateur qui pioche dans le corpus. La leçon 1 s'est retrouvée à faire compléter
« Chung cư này gần chợ, ___ hơi ồn » pour placer « mà » — bonne réponse, phrase dont pas un mot
n'avait été montré. Vu en jouant la leçon dans le navigateur, pas dans un test.

Le générateur exige donc la phrase **entière**, trou rebouché, comme si elle était à traduire.

### La révision reste dans son thème

Un niveau n'a pas toujours de quoi faire 20 questions avec ses seuls mots. Il reprend alors des mots
**déjà présentés de la même unité**. Ces mots rejoignent `concepts` sans toucher à `srsIntroduce` :
ils ne sont pas introduits là, et le rappel espacé du jour les écarte puisque le niveau les travaille
déjà.

Pourquoi le même thème seulement, alors que piocher dans tout le cursus amont ne laissait que 2
niveaux sous la barre au lieu de 23 : **une unité se télécharge seule pour jouer hors ligne**
(spec §3.7), et un niveau qui interroge un mot d'une autre unité exige que celle-ci soit là aussi.
Piocher partout aurait rendu chaque unité dépendante de toutes les précédentes — « télécharge
l'unité 12 pour l'avion » aurait voulu dire télécharger le pack entier. Mesuré en le faisant : le
parcours e2e « un invité joue une unité téléchargée » est tombé au premier essai.

Les 23 niveaux qui restent sous 20 sont, à deux exceptions près, ceux qui **ouvrent** un thème :
rien à réviser par construction. Leur note reste sur 20, chaque question y vaut simplement plus de
points. Ce qui les rapprocherait du barème, ce sont des phrases d'exemple et des images pour leurs
mots : du contenu à écrire, pas une règle à changer.

## 3. L'objectif quotidien commence à 10 minutes

Un niveau dure maintenant 6 minutes (`estimatedMinutes` recalculé : 15 s par exercice noté, plus une
minute d'ouverture). Or `planSession` écarte purement et simplement une leçon qui ne tient pas dans
l'objectif du jour : à 5 minutes, le parcours n'avançait plus dès qu'une révision était due.

Les objectifs proposés passent donc de 5/10/15/20 à **10/15/20** (`DAILY_GOAL_CHOICES`), et un profil
écrit à 5 est remonté à 10 à la lecture (`normalizeDailyGoal`). C'est une modification de la spec
§4.1, assumée : mieux vaut un objectif honnête qu'un objectif tenu en ne faisant jamais de leçon.
Le planificateur, lui, n'a pas bougé — la durée annoncée reste un plafond.

## 4. La note, la moyenne, les thèmes

`packages/core/src/marks.ts`. Trois lectures du même chiffre :

- **un niveau** vaut `markOutOf20(bestScore)` — le **meilleur essai**, comme le reste de la
  progression. Refaire un niveau ne peut donc que faire monter la note : c'est la condition pour
  qu'on ose retravailler un thème faible ;
- **un thème** (une unité : « La famille », « Les chiffres ») vaut la moyenne de ses niveaux notés,
  et dit sur combien de niveaux elle porte ;
- **le parcours** vaut la moyenne des *niveaux*, pas des thèmes : un thème de huit niveaux pèse huit
  fois plus qu'un thème d'un seul, parce qu'on y a travaillé huit fois plus.

Seuils de lecture repris de ceux des compétences (`skills.ts`) pour que les deux écrans disent la
même chose du même résultat : 60 % et 85 %, soit **12/20** et **17/20**.

Où ça s'affiche :

- **au bilan** — « Note du niveau : 16/20 », distincte du pourcentage de séance au-dessus (celui-ci
  compte aussi le rappel espacé), avec le meilleur essai rappelé ;
- **au profil** — la moyenne générale, les thèmes à reprendre **nommés avec le niveau exact à
  refaire**, puis la note de chaque thème commencé. Le lien mène au niveau normal, pas à
  l'entraînement : seul le premier enregistre une nouvelle note (et il ne redonne aucune XP, les
  mots y sont déjà introduits — aucune ferme à points).

La note ne décide de rien : le déverrouillage reste la maîtrise (contrat phase10 §3). C'est un
diagnostic, pas une barrière. C'est aussi pourquoi elle n'entre pas en contradiction avec la spec
§5.1 (« la progression est visible sans compter les points ») : elle ne récompense pas, elle désigne
quoi refaire.

## 5. Ce que ça ne règle pas

- **Les enregistrements.** 1662 fichiers manquants. Tant qu'ils n'existent pas, les exercices de
  tons ne comptent pas dans le barème et `listen_pick_text` se rabat sur « voici le sens, trouve la
  forme » : un exercice de lecture, pas d'oreille. Le jour où les voix arriveront, le barème devra
  être recalculé — le script est idempotent, il suffira de le relancer.
- **Les leurres dérivés.** Corrects, parfois lointains (`tiền` contre `giả`, `giá`, `thẻ`). Un
  relecteur du Sud les resserrera mieux qu'une règle de tri ; `CONTENT.md` le lui demande.
- **Le hors ligne inter-unités.** 23 unités sur 24 citaient déjà, avant ce contrat, des mots
  d'autres unités : télécharger une seule unité ne suffit pas toujours. Ce contrat s'est interdit
  d'aggraver le problème, il ne l'a pas résolu.
