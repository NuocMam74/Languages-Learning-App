# Contrat — étudier en autonomie : catégories grammaticales et thèmes

L'app savait faire travailler, pas consulter. Pour réviser « tous les verbes » ou « tout le
vocabulaire du marché », il fallait faire défiler la liste complète du vocabulaire vu et trier à
l'œil. Aucun écran ne disait non plus ce que contient la langue — combien de pronoms, combien de
classificateurs, où on en est.

## 1. Chaque concept porte sa catégorie

Un champ `pos` sur le concept (`content/schema/concept.schema.json`, `PartOfSpeech` dans le cœur),
parmi douze valeurs :

    noun · verb · adjective · adverb · pronoun · classifier
    numeral · preposition · conjunction · particle · question · phrase

Les classes fermées du vietnamien y figurent telles quelles — **classificateurs**, **particules
finales**, **interrogatifs**. Elles n'ont pas d'équivalent français, et ce sont justement celles
qu'un francophone gagne à réviser en bloc. `phrase` couvre les tournures entières
(`type: "structure"`). Les tons et les sons n'en portent pas : ce ne sont pas des parties du
discours.

Le champ est posé par `scripts/classify-concepts.ts`, dans cet ordre de priorité :

1. `OVERRIDES` — par identifiant, pour les cas qu'aucune règle ne tranche ;
2. `BY_GLOSS` — par glose française exacte, table relue une entrée à la fois ;
3. `CLOSED` — les classes fermées, énumérées par la forme vietnamienne ;
4. heuristiques de glose — infinitif français, article en tête, liste explicite d'adjectifs.

Le script rend compte avant d'écrire (`--sample`, `--by <catégorie>`) et est idempotent. Les 713
concepts du pack sont classés. **Ce classement est fait par machine sur un corpus que personne n'a
relu : il est à vérifier avec le reste du contenu.** Il est conçu pour ça — les tables sont lisibles
et corrigeables, et une correction se rejoue d'une commande.

Deux pièges du détecteur, corrigés et documentés dans le script, valent d'être retenus si on le
reprend : les noms français en **-re** (« histoire », « anniversaire », « frère ») ne sont pas des
infinitifs, et la liste d'adjectifs se consulte **avant** la morphologie du verbe, sinon « amer »
(`đắng`) et « cher » (`mắc`) passent pour des verbes en -er.

## 2. Deux index, et ce qu'ils promettent

`/reviser/categories` et `/reviser/themes`. Chaque rayon annonce **deux nombres** : ce qui a été vu,
et la taille réelle du domaine.

Le second nombre porte sur **tout le pack**, pas sur les unités téléchargées. C'est ce qui fait
d'un index un index. Il l'est parce que les résumés de concepts du `core.json`
(`ConceptSummary.pos`) portent la catégorie : sans ça, l'écran affichait « 9 sur 29 » là où la
vérité est « 9 sur 195 », et le total grossissait mystérieusement au fil des téléchargements.

Ce que l'index ne fait pas : montrer les mots pas encore rencontrés. La règle de la bibliothèque
(ne rien divulgâcher, contrat phase8 §2) tient. Un rayon sans rien de vu affiche son volume, porte
un cadenas, et **n'est pas un lien** — il n'y aurait rien derrière.

Un rayon ouvert mène au vocabulaire déjà filtré. Le filtre vit dans l'URL
(`?categorie=verb`, `?unite=vi-south.u01`, `?etat=hard`) : il se partage, et le retour du navigateur
ramène au rayon plutôt qu'à l'accueil.

## 3. Ce qui est vérifié

`byPos` et `byTheme` (`apps/web/src/review/library.ts`) sont testés sur le vrai pack : tout concept
a une catégorie sauf tons et sons, aucun mot vu n'est perdu ni compté deux fois, la somme
`vus + à découvrir` égale le pack entier, et l'ordre d'affichage est celui du contrat — pas celui de
la découverte.

En navigateur (`e2e/phase14-index.spec.ts`) : les totaux, les rayons fermés non cliquables, le
passage vers le vocabulaire filtré, et le relâchement du filtre.
