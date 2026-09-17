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

## 3. Réussir avant de passer à la suite

Règle : **une leçon n'est validée que si tous ses exercices notés ont été réussis** — réessais
compris, le moteur reproposant déjà un item raté une fois (spec §3.3). Tant qu'il reste une erreur
non corrigée, la leçon reste ouverte (il faut bien pouvoir la refaire) et **la suivante reste
fermée**.

- `isLessonMastered` (core/engine.ts) mesure cette maîtrise : on regroupe par étape, donc un item
  réussi au deuxième essai compte comme réussi. C'est la différence avec `lessonScore`, qui mesure
  le sans-faute du premier jet et sert au seuil des tests d'unité, à l'XP et aux statistiques.
- `lessonProgress.mastered` la garde, au mieux de toutes les tentatives : une maîtrise ne se reperd
  jamais, et une reprise ratée ne referme pas la suite. Les lignes écrites avant ce contrat n'ont
  pas le champ : elles ne valent pas réussite, on ne valide pas rétroactivement une leçon dont on
  ne sait rien.
- `isLessonUnlocked` exige désormais les prérequis **réussis**, plus seulement terminés. Le contenu
  décrit bien la chaîne : 193 leçons sur 194 déclarent la précédente en prérequis.
- Sur la carte du parcours, une leçon terminée mais non réussie **ne se coche pas** : elle s'affiche
  « à refaire » (pastille curcuma, icône de reprise, nom accessible explicite). Une pastille verte
  suivie d'une étape verrouillée serait incompréhensible.

Pourquoi « tout réussi, réessais compris » plutôt que « 100 % du premier coup » : le sans-faute de
premier jet est **inatteignable tant qu'aucun enregistrement natif n'existe** (les exercices
d'écoute ne sont pas jouables), ce qui bloquerait le parcours à la leçon 1. La règle retenue exige
autant — rien ne passe à la trappe — mais reste franchissable en corrigeant ses erreurs.

Les **examens certifiants** gardent leur seuil de 75 % (spec §5.5) : c'est le **serveur** qui calcule
la réussite et émet le diplôme. Monter le seuil côté app seulement ferait refuser un examen que le
serveur a validé, PDF déjà émis. À changer des deux côtés, ou pas du tout.

## 4. Inviter à configurer son espace

Une carte sur l'accueil, sous la carte des missions, quand il manque le **nom** du profil ou que le
**personnage** n'a jamais été habillé. Ton de la spec §5.8 : une invitation, jamais un reproche —
elle dit ce qu'on y gagne (« l'app te parlera par ton nom »), pas ce qui manque.

- N'apparaît qu'une fois la première séance faite : avant, la seule chose à faire est d'apprendre
  quelque chose.
- Disparaît d'elle-même dès que les deux sont faits, et se referme pour de bon d'un geste
  (« Plus tard », mémorisé) : elle ne revient pas harceler.

## 5. Ce que le placement ne fait plus

`isLessonUnlocked` n'ouvrait déjà qu'une leçon à la fois. Ce qui court-circuitait ce verrou était le
**placement** : sans enregistrement natif, son test d'écoute était muet, répondu au hasard, et
`lessonsBefore` comptait toutes les leçons sautées comme réussies — y compris des tests d'unité.
Corrigé : un item de placement exige un enregistrement natif, quelle que soit sa compétence. Sans
voix natives, il n'y a donc **pas de placement**, et chacun commence à la leçon 1.
