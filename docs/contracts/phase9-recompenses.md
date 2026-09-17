# Contrat — récompenses, missions, atelier du personnage et thème sombre

Objectif : donner **envie de revenir**. La progression existe déjà (XP, niveaux, série, badges,
défi de la semaine) ; ce qui manque, c'est la **boucle de récompense** — on gagne quelque chose,
on le voit, on le garde, on le porte. Et une raison de revenir *aujourd'hui* : des missions
à échéance courte.

Base non négociable : spec §3 (zéro blocage, une action par écran), §5 (XP/niveaux/série/badges
inchangés), §13 (palette des six valeurs nommées, pas d'emoji, pas de dégradé décoratif, une seule
animation héroïque par écran), §14 (minimisation : rien de nouveau ne part au serveur).

## 1. Ce qui est local, et pourquoi

Tout ce qui est décrit ici vit **sur l'appareil** (`kv` par pack, comme les totaux et les badges) et
n'est **jamais envoyé au serveur** : aucun type d'événement nouveau, donc aucun changement du contrat
`apps/api/app/schemas/events.py`, et aucune migration serveur. Précédent : les notes personnelles
(phase8 §3). Conséquence assumée : les récompenses se restaurent avec l'export local, pas depuis un
autre appareil. C'est le prix de la minimisation, et il est faible devant la valeur de la boucle.

Les compteurs d'activité (`counters`) sont **dérivés** de ce que la séance produit déjà : ils sont
écrits dans la même transaction que les totaux, jamais reconstruits depuis l'outbox (qui se vide).

## 2. Monnaie, trophées, objets

- **Xu** (la pièce) : gagnés par séance terminée, mission réclamée, niveau gagné, trophée, partie
  de jeu réussie. Dépensés dans l'atelier (§4). Jamais achetables avec de l'argent réel : pas de
  boutique payante, pas de hasard payant.
- **Trophées** : huit familles (séances, XP, jeux, sans-faute, missions, mots, série, tons), trois
  paliers chacune (cuivre, argent, or). Ils complètent les badges sans les remplacer : un badge est
  un **jalon nommé** (spec §5.4), un trophée est un **palier de volume**. Un trophée gagné ne se
  perd jamais.
- **Objets à collecter** : quatre collections thématiques du Sud (marché, fleuve, fête, cuisine),
  cinq objets chacune. Les objets sortent d'un **coffre**, et un coffre s'ouvre de façon
  **déterministe** : le premier objet non possédé d'un tirage semé par la récompense qui l'a donné.
  Pas de hasard, pas de doublon, pas de frustration. Une collection complète donne des xu et
  débloque une pièce d'atelier.

## 3. Missions (quotidiennes, hebdomadaires, mensuelles)

Trois quotidiennes, trois hebdomadaires, deux mensuelles. Générées **localement et de façon
déterministe** à partir de la période (jour / lundi / 1er du mois) : même appareil hors ligne, même
liste — rien à synchroniser, rien à attendre.

- Cibles **calibrées sur l'objectif quotidien** choisi à l'onboarding et sur le niveau : une mission
  n'est jamais hors de portée de la personne à qui elle s'adresse.
- Progression lue dans les compteurs de la période ; réclamation manuelle (le geste de recevoir
  compte). Une mission non réclamée avant la fin de la période est perdue **sans message de
  culpabilisation** (spec §5.8).
- Une mission donne des **xu** (et un coffre pour la semaine et le mois), **jamais de l'XP** :
  l'XP est calculée par le serveur depuis les événements et `applyServerState` la réécrit à chaque
  lecture de `/me`. De l'XP ajoutée localement disparaîtrait à la synchronisation suivante.
- Le défi de la semaine du serveur (§5.2) reste ce qu'il est : les missions sont **au-dessous** de
  lui dans la hiérarchie de l'écran, pas à sa place.

## 4. Atelier : le personnage

