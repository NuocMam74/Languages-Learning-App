# Contrat — une vraie boutique, un lieu à soi, une semaine à tenir, un calendrier

Le contrat phase9 a posé la boucle de récompense : une monnaie (les xu), des trophées, quatre
collections, des missions, un personnage à habiller. Elle marchait. Il lui manquait ce qui fait
qu'on y revient : **un endroit où dépenser**, **quelque chose à dépenser pour**, et **une raison
d'ouvrir l'application aujourd'hui plutôt que dimanche**.

Cinq changements, quatre écrans nouveaux, un amendement assumé à la spec.

## 1. La boutique : tout ce qui s'achète, au même endroit

Ce qui s'achetait existait déjà — et personne ne le voyait. Une pièce à prix vivait **au milieu de
l'atelier**, visible seulement en ouvrant l'emplacement qui la contenait. Conséquence : on ne savait
ni ce qu'on pouvait s'offrir, ni pourquoi accumuler des xu. Une monnaie sans vitrine n'est pas une
monnaie, c'est un compteur.

`/boutique`, quatre rayons, le solde en tête : **Personnage**, **Ma rive**, **Collection**,
**Ambiances**. Un prix sur chaque vignette, le dessin réel de la pièce — jamais une icône générique
— et une confirmation qui dit la seule chose qu'un prix ne dit pas : **ce qu'il restera après**.

### Les objets de collection s'achètent enfin

Jusqu'ici ils ne sortaient que des coffres. Terminer une collection était donc **subi** : on
attendait que le bon objet tombe. On peut maintenant acheter précisément celui qui manque, à
80 / 200 / 500 xu selon la rareté — nettement plus cher que ce qu'un coffre coûte en effort, pour
que le coffre garde sa valeur. Les coffres ne bougent pas : déterministes, sans doublon, gratuits.

Un objet acheté qui **termine** une collection paie exactement comme s'il venait d'un coffre. C'est
le genre de détail qui se perd : l'achat écrivait d'abord l'objet puis demandait « une collection
s'est-elle terminée ? », à quoi le calcul répondait non — elle paraissait déjà complète. Les deux
chemins passent désormais par le même calcul, et un test le tient.

### La vitrine de la semaine

Six entrées à −20 %, tirées par la **semaine ISO** : identiques sur deux appareils, identiques hors
ligne, et différentes chaque lundi. C'est la seule chose de la boutique qui change toute seule, et
c'est exactement son rôle — une vitrine figée n'a aucune raison d'être rouverte. La remise est
**fixe** : jamais un hasard qui récompenserait l'insistance.

## 2. « Ma rive » : un lieu, pas seulement un costume

L'atelier habille **une personne**. Il manquait un endroit à soi. C'est la différence entre porter
un chapeau et habiter quelque part, et c'est la seconde qui donne envie de revenir regarder.

Huit emplacements — ciel, eau, berge, maison, barque, végétation, lumières, animal — et 33 pièces.
Mêmes règles de déblocage que l'atelier (niveau, trophée, collection, monde, achat), même refus du
hasard et de l'argent réel. La rive s'affiche **dans le profil**, en petit : ce qu'on achète doit se
voir sans aller le chercher.

Une contrainte de dessin, qui évite de tester 33 × 8 combinaisons : **chaque emplacement a sa bande
de l'image**. Le ciel en haut, l'eau en bas, la maison à gauche, la barque à droite. Deux pièces
quelconques cohabitent par construction. La règle a été prise en défaut une fois — la rangée de
cocotiers de la berge posait un arbre exactement sur l'emplacement de l'animal — et elle a été
rétablie en gardant les deux cocotiers sur la berge gauche. Vu en regardant la scène, pas dans un
test.

## 3. Les ambiances — amendement assumé à la spec §13

La spec fixe six valeurs nommées et interdit les dégradés décoratifs. Elle ne prévoyait pas qu'on
puisse acheter l'habillage de l'application, et c'est pourtant ce qui a été demandé.

Ouvrir un sélecteur de couleurs aurait produit, en une semaine, des écrans illisibles et hors
charte. Une ambiance est donc un **jeu fermé de quatre décalages**, écrit dans le code, contraint
par trois règles :

1. **les six valeurs nommées ne bougent pas.** Ngọc reste ngọc, sơn mài reste sơn mài : un bouton
   principal, une erreur et une récompense gardent le même sens partout. Ce qui change, ce sont les
   **surfaces** — fond de page, cartes, teinte de l'eau derrière le contenu ;
2. **le contraste est calculé, pas espéré.** Un test tient le rapport du texte au-dessus de 4,5:1
   sur les trois surfaces de chaque ambiance, en clair **et** en sombre, et vérifie qu'une carte
   reste plus claire que son fond — sans quoi la profondeur de l'interface s'inverse ;
