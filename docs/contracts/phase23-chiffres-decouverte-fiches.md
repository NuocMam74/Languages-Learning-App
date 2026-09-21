# Contrat — les chiffres, la visite, le test d'abord, et la fiche à emporter

Le contrat phase21 a donné une note à chaque niveau. Restaient quatre choses qu'un apprenant fait
ou cherche, et que l'application ne savait pas faire : **voir si ça avance**, **comprendre où il
est arrivé**, **être situé avant d'être mis au travail**, et **emporter ce qu'il vient d'apprendre**.

Cinq changements, quatre écrans nouveaux, et un widget qui s'en va.

## 1. Les chiffres : un cinquième onglet

Le profil est une étagère à trophées. Il répond à « qu'est-ce que j'ai ». Il ne répond pas à
« est-ce que ça avance », qui est la question qui décide si l'on revient demain — et à laquelle
aucun écran ne répondait.

`/statistiques`, trois onglets portés par l'URL, chacun avec une question :

| Onglet | La question | Ce qu'on y voit |
|---|---|---|
| Activité | est-ce que je m'y tiens ? | réponses/jour, minutes/jour, réussite dans le temps, bande de régularité |
| Compétences | à quoi passe mon temps ? | part de l'effort et réussite par compétence |
| Parcours | où j'en suis ? | moyenne générale, niveaux, thèmes réussis, note de chaque thème |

### Le journal des minutes, qui n'existait pas

`activity` (clé `kv`) ne retenait que **le jour courant** : il répondait à « ai-je fait mes 10
minutes ? », pas à « est-ce que je m'y tiens ? ». Un journal propre au pack (`<pack>:activityLog`)
est écrit à chaque fin de séance, borné aux 60 derniers jours **écrits** — la même politique que
`pruneSkillStats`, et pour la même raison : une horloge d'appareil qui recule ne doit pas vider un
historique, et une longue absence ne doit pas l'effacer non plus.

Le reste ne coûte rien : `SkillStats.byDay` tient déjà 60 jours de réponses par compétence, mis à
jour à chaque réponse notée. On assemble, on ne recalcule rien.

### Trois règles de graphique, tenues par construction

- **Un jour creux est un zéro, pas un trou.** Un graphique qui saute les jours sans séance dessine
  une régularité qui n'existe pas — c'est précisément le mensonge qu'on vient vérifier.
- **Une courbe de taux se coupe, elle ne tombe pas à zéro.** Un jour sans exercice n'a pas de taux
  de réussite ; relier le trait à zéro dessine un effondrement qui n'a pas eu lieu.
- **Jamais deux axes verticaux.** Des réponses et des minutes ne se comparent pas ; superposées
  elles racontent n'importe quelle corrélation. Deux cadres empilés partagent l'axe des jours.

### Ce que la mesure a imposé sur les couleurs

Le validateur de palette est formel, et c'est un résultat, pas une opinion : laque (`#C2352A`) et
curcuma écrit (`#8A5A00`) ont un **ΔE de 4,2 en vision deutan** — indistinguables — et 13,2 en
vision normale, sous le plancher de 15. Ce sont exactement les deux tons que le profil emploie pour
« fragile » et « en cours ».

Conséquence appliquée partout sur ces écrans : **aucune marque colorée ne porte seule un sens.**
Chaque barre d'état est doublée de son verdict écrit (« fragile », « solide », « sûr »), chaque
flèche de tendance de sa phrase. Et l'identité des quatre compétences vient de leur **libellé**,
pas d'une teinte : quatre hues pour quatre lignes nommées n'auraient rien ajouté et auraient exclu
des lecteurs.

### Le cinquième onglet, assumé

La spec §3.4 interdit le menu caché, pas la cinquième porte. Les cibles restent à 44 px de haut, et
le libellé tient en un mot dans les deux langues (« Chiffres » / « Numbers » — « Statistiques »
déborde sous 360 px).

## 2. « Changer d'appareil » rentre dans les réglages

Le transfert par fichier apparaissait à quatre endroits, et à trois d'entre eux comme **lot de
consolation** : quand aucune API n'est déployée, « crée un compte » mène à un formulaire mort, et
on affichait « Changer d'appareil » à la place — au bilan de la première leçon, sur le profil, et
sur l'écran de compte lui-même.

