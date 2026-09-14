# Relire et corriger le contenu

Ce guide est pour toi si tu parles le vietnamien du Sud et que tu relis les leçons de Parlo.
Tu n'as pas besoin de savoir programmer.

## Pourquoi ta relecture compte

Une partie du contenu a été rédigée par une machine. Tant qu'un locuteur natif du Sud ne l'a pas
relu, il est marqué `"reviewed": false`. **Aucune leçon non relue ne sera publiée.**
Tu es la garantie que ce qu'on enseigne sonne juste à Saïgon et dans le delta.

## Où se trouve le contenu

Tout est dans le dossier `content/vi-south/` :

| Dossier ou fichier | Ce qu'il contient |
|---|---|
| `lessons/u01/l01.json` | une leçon (unité 1, leçon 1) : les exercices, dans l'ordre |
| `concepts/c_ba.json` | un mot ou une phrase : forme écrite, traduction, note, audio |
| `culture/cc_family_south.json` | une carte culture (60 mots maximum) et sa question |
| `lexical-variants.json` | le tableau Sud / Nord (ba / bố, chén / bát…) |
| `pack.json` | la phrase d'accueil de l'application |

Tu peux ouvrir ces fichiers dans le navigateur, sur GitHub : bouton crayon pour modifier,
puis « Propose changes ». Quelqu'un de l'équipe vérifie et intègre.

## Comment lire un fichier

Les fichiers sont en JSON. Seul le texte entre guillemets après les deux-points te concerne :

```json
"vi": "Đây là ba tôi.",
"gloss": { "fr": "papa", "en": "dad" },
"note": { "fr": "Au Sud on dit ba ; au Nord, bố." }
```

- `vi` : le vietnamien. C'est ce que tu relis en priorité.
- `fr`, `en` : les traductions et explications.
- `northernEquivalent` : la forme du Nord, montrée **exprès** pour qu'on la reconnaisse.

Ne touche pas aux `"id"`, `"type"`, ni aux noms entre guillemets avant les deux-points.
Garde les guillemets `"` et les virgules : s'il en manque un seul, le fichier est refusé.
Pas d'inquiétude, un contrôle automatique le signale tout de suite.

## Ce qu'on te demande de vérifier

1. **Naturel du Sud.** Est-ce qu'on le dit vraiment comme ça à Saïgon ou dans le delta ?
   Formulation trop livresque, trop du Nord, ou pas assez familière ?
2. **Tons et orthographe.** Chaque diacritique est-il juste ? (`má` n'est pas `mà`.)
3. **Pronoms et politesse.** `anh`, `chị`, `em`, `dạ`… adaptés à la situation décrite ?
4. **Traductions.** Le sens français est-il fidèle, sans contresens ?
5. **Explications.** Une explication courte, vraie, jamais une règle inventée.
6. **Paires de tons.** Au Sud, hỏi et ngã se prononcent pareil : on ne demande **jamais**
   de les distinguer à l'oreille. Si tu vois un exercice qui le fait, signale-le.

## Quand tu as fini

- Si tout est juste, remplace `"reviewed": false` par `"reviewed": true`.
- Si tu as corrigé, fais pareil, et décris ta correction dans le message de proposition.
- Si tu hésites, laisse `false` et écris ton doute dans le message : c'est très utile.

## Les contrôles automatiques

À chaque proposition, deux vérifications tournent seules :

- **Validation** : format du fichier, références entre fichiers, longueur des cartes culture,
  interdiction d'opposer hỏi et ngã…
- **Garde du Sud** : si un mot du Nord (`bố`, `vâng`, `bát`…) apparaît dans du vietnamien
  censé être du Sud, la proposition est bloquée. Si c'est un faux positif (par exemple
  « công bố », qui se dit partout), dis-le : on ajoute une exception dans `lexical-variants.json`.

## Enregistrer l'audio

Les fichiers audio sont nommés d'après le mot : `c_ba_mai.opus` pour « ba » par la voix de Mai,
`c_ba_mai_slow.opus` pour la version lente. Pour les séances d'enregistrement, l'équipe te
fournira la liste des phrases et les consignes (48 kHz, pièce calme, même distance du micro).
La version lente est produite ensuite par logiciel : tu n'as pas à parler lentement.
