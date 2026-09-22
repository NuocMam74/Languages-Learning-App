# Contrat — changer d'appareil, pour de bon

Le contrat phase17 a donné le fichier de transfert, et le contrat phase5 §4 la restauration depuis
le compte. Les deux chemins marchaient, chacun de son côté — mais ce qui arrivait de l'autre côté
n'était pas tout à fait ce qui était parti. Ce lot ferme les quatre trous, dans l'ordre de ce
qu'ils coûtaient à un apprenant.

## 1. La maîtrise voyage

C'est la **maîtrise** d'une leçon — tous ses exercices notés réussis, réessais compris (contrat
phase10 §3) — et non son score, qui ouvre la leçon suivante. Elle vivait uniquement dans
`lessonProgress.mastered`, sur l'appareil. L'événement `lesson_completed` ne la portait pas, la base
du serveur n'avait pas de colonne pour elle, et `GET /me/state` ne pouvait donc pas la rendre.

Conséquence, sur le chemin le plus courant du changement d'appareil : on se connecte sur le
téléphone neuf, la progression revient — leçons terminées, cartes, XP, série, badges — et le
parcours **se reverrouille**. Toutes les leçons redeviennent « à refaire », la suivante est fermée.
Le même effet frappait une simple reconnexion sur son propre appareil : `signIn` appelle
`restoreFromServer`, qui réécrivait les lignes de progression sans la maîtrise.

Désormais :

- `lesson_completed` porte `mastered` (`packages/core/src/events.ts`, optionnel : les événements
  encore en file sur un appareil d'avant ce contrat restent valides) ;
- `lesson_progress.mastered` la garde (migration `0007`), **jamais reperdue** — comme le meilleur
  score, c'est le meilleur de toutes les tentatives ;
- `GET /me/state` la renvoie ;
- `applyRestoredState` la conserve : acquise si l'appareil l'avait, **ou** si le serveur la donne,
  **ou** si le meilleur score vaut 1 — tout juste du premier coup, c'est la maîtrise. L'inverse est
  faux (on peut maîtriser en se reprenant), et c'est précisément pourquoi il fallait la stocker.

Le serveur, lui, ne s'en sert **pas** pour juger : `progression.lesson_done` reste plus permissif
que le client. La colonne est fausse pour toutes les leçons faites avant ce contrat ; s'en servir
renverrait les comptes existants à la première leçon du cursus. Elle est gardée pour être rendue,
pas pour arbitrer.

## 2. Ce qui appartient à l'appareil ne monte pas dans le fichier

Le contrat phase17 §1 laissait déjà sur place `account`, `activePack`, `outbox`, `syncLog`, la
séance en cours et les contenus téléchargés. Mais il emportait « tout ce que `kv` contient » — et
`kv` a grossi. S'y trouvaient des choses qui ne décrivent pas un apprenant : elles décrivent *ce
navigateur-ci*, ou ce qui attend d'en partir.

| Clé `kv` laissée | Pourquoi |
|---|---|
| `notifications` | Porte l'abonnement push du navigateur d'origine. L'importer affiche des rappels « activés » que personne n'enverra — et `shouldOfferReminders` ne propose plus de les activer ici. L'heure, elle, voyage : elle se redéduit du profil. |
| `notifications.asked` | « On a déjà proposé les rappels. » Sur un appareil neuf, il faut redemander la permission : la question doit se reposer. |
| `express.queue` | Des scores en attente d'envoi. Même raison que l'`outbox` : les rejouer ailleurs les compterait deux fois. |
| `profile.pendingPatch` | Un changement de profil pas encore parti, propre à cet appareil. |
| `leagues.unsynced` | Le même drapeau, pour la ligue. |
| `sync.poison` | Compte les échecs de lignes d'`outbox` — qui, elles, ne traversent pas. Ses compteurs n'auraient plus rien à désigner et ne seraient jamais nettoyés. |

Ce qui reste emporté, et qui aurait pu être confondu avec ce qui précède : `express.best` (un
record, pas une file), `leagues.enabled` (un choix, pas un envoi), `challenges.current` (un cache
qui se refait), `rewards`, `guidesRead`, `displayName`, `games.*`, `karaoke.*`, `exams.*`.

## 3. Reposer son fichier ne déconnecte pas

`applyTransfer` en mode « remplacer » réutilise `clearLearningData`, la fonction de la déconnexion.
Or celle-ci efface **toutes** les clés `kv` sauf `activePack` — `account` compris. Le geste courant
sur un téléphone neuf est pourtant : se connecter d'abord (la progression du serveur revient),
reposer son fichier ensuite (pour les notes, les favoris, les records, la tenue — ce que le serveur
n'a pas). On se retrouvait déconnecté, sans un mot, au moment précis où l'on croyait tout récupérer.

L'import repose maintenant les clés de `KEPT_LOCAL` telles qu'elles étaient. Ce que le fichier
laisse sur l'appareil (§2), l'import ne l'efface pas non plus : laisser et écraser sont la même
promesse.

## 4. L'export RGPD n'oublie plus une table

`exportLocalData` (spec §14) est un droit d'accès : le vidage de **toutes** les tables de données
personnelles de l'appareil. Il avait été écrit avant les favoris (contrat phase18 §1) et ne les
avait jamais rattrapés — la seule qui manquait. Elle y est. (`packs`, `units` et `offlineUnits`
n'en sont pas : c'est du contenu public mis en cache, pas les données de quelqu'un.)

## 5. Ce qui est vérifié

- `apps/web/src/transfer.test.ts` : les clés de l'appareil ne partent pas ; reposer un fichier en
  mode « remplacer » garde le compte connecté et la langue affichée.
- `apps/web/src/phase5.test.ts` : la maîtrise survit à la restauration — locale, distante, ou
  déduite d'un score parfait ; une leçon terminée en se trompant reste à refaire.
- `apps/api/tests/test_parcours_api.py` : la maîtrise fait l'aller-retour appareil A → serveur →
  appareil B, et une tentative ratée ensuite ne la défait pas.
- `apps/web/src/favorites.test.ts` : les favoris sont dans l'export RGPD.