C'était une mauvaise réponse à une bonne question. Emporter sa progression dans un fichier est un
geste d'administration ; personne ne se le demande en terminant sa première leçon. Ces trois cartes
**disparaissent** quand il n'y a pas de serveur, au lieu de proposer autre chose :

- bilan de séance — plus d'offre du tout (`offerAccount` exige désormais `accountsPossible`) ;
- profil — la carte invité ne s'affiche que si un compte est réellement créable ;
- écran de compte — le bandeau « pas de serveur » reste (il explique un formulaire inerte) mais ne
  renvoie plus ailleurs.

Le transfert garde sa place unique et entière : **Réglages → Données**, avant l'export RGPD, comme
le voulait déjà le contrat phase17 §2.

## 3. On situe d'abord, on visite ensuite, on travaille après

Ce que l'onboarding faisait : cinq questions, puis un test de niveau **présenté comme facultatif**
avec un bouton « Passer » de la même taille que « Faire le test », puis — dans les deux cas — la
**leçon 1, jouée dans la foulée**.

Deux dégâts, et ils se cumulaient. Quelqu'un qui parlait déjà un peu passait sa première séance sur
« Cinq tons à entendre ». Et quiconque arrivait au bout n'avait toujours rien vu de l'application :
ni le fleuve du parcours, ni la bibliothèque de révision, ni ses chiffres, ni ses fiches. Tout cela
se découvrait par accident, ou jamais.

Le nouvel ordre :

```
5 questions  →  test de niveau  →  visite guidée (6 écrans)  →  le parcours
```

**Le test est le chemin.** Ce qui reste offert à côté n'est plus un refus mais une réponse : « je
pars de zéro » dit ce que le test aurait dit, sans les 90 secondes. Le test disparaît seulement
quand le pack n'en fournit pas de jouable (contrat phase5 §1).

**La visite ne demande rien.** Six écrans, une idée par écran, aucun bouton à choisir : l'apprenant
vient d'enchaîner un questionnaire et un test, on ne lui en sert pas un troisième. Un seul chiffre
y est personnel — l'objectif quotidien qu'il vient de fixer, parce que la visite doit parler de
**sa** séance. « Passer » est offert à chaque écran : une visite dont on ne peut pas sortir est une
prison. Elle se revoit depuis Réglages → Profil.

**Et elle ne se termine pas dans une leçon.** On arrive sur le parcours, d'où l'on choisit de
commencer. La différence est petite et elle compte : c'est la première fois que l'apprenant décide
quelque chose.

L'état « visite faite » vit dans les préférences de l'appareil, pas dans le profil : la visite parle
de **l'application**, pas d'une langue. Ajouter une seconde langue ne doit pas refaire visiter la
maison.

## 4. Une fiche mémoire par niveau, en PDF

Un bilan de séance se referme et ne se relit jamais. La fiche est faite pour **sortir de
l'application** : on la garde ouverte à côté de soi en commandant un café, on la relit dans le
métro, on l'imprime avant un voyage.

Elle s'obtient au bilan du niveau — le seul instant où l'on sait exactement ce qu'on vient
d'apprendre ; une heure plus tard, c'est une page de plus à aller chercher. Elle se retrouve
ensuite dans Réviser → Fiches mémoire, par thème, avec le thème entier en un seul PDF.

### Ce qu'elle contient, et ce qu'elle ne contient pas

Les mots, les tournures, les tons, les phrases prêtes à dire, les pense-bêtes (`explain` écrits à
la main), les pièges du Nord, les cartes culture, le dialogue. **Rien n'est rédigé ici** : chaque
ligne vient du pack — même discipline qu'au contrat phase20, et pour la même raison, personne dans
cette équipe ne parle le Sud.

Deux choix qui se voient :

- **le niveau, et lui seul.** Depuis le contrat phase21 §2, un niveau interroge des mots déjà
  présentés de son unité pour atteindre 20 exercices. Ces mots ont leur propre fiche ; les recopier
  diluerait celle-ci. La liste juste est `srsIntroduce` — celle qui décide de ce qui entre en rappel
  espacé, donc de ce qui est neuf ici ;
- **le trou est rebouché.** Une fiche qui affiche « Chung cư này gần chợ, ___ hơi ồn » ne se relit
  pas. Les `fill_gap` sortent avec leur réponse en place, comme la phrase se dit.

Un test tient la forme sur le contenu réel : chaque niveau du cursus a une fiche, aucune n'est
vide, aucune ne dépasse 40 lignes à retenir.

### Pourquoi le PDF est fait d'images, et pourquoi c'est le bon échange

