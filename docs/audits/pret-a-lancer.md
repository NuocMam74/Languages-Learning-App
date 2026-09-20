# L'application est-elle prête à être utilisée ?

État au 20 septembre 2026, après la session de correction et les contrats phase16 à phase19.

La réponse courte : **le logiciel est prêt, le contenu ne l'est pas.** Les deux choses sont
séparables, et ce document dit exactement où passe la ligne.

## 1. Ce qui est vert, et comment le revérifier

```bash
npm run check   # types + 918 tests unitaires + contenu + garde du Sud + i18n
npm run build   # build de production (PWA, service worker)

# Parcours de bout en bout. Sur une copie de travail **synchronisée** (ce dépôt est dans OneDrive),
# sortir les artefacts du dossier synchronisé — sinon le client de synchronisation verrouille les
# traces pendant que Playwright les écrit, le serveur de prévisualisation tombe, et une dizaine de
# tests échouent en cascade sans que l'application y soit pour rien.
cd apps/web && PW_OUTPUT_DIR="$TEMP/parlo-e2e" npx playwright test
```

| | |
|---|---|
| Types (4 projets) | ✅ |
| Tests unitaires | ✅ **918** (522 cœur, 20 garde du Sud, 376 web) |
| Parcours de bout en bout | ✅ **78** — dont l'audit visuel aux deux gabarits de référence |
| Validation du contenu | ✅ valide, 246 avertissements (tous « non relu » ou « média absent ») |
| Garde du Sud | ✅ aucune forme du Nord bloquante |
| i18n | ✅ 1966 clés, aucune sans anglais, aucun texte codé en dur |
| Build PWA | ✅ |

Point de départ de la session : **22 parcours en échec**, et une suite qui ne **démarrait même pas**
(un fichier refusait de se charger, ce qui empêchait tous les autres de tourner).

## 2. Ce qui bloque une mise en ligne publique

Une seule chose, et elle ne relève pas du code :

```bash
npm run content:validate -- --production
# 981 erreur(s) de contenu
```

Ce sont **les mêmes 981 erreurs** depuis le début, et elles se rangent en deux paquets :

| | Quoi | Qui peut le faire |
|---|---|---|
| **Relecture** | Tout le corpus est `reviewed: false`, y compris les 15 concepts écrits cette session. Le contrôle de production refuse de publier du vietnamien qu'aucun humain n'a validé. | Un locuteur du Sud. `CONTENT.md` est le guide écrit pour lui, sans jargon. |
| **Voix** | 1662 fichiers audio référencés, **zéro** enregistré. Sans eux : pas d'exercice d'écoute, pas de transcription, pas de dialogue, pas de Chợ nổi, pas de test de placement. | Une séance d'enregistrement. `docs/AUDIO.md` et `npm run audio:list`. |

C'est **délibéré** et il ne faut pas le contourner : passer `reviewed: true` sans relecture
reviendrait à affirmer une chose fausse sur la qualité du contenu, et publierait comme du
vietnamien du Sud validé ce qu'une machine a écrit.

L'application **fonctionne** sans : elle retire proprement ce qui n'est pas jouable et annonce le
manque une fois, calmement (contrat phase16 §5). Elle est utilisable aujourd'hui par un testeur.
Elle n'est pas publiable.

## 3. Une divergence connue et assumée

Le client exige la **maîtrise** d'une leçon pour ouvrir la suivante (contrat phase10 §3). Le
serveur ne reçoit jamais cette information — seulement des scores — donc son `next_lesson` est plus
permissif.

Sans effet sur l'apprentissage : le client décide de la séance, le serveur ne s'en sert que pour le
pointeur d'inscription et la phrase du bilan hebdomadaire. La divergence est documentée des deux
côtés (`packages/core/src/session.ts`, `apps/api/app/services/progression.py`) avec la raison de ne
pas « l'aligner » à l'aveugle : avec le `passed` actuel du serveur, une leçon ordinaire n'y figure
jamais, et `next_lesson` renverrait éternellement la première leçon du cursus.

## 4. Ce que je n'ai pas pu vérifier ici

- **Les tests de l'API** (`apps/api`, pytest) : `uv` n'est pas installé sur cette machine et les
  dépendances Python ne sont pas présentes. Je n'ai touché à l'API qu'en **commentaire** (une
  docstring dans `progression.py`), vérifié par `ast.parse`. La CI les exécute à chaque envoi.
- **Le budget Lighthouse mobile (≥ 90)** de la CI : il demande un environnement de CI, pas un
  poste de travail.

## 5. Ce qui a été ajouté pendant la session

| Contrat | Ce que ça change pour qui apprend |
|---|---|
| `phase16-prerequis` | On ne lance plus un exercice sur ce qu'on n'a pas vu. Dette de contenu soldée : 45 → 0, garde en `error`. « Réviser » dit par où commencer. |
| `phase17-appareil` | Changer de téléphone sans rien perdre : un fichier, deux gestes, une comparaison avant d'écrire. |
| `phase18-favoris` | Aimer une leçon ou un exercice, les retrouver, **rejouer les exercices aimés seuls**. |
| `phase19-mouvement` | L'eau du delta dérive en deux couches ; le nœud du jour émet une onde. CLS 0,0000, et le calme se respecte vraiment. |

Trois défauts produits trouvés et corrigés en chemin, tous invisibles jusque-là parce que la suite
de tests ne tournait pas :

1. **Le cul-de-sac du parcours** — terminer une leçon avec une erreur vidait la séance du jour et
   faisait disparaître le bouton principal de l'accueil, pendant que la carte affichait « à
   refaire » ;
2. **L'écran blanc sur profil partiel** — des totaux sans série, venus d'une version plus ancienne
   ou d'une restauration, faisaient tomber l'accueil ;
3. **Le calme qui s'emballe** — sous `prefers-reduced-motion`, les animations en boucle tournaient
   mille fois par seconde au lieu de s'arrêter.

## 6. Le geste suivant

1. ~~Commiter.~~ Fait : `c452669` (contrats phase16–19) puis `03c1d0d` (jeux sans voix retirés,
   deux courses de la suite de bout en bout).
2. **Enregistrer les voix**, ou au minimum celles de l'unité 1, pour voir la chaîne d'écoute
   fonctionner de bout en bout.
3. **Faire relire** le corpus par un locuteur du Sud, unité par unité — `reviewed: true` se pose
   fichier par fichier, la publication n'attend pas que tout soit fait.