Un personnage dessiné en SVG (palette du pack, aucun texte, aucune image binaire), composé de
six couches : fond, compagnon, tenue, chapeau, accessoire, cadre. Chaque pièce se débloque par
**niveau**, **trophée**, **collection complète** ou **achat en xu** — jamais autrement.

- L'atelier montre la pièce portée, les pièces possédées, et ce qu'il faut pour les autres : une
  vitrine lisible, pas une grille de cadenas muets.
- Le personnage remplace le médaillon d'initiales **partout où il y a la place** (profil, accueil,
  bilan, missions) ; le médaillon reste le repli quand aucune pièce n'est portée.
- Contrainte de poids : chaque couche est un tracé, l'ensemble du jeu de pièces reste sous 12 ko.

## 5. Félicitations

Une **file de célébrations** : à la fin d'une séance, d'une partie, d'une réclamation de mission,
les gains sont montrés un par un, dans cet ordre — niveau, trophée, objet, collection, pièce
d'atelier, xu.

- Le texte s'adresse à la personne **par le nom de son profil** (`readDisplayName`), et « toi » sans
  nom quand il n'y en a pas. Jamais « utilisateur », jamais un nom inventé.
- Une célébration = une carte, un dessin, une phrase, un bouton. Fermable au clavier (Échap), focus
  posé dessus, `aria-live` ; `prefers-reduced-motion` supprime le mouvement, pas l'information.
- Son court **facultatif** (réglage « sons de retour ») : un accord montant pour une réussite, un son
  **neutre et grave** pour une erreur — jamais punitif (spec §5.6), jamais en mode silencieux.

## 6. Variété des exercices dans l'entraînement

- Nouveau format de révision riche : `build_sentence` (remettre les mots d'une phrase dans l'ordre),
  construit depuis les phrases d'exemple du concept, au même titre que `fill_gap` et `match_pairs`.
- Nouvel objectif d'entraînement libre (`/entrainement`) : une séance qui **mélange** les formats
  disponibles et se termine par un mini-jeu, avec barre de progression et sons. Elle nourrit le SRS
  et les compteurs, **sans** XP double ni progression de parcours (mêmes règles que le mode
  entraînement de phase8 §2 pour le parcours).

## 7. Deux mini-jeux de plus

Même contraintes que §5.6 de la spec (60 fps, pas de moteur de jeu, jouable en une main,
`prefers-reduced-motion`, audio préchargé) :

- **Lô tô** — le loto du Sud : une grille de mots, l'audio appelle, on touche la bonne case, on
  complète des lignes. Entraîne la reconnaissance à l'oreille sur un vocabulaire large.
- **Cà phê sữa đá** — la commande : un client commande, on assemble la commande dans le bon ordre.
  Entraîne les nombres, les classificateurs et le lexique de la rue.

`GameId` gagne deux valeurs : miroir à tenir dans `packages/core/src/types.ts`,
`apps/api/app/schemas/events.py` et `content/schema/lesson.schema.json`.

## 8. Thème sombre

- Trois choix : **système** (défaut), clair, sombre. Mémorisé par appareil (`prefs`), appliqué avant
  le premier rendu (pas de flash blanc), publié en `data-theme` sur `<html>` et en `color-scheme`.
- Le sombre ne redéfinit que des **rôles** en variables CSS (fond, encre, primaire, surfaces, ligne,
  ombre) : les familles de la palette §13 restent les mêmes — le fond reste de l'eau, le primaire du
  jade, l'accent de la laque, le signal du curcuma — seulement plus clairs ou plus sombres selon ce
  sur quoi ils se posent. Les aplats pleins (bouton primaire, bandeau de section) portent du texte
  sombre en thème sombre. Aucun écran ne code une couleur en dur.
- Contraste AA vérifié dans les deux thèmes ; la texture d'eau baisse d'opacité en sombre.

## 9. Définition de « prêt »

`npm run check` (typecheck, tests, contenu, i18n) passe. Chaque écran nouveau a ses états vides,
ses chaînes fr/en, son focus visible, ses cibles ≥ 44 px, et fonctionne hors ligne. Consigné dans
`docs/audits/ready-checklist.md`.
