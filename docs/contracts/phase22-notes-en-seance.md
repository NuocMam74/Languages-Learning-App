# Contrat — ne pas donner la réponse, et pouvoir noter en chemin

Deux constats en jouant le parcours, sans rapport l'un avec l'autre sauf qu'ils touchent au même
écran : celui où l'on répond.

## 1. Une phrase à assembler ne s'affiche plus au-dessus de ses jetons

`build_sentence` demande de remettre des mots dans l'ordre. L'écran montrait, sous la consigne,
**la phrase cible en vietnamien** suivie de sa traduction. Il n'y avait donc rien à assembler : la
réponse était écrite trois centimètres au-dessus des jetons.

La règle existait pourtant déjà, et elle était appliquée ailleurs : `meaningGivesAnswer`
(`apps/web/src/exercises/meaning.tsx`) retient le sens tant qu'il donnerait la réponse, et
`tone_identify` montre déjà la traduction sans la graphie « — elle porte la réponse ».
`build_sentence` était simplement passé à travers.

Désormais il renvoie `{ vi: null, gloss }` : la **traduction reste** (sans elle, on remet des jetons
dans l'ordre sans savoir ce qu'on écrit — c'est la consigne), la phrase vietnamienne disparaît.

Elle revient exactement là où elle sert : **dans la correction, et seulement si on s'est trompé.**
La feuille de correction affichait déjà « La bonne réponse : … » avec `evaluation.expected`, qui
pour ce format est la phrase cible. Rien à ajouter — il fallait arrêter de la montrer avant.

Un cas de test rend la régression impossible : on rend l'exercice et on vérifie que la cible
n'apparaît nulle part à l'écran, ni dans la ligne de sens, ni parmi les jetons (ils la contiennent
mot à mot, mais dans le désordre — c'est l'exercice).

## 2. Prendre une note pendant la séance, les relire à la fin

Les notes personnelles existaient (contrat phase8 §3), mais seulement là où l'on ne travaille pas :
la fiche d'un mot, le bilan d'une leçon, la page Notes. Or le moment où l'on a quelque chose à
noter, c'est l'exercice lui-même — « ah, `mả` et `mã` sonnent pareil » se pense entre deux
questions, et se perd si l'écran ne propose rien.

**Pendant la séance** (`notes/SessionNote.tsx`) : un bouton dans l'en-tête, à côté du cœur, ouvre un
bloc de saisie sous la barre de progression. Il pousse l'exercice vers le bas, il ne le recouvre
pas — on note *en regardant* la question. Une pastille signale que l'élément courant a déjà une
note. Le bloc se referme à chaque question : une note par exercice, pas un cahier ouvert.

La note se range sur **le mot travaillé** quand l'exercice n'en porte qu'un : elle réapparaît alors
sur sa fiche dans la bibliothèque, pas seulement dans une liste de fin de séance. Sinon (phrase à
assembler, appariement, carte culture) elle se range sur la leçon. C'est le même composant
`NoteBlock` que partout ailleurs : écrire une note reste le même geste.

**Au bilan** (`notes/SessionNotesRecap.tsx`) : toutes les notes prises en chemin, chacune précédée
de ce dont elle parle (le mot et son sens, ou la leçon), et un lien vers la page Notes.

« Prises en chemin » se lit simplement : **écrites depuis le début de la séance**
(`SessionRecap.startedAt`). Pas de nouveau champ en base, pas de lien note ↔ séance à maintenir, et
une note de la veille modifiée aujourd'hui reste là où elle est.

Rien ne change côté données : les notes restent **locales et propres à une langue**, jamais
d'événement, jamais d'outbox, jamais d'envoi au serveur (spec §14). Elles sont déjà dans l'export
local RGPD et dans l'export de la page Notes.