Embarquer du **texte** dans un PDF demande d'y embarquer une police, et le vietnamien est le cas
qui casse tout : « nghệ », « tiếng », « ở đâu » empilent deux diacritiques sur une voyelle. Les
polices de base d'un PDF (WinAnsi) n'ont pas ces caractères ; une TrueType embarquée demanderait un
sous-ensembleur, un fichier de police servi à part, et près d'un mégaoctet de dépendances dans une
PWA qui doit marcher hors ligne.

On prend l'autre chemin : **le navigateur compose, le PDF transporte.** Chaque page est dessinée au
canvas avec les polices déjà chargées par l'application — Be Vietnam Pro et Source Serif 4, toutes
deux fournies avec leur jeu vietnamien — exportée en JPEG, et déposée telle quelle via `DCTDecode`.
L'écrivain PDF fait 150 lignes et n'a aucune dépendance.

Ce qu'on y gagne : un vrai `.pdf`, ouvrable et imprimable partout, des tons parfaitement rendus,
zéro réseau, zéro dépendance. **Ce qu'on y perd, et qui est assumé : le texte du PDF n'est ni
sélectionnable ni cherchable.** Pour une fiche qu'on relit et qu'on imprime, c'est le bon échange.
Le jour où ce ne le sera plus, la parade est connue — une police sous-ensemblée.

La mise en page est un moteur de flux minuscule : des blocs qui savent se mesurer avant de se
dessiner, une page qui se coupe **entre** deux blocs, et un titre de section qui ne reste jamais
seul en bas de page. Mesurer avec le code qui dessine est la seule façon de ne jamais couper un mot
de sa traduction.

## 5. Quatre défauts que seul le fait de jouer les écrans a montrés

Aucun n'aurait été trouvé par un test unitaire, et deux rendaient une fonctionnalité inutilisable.

- **« Télécharger » ne téléchargeait pas.** Edge sur Windows répond `true` à
  `canShare({ files })`. Le bouton ouvrait donc la feuille de partage de Windows au lieu
  d'enregistrer le fichier — puis annonçait « PDF enregistré » alors que rien n'avait été
  enregistré. Un bouton tient ce qu'il promet : télécharger télécharge, et le partage est devenu un
  **second** bouton, offert seulement là où le système en a un.
- **La marge était doublée.** `Math.round(106 * PRINT_SCALE) / PRINT_SCALE` puis `× PRINT_SCALE`
  portait 18 mm à 37 mm et mangeait un tiers de chaque page : la fiche de la leçon 1 sortait sur
  deux feuilles dont la seconde était vide à 85 %. Elle tient sur une.
- **Un jour isolé sur la courbe de réussite était invisible.** Une journée de travail entourée de
  deux jours creux n'a aucun segment à elle : `moveTo` sans `lineTo` ne dessine rien. Un apprenant
  qui travaille un jour sur deux voyait un graphique **entièrement vide**. Les points isolés sont
  désormais tracés.
- **Les séances courtes disparaissaient.** Les minutes du jour arrondies à la minute effaçaient
  toute séance de moins de trente secondes : le graphique annonçait « rien à montrer » un jour où
  l'on avait travaillé. La barre porte des secondes, l'étiquette parle en minutes, et le compteur
  dit « < 1 » plutôt que « 0 ».

## 6. Ce que ça ne règle pas

- **Les minutes d'avant.** Le journal démarre vide : un apprenant existant verra ses courbes de
  minutes se remplir à partir de sa prochaine séance. Les réponses, elles, remontent à 60 jours
  (`byDay` existait déjà). Reconstruire l'historique des minutes demanderait de rejouer l'`outbox`,
  ce qui n'a pas paru valoir le prix.
- **Les fiches restent muettes.** Aucun audio dans un PDF, et les 1662 enregistrements manquants
  (contrat phase21 §5) n'arrangeraient rien ici. La fiche est un objet de lecture ; c'est
  l'application qui fait entendre.
- **La taille des PDF de thème.** Huit fiches en un fichier approchent les 3 Mo en pages JPEG. Tenable
  pour un partage, discutable sur une connexion faible — et ce serait le premier argument en faveur
  d'un PDF en texte le jour où quelqu'un s'en plaint.
- **Les leurres et la relecture native** restent ce qu'ils étaient : le contenu des fiches vaut
  exactement ce que vaut le corpus, `reviewed: false` compris.
