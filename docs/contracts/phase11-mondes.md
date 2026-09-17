# Contrat — les mondes

Le cursus a déjà la bonne forme pour être lu comme une carte de jeu : **6 blocs → 24 unités →
194 leçons**, et trois blocs portent un certificat. Ce contrat ne crée donc **aucune donnée** et
**aucune règle de progression** : il groupe, nomme et dessine ce qui existe.

## 1. Un monde est un bloc

`packages/core/src/worlds.ts` ne fait que dériver :

| Monde | Bloc | Unités | Épreuve finale |
|---|---|---|---|
| 1 | L'oreille | 2 | — |
| 2 | Moi et toi | 4 | **examen A0** |
| 3 | Le quotidien | 5 | — |
| 4 | Échanger | 5 | **examen A1** |
| 5 | Vivre là-bas | 5 | — |
| 6 | Raconter | 3 | **examen A2** |

- **Ouvert** : au moins une unité du monde est disponible (`isUnitAvailable`). On ne regarde pas
  seulement la première : un monde dont une unité plus loin serait accessible resterait entrable.
- **Terminé** : toutes ses unités sont réussies (`isUnitPassed`, donc test d'unité passé).
- **Avancement** : leçons **réussies** sur leçons totales — au sens du contrat phase10 §3, pas
  « terminées ».

Les noms viennent du **contenu** (`block.title`), jamais de l'i18n : c'est le cursus qui nomme ses
mondes, et un nouveau pack apporte les siens.

## 2. Les écrans

- `/mondes` — les six, avec anneau d'avancement, numéro, cadenas, et le certificat annoncé pour les
  mondes 2, 4 et 6. Un monde fermé n'est **pas un lien**.
- `/mondes/:worldId` — on entre : l'avancement du monde, ses unités, un accès à l'examen quand il en
  porte un, puis **le chemin fluvial existant tronçonné à ses unités** (`RiverPath unitIds`). Un
  monde fermé atteint par l'URL affiche son verrou, sans aucune leçon cliquable.
- Le parcours (`/apprendre`) garde son chemin complet et gagne un lien « Mondes » dans son bandeau.

Vérifié en navigateur sur le build de production, parcours vierge : `b0:open` et les cinq autres
`locked`, un seul monde cliquable, 1 leçon cliquable dans le monde 1, et `/mondes/b4` verrouillé.

## 3. Ce que rapporte un monde

Terminer un monde est la **plus grande boucle** de l'app, donc la plus grosse récompense :

- **300 xu** et un **coffre de jade** ;
- **le paysage du monde** s'ouvre dans l'atelier — un fond par monde (« Rumeur du fleuve », « Devant
  la maison », « Ruelle de Saïgon », « Terrasse de café », « Gare routière », « Nuit de récits »),
  débloqué par un nouveau genre de condition (`{ kind: "world" }`) ;
- une carte de félicitations qui montre ce paysage, en tête de file — avant les niveaux et les
  trophées.

Les mondes terminés sont enregistrés dans l'état local des récompenses (`worlds`), comme les
collections : une récompense de monde n'est donnée qu'une fois. `finishSession` calcule la liste
complète des mondes terminés ; c'est le magasin de récompenses qui sait lesquels étaient déjà fêtés.
