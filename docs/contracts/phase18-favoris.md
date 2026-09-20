# Contrat — les favoris

Tout ce que l'application proposait était **son** choix à elle : la séance du jour, les mots dus,
l'ordre de travail, le prochain nœud de la carte. Rien ne permettait de dire *j'ai aimé celui-là, je
veux le refaire* — ce qu'on fait pourtant avec une chanson, une recette ou une vidéo.

Ce contrat ajoute la seule chose de l'application dont l'apprenant décide entièrement du contenu.

## 1. Un favori est un goût

`apps/web/src/favorites.ts`, table `favorites` (schéma version 6 : table nouvelle, rien à migrer).

Un favori **reste sur l'appareil**, ne part jamais au serveur, et n'influence ni la répétition
espacée ni le parcours. C'est la même règle que les notes personnelles (contrat phase8 §3), pour la
même raison : ce n'est pas une progression. Il voyage en revanche dans le transfert d'appareil
(contrat phase17 §1) — il fait partie de ce qui rend l'application la sienne — et il part avec les
notes à la déconnexion, parce que le compte suivant n'a pas à voir les coups de cœur du précédent.

Deux granularités, et pas une de plus :

| | Clé | Ce que ça veut dire |
|---|---|---|
| **Une leçon** | `vi-south.u03.l03` | « Je l'ai aimée en entier, je veux la rejouer. » |
| **Un exercice** | `vi-south.u03.l03#5` | Une étape précise. C'est la granularité à laquelle on aime vraiment : « la phrase à assembler du marché », pas « l'unité 8 ». |

La clé est stable, lisible, et survit au rechargement du contenu. Un exercice qui disparaît d'une
version à l'autre laisse son favori **listé et retirable** plutôt que de s'évaporer : on préfère une
ligne qui dit « cet exercice n'existe plus » à un favori qui manque sans explication.

## 2. Un seul geste, aux trois endroits où il se pose

Le même bouton, partout, sans confirmation ni félicitation : aimer et retirer sont la même touche,
et le regret coûte un toucher.

- **dans l'en-tête d'un exercice**, pendant la séance — le moment où l'on sait si on l'aime.
  Seulement sur une étape de leçon : un item de rappel espacé est tiré au sort, il n'a pas
  d'existence à retrouver ;
- **sur le bilan**, pour la leçon qu'on vient de finir — le seul écran où la question se pose sans
  interrompre ;
- **sur une ligne de « Réviser › Leçons »**, et seulement pour les leçons **faites** : on n'aime pas
  ce qu'on n'a pas encore vu.

Son libellé dit l'action, pas l'état — « Retirer des favoris » quand c'est déjà aimé — parce que
c'est ce qu'un lecteur d'écran doit annoncer *avant* qu'on appuie. `aria-pressed` porte l'état.

## 3. Les retrouver, et les rejouer

`/reviser/favoris`, avec son rayon sur l'accueil de « Réviser ».

Les leçons d'un côté, les exercices de l'autre, parce qu'on ne les rejoue pas de la même façon :

- une **leçon** aimée mène à son entraînement (`/lecon/:id/entrainement`, contrat phase8 §2) ;
- les **exercices** aimés sont groupés **par leçon**, dans l'ordre du cursus, et se rejouent
  ensemble : `/lecon/:id/entrainement?etapes=2,5,9` ouvre une séance d'entraînement **restreinte à
  ces étapes**. C'est toute la différence entre « je retrouve mon exercice » et « je refais la leçon
  entière en espérant tomber dessus ».

La sélection d'étapes passe par `SessionRequest.steps`, croisée avec ce qui est réellement jouable :
un favori posé sur un exercice devenu injouable (enregistrement manquant) ne le ressuscite pas. Une
séance restreinte ne reprend jamais une séance qui jouait d'autres étapes — `matches` compare la
file, pas seulement la leçon.

Un exercice s'affiche **par ce qu'il montre** — la phrase à assembler, le mot à reconnaître — et non
par son type. Le nom du format vient d'un tableau partagé avec la fiche de préparation
(`exercises/format-names.ts`) qui couvre **les dix-neuf** types, y compris ceux dont la consigne va
de soi. Sans lui, un écran finit par afficher `culture_card` à un apprenant : c'est arrivé, et ça se
voyait.

## 4. Ce qui est vérifié

`apps/web/src/favorites.test.ts` : aimer et retirer sont le même geste et rendent l'état d'après ;
une leçon et l'un de ses exercices sont deux favoris distincts ; les langues ne se mélangent pas ;
on retrouve d'abord ce qu'on vient d'aimer ; un exercice s'affiche par son contenu ; un exercice
disparu reste listé et retirable ; les exercices se rejouent dans l'ordre de la **leçon**, pas dans
celui des coups de cœur.

`apps/web/src/transfer.test.ts` couvre leur voyage d'un appareil à l'autre.
