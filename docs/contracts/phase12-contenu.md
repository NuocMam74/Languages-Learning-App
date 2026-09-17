# Contrat — enrichir le contenu sans inventer de langue

Constat mesuré : **21 concepts sur 713** avaient une phrase d'exemple. Conséquences directes sur
l'apprentissage, pas seulement sur l'affichage :

- la fiche de découverte (contrat phase10 §1) n'avait presque rien à montrer ;
- `fill_gap` n'était constructible que pour **20** concepts, `build_sentence` pour **12**
  (`packages/core/src/review.ts` les construit depuis les phrases d'exemple) — la « variété des six
  formats de révision » était donc quasi théorique.

## 1. Des exemples dérivés du corpus, jamais inventés

`scripts/derive-examples.ts` rattache à un concept une phrase **déjà écrite ailleurs dans le pack**,
avec sa traduction : cibles de `build_sentence`, phrases à trou de `fill_gap` (trou rempli),
questions de `speak_answer`, phrases de `translate_to_vi` / `translate_to_fr`, répliques de
dialogues. 345 phrases distinctes disponibles.

Pourquoi dériver plutôt que rédiger : ces phrases sont déjà dans le corpus, au **même état de
relecture** (`reviewed: false` partout), et passent déjà la garde du Sud. Rien de nouveau n'entre
dans la langue enseignée, donc rien de nouveau à faire relire — alors que 692 phrases rédigées par
une machine auraient ajouté 692 risques sur une langue tonale à variantes régionales.

Règles de choix : la forme du concept doit apparaître comme **suite de mots entière** (le vietnamien
s'écrit en syllabes séparées — une sous-chaîne attraperait « ba » dans « bàn ») ; la phrase ne se
réduit pas au concept ; on préfère une phrase de la leçon qui l'introduit, ou de la plus proche
(un exemple ne convoque pas du vocabulaire venu bien plus tard) ; à égalité, la plus courte, et
celles de 3 à 8 mots d'abord — les bornes de `build_sentence`.

Un concept déjà pourvu n'est **jamais** touché : le travail éditorial passe avant. Le script est
idempotent.

### Résultat

| | avant | après |
|---|---|---|
| Concepts avec un exemple | 21 | **437** |
| `fill_gap` constructible | 20 | **417** (58 %) |
| `build_sentence` constructible | 12 | **391** (55 %) |
| Formats de révision par concept | — | **3,8 en moyenne** ; 516 concepts en ont ≥ 3 |

276 concepts restent sans exemple : aucune phrase du corpus ne les contient. Ils attendent du
contenu rédigé, puis relu.

## 2. Un item muet montre sa transcription

Quand la lecture échoue faute de **tout** — ni enregistrement, ni voix installée sur l'appareil —
la transcription s'affiche sous le bouton. Cacher la transcription protège la réponse d'un exercice
d'écoute **s'il y a quelque chose à écouter** ; sans audio, la cacher rend l'item simplement
impossible.

L'examen garde son verrou (`TranscriptsAllowed` à false) : là, un item muet reste sans réponse
plutôt que d'être offert. Le mode silencieux, lui, affiche déjà sa transcription (spec §13) : la
règle ne s'ajoute que pour le cas « rien à entendre ».

C'est un pansement assumé sur le manque d'enregistrements, pas une solution : les 1630 fichiers
audio restent le premier chantier du projet.
