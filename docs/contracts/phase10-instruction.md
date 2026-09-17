# Contrat — une logique d'instruction : présenter, puis pratiquer

Constat à l'usage de l'app déployée : on tombe directement dans les questions. La leçon **existe**
(ses mots, ses notes, ses exemples sont dans le contenu), mais elle n'est jamais *présentée* — on
pratique une matière qu'on n'a pas lue. L'enchaînement voulu est :

**leçon (découverte) → exercices, quiz, jeu → test d'unité → examen**

## 1. La fiche de découverte

Une phase de séance nouvelle, `teach`, insérée **en tête du bloc « Nouveau »** — donc après le
Réveil et le Rappel espacé : l'ordre de la spec §4.3 ne change pas, la présentation ouvre le bloc
qui introduit du nouveau.

- Elle apparaît **partout où il y a du nouveau** : la « Séance du jour » comme une leçon ouverte
  depuis la carte du parcours. C'est le chemin principal, c'est là que le manque se voyait.
- **Un seul écran**, en liste : chaque mot avec sa forme en serif, son sens, son audio (déclenché
  par l'apprenant, jamais en cascade), son ton, une phrase d'exemple et l'équivalent du Nord s'il
  existe. Les notes de prononciation sont regroupées en bas, dédupliquées.
- **Une seule fois par séance** : `SessionRun.taught` est enregistré dans le snapshot, donc une
  reprise ne la remontre pas (contrat phase5 : reprise exacte).
- **Ce n'est pas un item** : rien n'est noté, rien n'entre dans le SRS, aucun événement n'est émis,
  et la barre de progression ne bouge pas.
- **Rien à présenter, pas de fiche** : leçon de révision, test d'unité, ou concepts déjà connus →
  la phase est sautée. On ne fait pas lire une fiche vide.
- **Jamais en entraînement** (contrat phase8 §2) : rejouer une leçon terminée, c'est s'exercer, pas
  découvrir.

## 2. Ce qui ne change pas

Le reste de la chaîne existait déjà et n'est pas touché : les exercices (20 formats), le mini-jeu
du bloc « Mise en pratique », le test d'unité en fin d'unité, les examens A0/A1/A2 et leurs
certificats. Ce contrat ne fait qu'ajouter la marche manquante au début.

## 3. Verrouillage du parcours

`isLessonUnlocked` n'ouvrait déjà qu'une leçon à la fois (unité disponible + prérequis intra-unité
terminés). Ce qui court-circuitait ce verrou était le **placement** : sans enregistrement natif, son
test d'écoute était muet, répondu au hasard, et `lessonsBefore` comptait toutes les leçons sautées
comme réussies — y compris des tests d'unité. Corrigé en amont : un item de placement exige un
enregistrement natif, quelle que soit sa compétence. Sans voix natives, il n'y a donc **pas de
placement**, et chacun commence à la leçon 1.