3. **aucun dégradé décoratif.** Une ambiance est une teinte, pas un papier peint.

Conséquence technique : les rides d'eau du fond étaient une image SVG à couleur figée. Elles sont
devenues un **masque** teinté par `--color-ripple`, donc par l'ambiance et par le thème.

## 4. La quête de la semaine : des jours, pas du volume

Les missions hebdomadaires demandent « 60 items » ou « 5 parties ». On les boucle en une seule
longue séance le dimanche soir. Elles ne donnent donc **aucune** raison d'ouvrir l'application un
mardi — ce qui était précisément la demande.

La quête demande une seule chose : **des jours**. Trois paliers — 3, 5 et 7 jours de présence dans
la semaine. C'est la seule mesure qui ne se rattrape pas, et c'est celle qui fait apprendre une
langue : la fréquence bat la durée.

Trois garde-fous, parce qu'une mécanique qui pousse à revenir devient vite une mécanique qui
culpabilise (spec §5.8) :

- **un palier manqué ne retire rien.** Ce qui est atteint reste réclamable toute la semaine ; ce
  qui ne l'est pas est simplement absent, sans message ;
- **le septième jour n'est pas le but.** Le plus gros saut est au **cinquième** (+90 xu et le
  coffre) ; le septième n'ajoute que 60. Récompenser le sans-faute hebdomadaire plus fort que la
  régularité reviendrait à punir un jour de repos ;
- **une journée compte dès qu'on a répondu**, pas dès qu'on a fait son objectif. Trois minutes dans
  le métro valent une heure au calme.

La quête est **au-dessus** des missions sur leur écran, et les xu qu'elle verse referment la boucle :
une semaine complète paie de quoi s'offrir quelque chose. Un test le vérifie littéralement.

## 5. Le calendrier : ce qui est prévu, ce qui a été fait

Deux moitiés d'une même question. Le **programme** répond à « qu'est-ce que je fais aujourd'hui ? »,
à laquelle « fais ta séance » répond mal quand on a trois jours devant soi. Le **journal** répond à
« qu'est-ce que j'ai fait mardi ? », qu'on se pose en doutant d'avancer.

Rien de nouveau n'est stocké : les compteurs par jour existent depuis le contrat phase9 §1 — 400
jours glissants, écrits à chaque séance — et les niveaux terminés portent déjà leur date. Le
calendrier est donc **complet dès sa première ouverture**, y compris pour quelqu'un qui apprend
depuis des mois. L'historique existait ; il n'était affiché nulle part.

Le programme se **déduit** (objectif quotidien, niveau suivant, mots dus, thèmes faibles du contrat
phase21 §4) plutôt que de se saisir : demander à l'apprenant de composer son planning serait lui
redemander ce qu'il a déjà dit. Trois partis pris :

- **il ne s'impose pas.** Aucun jour manqué en rouge, aucun « en retard », rien qui se verrouille.
  Un calendrier qui gronde est un calendrier qu'on ferme — et on ferme l'application avec ;
- **il ménage des jours légers.** Deux à 10 min/jour, un à 20. Programmer sept jours sur sept à
  quelqu'un qui vise dix minutes est le meilleur moyen qu'il en fasse trois et se croie en échec ;
- **il ne promet que ce qu'il sait.** Le niveau n'est **nommé que pour le premier jour travaillé**
  de la semaine : on sait lequel vient ensuite, on ignore lequel viendra jeudi. La première version
  affichait « Cinq tons à entendre » sept jours de suite — faux dès le mardi.

Dans la grille du mois, un jour à venir ne se peint pas comme un jour manqué : trois états, jamais
deux.

## 6. Ce que ça ne règle pas

- **Rien ne remonte au serveur.** Boutique, rive et ambiance vivent dans la clé `rewards`, locale
  comme tout le reste du contrat phase9 §1. Elles se transfèrent par fichier (contrat phase17), pas
  depuis un autre appareil. Prix assumé de la minimisation (spec §14).
- **Le journal des minutes démarre où il en est.** Les compteurs par jour remontent à 400 jours,
  mais `minutes` n'y est écrit que depuis les séances déjà jouées — un historique ancien affichera
  des exercices sans durée.
- **Quatre ambiances, pas quarante.** C'est le prix pour que l'application reste la même
  application. Une cinquième se relit et se teste ; elle ne s'improvise pas.
- **La rive ne bouge pas.** Aucune animation, aucun cycle jour/nuit : le ciel acheté est celui qui
  s'affiche. C'est un choix de poids (chaque pièce fait quelques centaines d'octets) autant que de
  calme (spec §13, une seule animation héroïque par écran).
