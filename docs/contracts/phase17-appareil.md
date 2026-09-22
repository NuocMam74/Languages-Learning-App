# Contrat — changer d'appareil

Toute la vie d'un apprenant tient sur son appareil. Pour un invité — le mode par défaut, celui
dans lequel on fait sa première leçon — **uniquement** là. Changer de téléphone revenait à tout
perdre : la série, les cartes de révision, les leçons acquises, les notes personnelles, le
personnage habillé.

Un compte ne suffit pas à répondre. Il sauve ce que le serveur reçoit (progression, XP, série),
mais pas ce qui ne part jamais : les **notes personnelles** (contrat phase8 §3, minimisation
spec §14), les **fiches conseils lues**, les **records des jeux**, la **tenue du personnage**, ni
les réglages de l'appareil.

Il existait déjà un export RGPD (`exportLocalData`, spec §14) : un vidage de toutes les tables, fait
pour être lu par une personne qui exerce son droit d'accès. Il n'est pas réimportable — il contient
la file d'envoi, le journal de synchronisation, la séance en cours — et ce n'est pas son rôle.

## 1. Un fichier de transfert

`apps/web/src/transfer.ts`. Un JSON versionné, `{ app: "parlo", kind: "transfer", version, … }`.

**Ce qu'il emporte** : les cartes de révision, la progression des leçons, les notes, et tout ce que
`kv` contient par langue — profil, totaux, série, badges, placement, statistiques, examens,
récompenses et tenue, fiches conseils lues, records des jeux — plus les préférences de l'appareil
(langue d'interface, thème, mode silencieux, sons, dictée).

**Ce qu'il laisse**, et pourquoi chacun :

| Laissé | Pourquoi |
|---|---|
| `account` (session) | Un fichier ne transporte pas une identité. L'importer afficherait un compte sans session derrière. On se reconnecte ; le serveur renvoie ce qu'il avait. |
| `activePack` | La langue affichée est un choix local. On ne la change pas sous les pieds de quelqu'un. |
| `outbox`, `syncLog` | Des événements en attente pour **cet** appareil. Les rejouer ailleurs compterait deux fois la même séance. |
| `snapshot` (séance en cours) | Liée à une version de contenu et à un instant. On la recommence : ce n'est pas une perte de progression. |
| `packs`, `units`, `offlineUnits` | Des dizaines de mégaoctets qui se retéléchargent. Un fichier de transfert doit pouvoir s'envoyer par message. |
| `notifications`, `express.queue`, `profile.pendingPatch`, `leagues.unsynced`, `sync.poison` | Ajoutés par le contrat phase25 §2 : l'abonnement push de **ce** navigateur, et ce qui attend d'en partir. Même raison que l'`outbox`. |

Le **résumé** affiché (XP, leçons, mots en révision, notes, ligne par langue) est toujours
**recalculé** à partir des tables, jamais lu dans le fichier : un fichier ne s'auto-certifie pas.

**Relire ne s'écrit pas.** `parseTransfer` valide sans rien toucher et dit *pourquoi* il refuse —
illisible, pas de Parlo, version trop récente, vide. « Fichier invalide » ne dit pas à quelqu'un
s'il s'est trompé de fichier ou s'il doit mettre son application à jour. Un export RGPD tombe sur
« ne vient pas d'un transfert », avec la phrase qui l'explique. Les lignes abîmées sont écartées une
à une : un fichier à moitié corrompu rend ce qu'il a de bon.

## 2. Deux gestes, un écran

`/reglages/appareil`, et une entrée en tête de la section « Données » des réglages — **avant**
l'export RGPD, parce que c'est le geste qu'on vient chercher là.

Un écran à lui plutôt qu'une ligne de plus, pour une raison : on n'y vient qu'une fois, dans un
moment précis — un téléphone neuf dans une main, l'ancien dans l'autre — et ce qui s'y passe
**écrase** ce que l'appareil contient. Ça mérite de la place, un ordre numéroté (*1. sur l'ancien
appareil*, *2. sur le nouveau*) et une comparaison avant d'écrire.

**Rien ne s'écrit sans qu'on ait vu les deux côtés.** Le fichier et l'appareil sont affichés dans la
même forme, l'un au-dessus de l'autre.

**Deux modes :**

- **Remplacer** — l'appareil repart de ce que dit le fichier. C'est le geste d'un changement
  d'appareil, et c'est le défaut. Il réutilise `clearLearningData`, la même fonction que la
  déconnexion : les contenus téléchargés et la langue active ne sont pas touchés. Les clés que le
  fichier laisse sur l'appareil sont reposées telles quelles après l'effacement (contrat phase25
  §3) — sans quoi reposer son fichier déconnectait.
- **Fusionner** — on garde, pour chaque mot et chaque leçon, l'état le plus avancé des deux. Les
  cartes passent par `mergeCards`, la résolution de conflit du SRS (ADR 0003) : **un transfert n'est
  qu'une synchronisation faite à la main**, il n'avait pas besoin d'une règle à lui. Une leçon garde
  le meilleur score, le plus grand nombre de tentatives, la maîtrise si l'un des deux l'a, et la
  **première** date d'achèvement. Les totaux ne descendent jamais. Une note : la plus récemment
  modifiée gagne.

Le choix n'apparaît **que si l'appareil a quelque chose à perdre**. Sur un téléphone neuf — le cas
courant — il n'y a rien à arbitrer, et on ne pose pas la question.

## 3. Ce qui est vérifié

`apps/web/src/transfer.test.ts` :

- le fichier contient la progression, les notes et les réglages ;
- l'identité connectée et la langue affichée **restent** sur l'appareil ;
- le résumé se calcule langue par langue ;
- chaque refus a son motif, et un fichier bien formé mais vide ne passe pas pour un transfert ;
- les lignes abîmées sont écartées, le reste passe ;
- un appareil neuf retrouve **exactement** l'état du fichier — profil, fiches lues, notes, réglages ;
- « remplacer » efface bien ce que l'appareil avait ; « fusionner » ne perd rien, ni d'un côté ni de
  l'autre, et les totaux ne descendent pas ;
- **l'aller-retour est fidèle** : exporter, importer sur une base vierge, réexporter donne le même
  fichier. C'est la garantie qui porte toutes les autres.

## 4. Ce que ce contrat ne fait pas

Il ne remplace pas le compte. Avec un compte, la progression voyage toute seule et se restaure à la
connexion ; le fichier couvre ce que le serveur n'a pas. Sans compte, il est la **seule** façon de ne
pas repartir de zéro — et c'est pour ce cas qu'il a été écrit.

Il ne chiffre rien. Le fichier contient un prénom, des statistiques d'apprentissage et des notes
personnelles ; il ne contient ni mot de passe, ni jeton, ni adresse email de connexion. C'est à son
propriétaire de choisir par quel canal il se l'envoie — l'écran le dit.
