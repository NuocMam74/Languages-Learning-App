# Contrat — fermer la boucle d'apprentissage

Deux manques constatés en lisant le code, puis vérifiés en jouant une séance :

1. **Le bilan ne disait jamais ce qui avait résisté.** Il célébrait (XP, série, « ce que tu sais
   dire », badges) et se taisait sur les erreurs. On terminait une séance sans savoir sur quoi on
   avait buté — le contraire d'un retour d'apprentissage.
2. **Les mots difficiles se reprenaient un par un.** Le filtre « difficile » et le « revoir
   maintenant » existaient, mais reprendre trente mots demandait trente gestes.

## 1. « Ce qui a résisté »

`sessionMisses` (core/session-run.ts) sépare, concept par concept et non étape par étape :

- **`missed`** — ratés et **pas rattrapés** avant la fin : ce sont eux que le bilan nomme ;
- **`recovered`** — ratés puis réussis : l'essentiel du travail d'une séance, et ça se dit aussi.

Un même mot croisé en rappel espacé puis dans la leçon ne compte qu'une fois. Les items non notés
sont ignorés (carte culture sans question, oral sans courbe, jeu passé) : ils ne peuvent ni
résister ni être rattrapés.

Dans le bilan, la section arrive **après** « Ce que tu sais dire » : on félicite d'abord, on nomme
ensuite. Chaque mot est réécoutable. Le ton suit la spec §5.8 — « ils reviennent d'eux-mêmes dans
tes prochaines révisions » est une information vraie (le SRS les replanifie), pas une consolation.

## 2. Reprendre ses mots difficiles en bloc

Sur la page vocabulaire, un bouton reprend d'un geste les mots affichés — donc, avec le filtre
« difficile », les mots qui résistent.

Deux garde-fous, parce qu'une file impossible décourage plus qu'elle n'aide :

- seuls les mots **pas déjà dus** sont forcés (les autres sont déjà dans la file) ;
- plafond à **20** : remettre 400 mots d'un coup noierait la séance du jour.

Après le clic, le bouton devient le lien vers la révision : l'action se termine là où elle mène.

Vérifié en navigateur sur le build de production : « Revoir ces 5 mots maintenant » → « 5 mots remis
dans ta file — commencer » → `/revision`, séance ouverte.
