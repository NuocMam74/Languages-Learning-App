# Contrat — mettre en pratique tout ce que la leçon montre

Constat en jouant la première leçon du parcours. Elle s'appelle « Cinq tons à entendre » et elle
tient sa promesse de montrer : une carte culture, trois paires minimales, une identification de ton,
une répétition. Puis **un seul** exercice où il faut trouver le bon mot — et il porte sur `má`. On
sortait de la leçon sans avoir jamais eu à reconnaître `ma`, `mà`, `mả` ni `mạ`.

Ce n'était pas un accident de la leçon 1. Mesuré sur le corpus : **296 concepts, dans 124 leçons sur
194**, étaient montrés sans être demandés une seule fois.

## 1. La garde : montrer n'est pas faire pratiquer

`packages/core/src/practice.ts` compte, pour chaque mot d'une leçon, les exercices **dont il est la
réponse**. Un distracteur ne compte pas (on ne le choisit pas), une carte culture ne compte pas
(elle n'interroge aucun mot), le texte d'un `fill_gap` ne compte que par sa réponse. Une paire
minimale compte pour tous ses `audioConcepts` : la cible y est tirée au sort à chaque passage.

Le décompte se fait **avec un index de médias vide**, et c'est le point qui change tout. Une étape
qui exige une voix native et ne l'a pas est retirée de la séance (contrat phase6 §1) ; les étapes de
production orale le sont toujours. Le pack n'a aujourd'hui **aucun enregistrement** : compter un
`tone_identify` ou un `speak_repeat` comme une mise en pratique, ce serait compter un exercice que
personne ne joue. La leçon 1, sur ses dix étapes écrites, n'en présentait que **deux** à l'écran.

Ce n'est pas un jugement sur les exercices tonals — ils restent le cœur de cette leçon, et le jour
où les 1630 enregistrements existeront ils reviendront. C'est le refus d'appeler « mise en
pratique » ce qui disparaît du parcours réel. Ce qui tient sans le moindre fichier audio tiendra a
fortiori avec.

`checkContent` en fait une **erreur** (`checkPractice`), au même titre que la garde des prérequis
(contrat phase16 §1) : la dette est soldée, elle ne doit pas revenir. Le message nomme les concepts
et dit quoi faire.

## 2. Le corpus complété sans inventer de langue

`scripts/derive-practice.ts` ajoute ce qui manquait. Il n'écrit que deux formats, construits avec
des concepts **déjà dans le pack** :

- `listen_pick_text` — le mot manquant est la réponse, les distracteurs sont les formes d'autres
  concepts : voisins tonals d'abord (`ma` / `mà` / `mạ`), puis même nature et même nombre de
  syllabes. Jamais deux formes que l'oreille du Sud confondrait — `hỏi` et `ngã` y sonnent pareil
  (spec §7.1), la règle des classes auditives du pack est appliquée comme dans `cho_noi` ;
- `match_pairs` — les mots restants, appariés à leur traduction (`text_gloss`, sans audio), quand il
  n'y a pas de distracteur honnête ou qu'il y en a trop à reprendre un par un.

Aucune phrase rédigée, aucune traduction inventée, aucun `explain` écrit par une machine : la
correction retombe sur la note du concept quand il en a une. Il n'y a donc **rien de nouveau à faire
relire** — c'est le même raisonnement qu'au contrat phase12 §1 pour les phrases d'exemple. Ce qui
mérite un œil de relecteur, ce sont les paires de distracteurs : un leurre trop lointain rend
l'exercice gratuit.

Deux garde-fous hérités des contrôles existants :

- un distracteur n'est jamais identique à la réponse ni indiscernable d'elle à l'oreille (`checkStep`) ;
- `match_pairs` **exige** ses concepts (contrat phase16 §1) : on n'y met que des mots déjà présentés
  à ce point du cursus. Les autres passent par `listen_pick_text`, qui n'exige rien.

Les étapes déjà écrites ne sont jamais touchées, l'ajout se fait avant le mini-jeu final quand il y
en a un (il ferme la leçon, spec §4.3 bloc 4), et relancer le script ne change rien.

`estimatedMinutes` n'est **pas** allongé, et ce n'est pas un oubli. Le temps annoncé sert à composer
la séance (`planSession`) : une leçon plus longue que l'objectif du jour en est purement écartée, et
l'apprenant à 5 minutes par jour ne la verrait plus jamais. Surtout, ces exercices ne s'ajoutent pas
à une leçon pleine — ils rebouchent le trou laissé par les étapes retirées faute d'enregistrement.

### Résultat

| | avant | après |
|---|---|---|
| Concepts montrés et jamais demandés | 296 (dans 124 leçons) | **0** |
| Étapes écrites | 1995 | **2274** (+279) |
| Étapes réellement jouées, sans enregistrement | 1465 | **1744** |
| Le moins d'exercices dans une leçon | **2** (u01.l01) | **6** |

Chiffres du pack `vi-south`. Le pack `es` (ADR 0006) avait le même manque à plus petite échelle :
5 concepts dans 3 leçons, repris de la même façon — la règle ne connaît pas de pack particulier.

> Le contrat **phase21** a repris le même script pour porter chaque niveau à 20 exercices notés :
> les chiffres « après » de ce tableau ont donc été dépassés depuis (4331 étapes écrites). La garde
> de ce contrat, elle, n'a pas changé — elle reste la première condition, et elle passe.

La leçon 1 fait désormais reconnaître ses cinq tons, un exercice par ton, avant le marché flottant.

Usage : `npx tsx scripts/derive-practice.ts [--pack vi-south] [--write] [--json]`.
Sans `--write`, il ne fait que rendre compte.

## 3. Ce que ça ne règle pas

La garde dit qu'un mot est demandé au moins une fois, pas qu'il l'est bien. Trois chantiers restent
ouverts, et aucun ne se résout par un script :

- **les enregistrements** — 1662 fichiers manquants. Tant qu'ils n'existent pas, la moitié des
  exercices tonals écrits ne se joue pas, et `listen_pick_text` se rabat sur « la traduction, trouve
  la forme » (contrat phase12 §2) : un exercice de lecture, pas d'oreille ;
- **les distracteurs dérivés** — corrects, parfois lointains (`tiền` contre `giả`, `giá`, `thẻ`) ;
  un relecteur du Sud les resserrera mieux qu'une règle de tri ;
- **la relecture** — 211 éléments du corpus restent `reviewed: false`.
