# Contrat — conseils pratiques

Tout ce que l'app savait faire supposait une séance. Un apprenant qui se demande « comment je pose
une question ? » ou « qu'est-ce que je dis au chauffeur ? » n'avait nulle part où aller : les
explications existaient, mais éparpillées dans les étapes `explain` des leçons **terminées**, donc
invisibles tant qu'on n'avait pas fait la leçon — l'inverse de ce dont on a besoin quand la question
se pose.

## 1. Une fiche est du contenu, pas de l'interface

`content/<pack>/guides/*.json`, schéma `content/schema/guide.schema.json`, type `Guide` dans le
cœur. Une fiche porte :

- `kind` — `grammar` (comment construire), `situation` (quoi dire où), `usage` (ce qui se dit au
  Sud) ;
- `order` — sa place dans son rayon. Le contenu décide de sa progression : sans ce champ, les
  fiches sortiraient dans l'ordre alphabétique de leurs fichiers, et « Compter avec un
  classificateur » passerait avant « Construire une phrase » ;
- `sections[]` — titre, corps, et des `examples` `{vi, fr, note?}` ;
- `pitfalls[]` — les pièges, dits en une phrase.

Conséquence de ce choix : une fiche passe la **garde du Sud** (`south-lint`, dossier ajouté aux
fichiers inspectés), elle est **validée** (`checkGuides` : section vide, exemple sans traduction), et
elle attend sa **relecture par un locuteur natif** comme le reste du corpus — `reviewed: false`
aujourd'hui, et un build de production refuse `false`.

Le corpus livré couvre quatorze fiches : construire une phrase, poser une question, dire non,
situer dans le temps, les classificateurs ; saluer, le marché, commander, se déplacer, le médecin,
le téléphone ; à qui on parle, les particules du Sud, les prix.

## 2. Un rayon qui ne demande rien

`/reviser/conseils` et `/reviser/conseils/:guideId`.

Pas de progression, pas de verrou, pas d'exercice. C'est la seule partie de l'app qui ne demande
rien en échange, et c'est délibéré : **on y vient pressé**, au milieu d'une conversation ou devant
un menu. Trois conséquences concrètes :

- les fiches voyagent dans `core.json`, pas dans les unités — donc lisibles **hors ligne dès
  l'installation**, sans attendre le téléchargement d'une unité ;
- la route de la fiche ne passe pas par `WithUnits` ni par IndexedDB : elle s'ouvre sans lecture
  préalable ;
- l'accueil de « Réviser » n'est plus vide quand il y a des conseils, même sans une seule leçon
  faite.

La recherche porte sur le corps et les exemples, pas seulement sur les titres : on tape « taxi » ou
« combien », pas le titre exact d'une fiche.

Une fiche inconnue (lien périmé, pack changé) renvoie à la liste, jamais à un écran vide.

## 3. Deux réglages de lisibilité

Une fiche aligne des phrases entières, pas un mot au centre d'un écran d'exercice. Deux
conséquences, toutes deux visibles sur capture avant correction :

- `Vi` reçoit une taille `lg` pour la lecture suivie. Les tailles `vi` (40 px) et `vi-xl` restent
  celles de l'exercice ; à 40 px, « Hôm nay tôi đi làm. » tenait sur deux lignes ;
- le corps de section n'utilise pas `text-balance`, fait pour les titres : sur un paragraphe, il
  choisissait des coupures qui faisaient commencer une ligne par un deux-points.

## 4. Ce qui est vérifié

`e2e/phase15-conseils.spec.ts` : le rayon s'ouvre sans aucune leçon terminée, les fiches sont
groupées et ordonnées comme le contenu le demande, la recherche filtre puis se relâche, une fiche
montre ses sections, ses exemples traduits et ses pièges, le retour ramène à la liste, une fiche
inconnue redirige — et tout cela **hors ligne**, réseau coupé.
