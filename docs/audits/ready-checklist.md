# Prêt à l'usage — passe finale écran par écran

Contrat `phase8-design-revision.md` §5. Chaque écran a été ouvert sur les deux téléphones de
référence (iPhone 13 — 390×844 WebKit, Galaxy S25 Ultra — 412×915 Edge) et jugé sur sept points :
cohérence visuelle, textes fr/en, état vide, chargement, erreur, hors ligne, et accessibilité
(focus clavier, contraste AA, cibles ≥ 44 px). Dernier point vérifié pour tous : **aucun écran ne
renvoie vers une fonctionnalité absente** — les 48 routes de `App.tsx` couvrent les 100 % des liens
internes (vérification automatique, voir « Contrôles automatiques » en fin de document).

Légende : **OK** = conforme · **OK\*** = conforme, réserve notée · **—** = sans objet.

## Écrans d'apprentissage

| Écran | État | Ce qui a été corrigé | Reste à faire |
|---|---|---|---|
| Bienvenue (`/bienvenue`) | OK | Delta au lever du jour en ouverture (illustration SVG), promesses en pastilles jade, carte d'écoute surélevée, entrée en cascade. Bascule fr/en inchangée. | — |
| Choix de la langue (`/langue`) | OK | Cartes généreuses, nom en serif, pastille de sélection pleine, langues « bientôt » en `Chip` dans une carte discrète — plus jamais l'air cassé. | — |
| Onboarding (`/onboarding`) | OK | Question en serif, `ProgressBar` des 5 étapes, réponses en cartes pleine largeur avec coche à la sélection. Noms accessibles inchangés (« 5 min »). | — |
| Placement (`/placement`) | OK | Illustration diplôme à l'intro, `ProgressBar` + horloge pendant le test, `ProgressRing` du score, squelette à l'enregistrement (avant : `<div/>` vide). | — |
| Accueil (`/`) | OK | Hiérarchie refaite : « Reprendre » est la seule carte forte (liseré jade + anneau d'unité), langues en liste homogène en cascade, motivation en rayon discret, en-tête avec flamme de série. Premier jour : carte d'invitation avec le delta. | — |
| Parcours (`/apprendre`) | OK | Anneau de l'objectif du jour comme objet fort, salut de Cô Mai en carte douce avec médaillon, raccourcis en cartes à icônes (fini les liens soulignés nus), bandeau jade avant la carte fluviale, squelette au chargement (avant : écran vide). | — |
| Carte fluviale (`RiverPath`) | OK | Nœud courant halo curcuma + ombre, coche du jeu d'icônes, `text-phu-sa/80` remonté à AA sur les leçons verrouillées. | — |
| Séance / leçon (`/seance`, `/revision`, `/lecon/:id`) | OK | Barre de séance qui se remplit (400 ms, `transform`), bouton quitter en `IconButton`, bandeau d'entraînement et coup de pouce de Cô Mai en encarts curcuma. Écran d'erreur : carte d'alerte **et un bouton « Réessayer »** (c'était un cul-de-sac). | — |
| Correction (feuille) | OK | Feuille du système de design : jade plein + médaillon de coche quand c'est juste, surface claire + ombre montante quand c'est faux, « Cô Mai, pourquoi ? » dans un encart curcuma. Mesure de hauteur et anti-CLS inchangées. | — |
| Bilan de séance (recap) | OK | XP comptée à l'écran (`CountUp`), anneau du score au test d'unité, montée de niveau en carte curcuma, mots appris et badges en cascade (≤ 6). | — |
| Bilan d'entraînement | OK | Même charpente, mention explicite « ni XP ni progression » conservée. | — |
| Séance vide | OK | `EmptyState` avec la barque (avant : deux lignes de texte sur fond vide). | — |

## Bibliothèque et notes

| Écran | État | Ce qui a été corrigé | Reste à faire |
|---|---|---|---|
| Réviser (`/reviser`) | OK | Cinq rayons à médaillon + compteur en `Chip` au lieu de cinq cartes identiques ; le rayon dû passe en carte forte. « Encore » devient un bandeau jade + une grille de trois portes. Cascade à l'entrée. | — |
| Vocabulaire (`/reviser/vocabulaire`) | OK | Filtres regroupés dans une carte discrète, une surface par unité avec lignes séparées, états SRS en `Chip` (jade/curcuma/laque), `EmptyState` « barque » (rien appris) et « page » (recherche vide). | — |
| Fiche d'un mot | OK | Deux SVG recopiés remplacés par `IconButton` (écoute naturelle / lente), exemple et note sur surface creuse, chevron animé sous `motion-safe:`. | — |
| Grammaire et culture | OK | Jetons de type à icône, cartes culture en ton « rappel » (hiérarchie), recherche restylée, vrais états vides. | — |
| Leçons | OK | Ouverte = carte forte, terminée = carte posée + `ProgressBar` du meilleur score, à venir = carte discrète ; icône et jeton d'état. | — |
| Dialogues | OK | Répliques sur surface creuse avec filet jade, `IconButton` d'écoute. | — |
| Notes (`/notes`) | OK | `EmptyState` « carnet » et « page », tri en jetons-radio, export/copie à icônes, éditeur sur surface avec champ ≥ 16 px (pas de zoom iOS). | — |

## Jeux, karaoké, examens

| Écran | État | Ce qui a été corrigé | Reste à faire |
|---|---|---|---|
| Jeux (`/jeux`) | OK | Marché flottant en hero, chaque jeu en carte à médaillon avec son nom en serif, son accroche et son état (`record`, « pas encore joué », « bientôt » + cadenas) ; le premier jeu ouvert est la carte forte. Squelette au chargement, `EmptyState` « marché ». | — |
| Coque de jeu (`GameShell`) | OK | Retour commun, intro en carte forte, écran de résultat avec `ProgressRing` 128 px et score compté. | — |
| Karaoké (`/jeux/karaoke_tonal`) | OK | En-tête commun, liste en **une** surface à lignes séparées, squelette, `EmptyState` si aucune courbe. | — |
| Đối đáp (`/jeux/doi_dap`) | OK | Retour commun, record en `Chip`, « nouveau record » passé au curcuma cuit (AA). | — |
| Examens (`/examens`) | OK | Niveaux en cartes hiérarchisées (prêt = fort, verrouillé = discret + cadenas), `ProgressRing` de préparation au lieu d'un simple « verrouillé », squelettes, `EmptyState` « diplôme ». | — |
| Passage d'examen | OK | Volontairement calme : `IconButton` pour quitter, barre sans animation de largeur, minuterie en pastille qui ne change de ton que sous la minute, confirmation de sortie en carte d'alerte (`role="alertdialog"` conservé). | — |
| Résultat d'examen | OK | Anneau 168 px + score compté, compétences en `ProgressBar`, seuil de réussite en carte « rappel », `EmptyState` quand il n'y a aucune lacune. | — |
| Certificats (`/certificats`) | OK | Certificat en carte surélevée avec le diplôme dessiné, PDF et partage en boutons pleine largeur à icônes, squelette, `EmptyState`. | — |
| Vérification (`/verifier/:code`) | OK | Coche du jeu d'icônes, certificat en carte surélevée. | — |
| Badges (`/badges`) | OK | En-tête commun, « obtenus » / « à décrocher » séparés par des titres de section, verrouillés visiblement en retrait, squelettes, `EmptyState` « lanternes ». Médaillons dessinés inchangés. | — |

## Compte, profil, réglages

| Écran | État | Ce qui a été corrigé | Reste à faire |
|---|---|---|---|
| Profil (`/profil`) | OK | Devient une étagère à trophées : carte-héros (grand médaillon, anneau de niveau, quatre statistiques), sections à titres forts, série en carte curcuma avec les lanternes, compétences en barres, langues en cartes avec squelette. Hauteurs réservées conservées (CLS). | — |
| Réglages (`/reglages`) | OK | Longue liste découpée en cartes par thème, chaque ligne ≥ 44 px avec icône à gauche et commande à droite, options segmentées en jetons avec coche, actions destructrices en carte d'alerte laque, squelette au chargement. | — |
| Compte / connexion (`/compte`, `/connexion`) | OK | Formulaires centrés en carte surélevée, champs `rounded-field` en `text-lg`, erreurs en carte d'alerte à icône (le `role="alert"` ne porte toujours que le message). | — |
| Récupération (`/compte/*`) | OK | Même charpente ; succès signalé par un médaillon jade, attente en squelette. | — |
| Hors ligne (Réglages → Hors ligne) | OK | Barre de stockage, compteur d'unités en `Chip`, `EmptyState` quand le pack n'a rien à télécharger, lignes de squelette au lieu d'un « Chargement… » nu (la phrase reste lue par les lecteurs d'écran). | — |
| Unité hors ligne (`OfflineUnit`) | OK | Encadré sur surface creuse, `ProgressBar` nommée, coche du jeu d'icônes. | — |
| Rappels (`/rappels`) | OK | Invitation en carte curcuma à clochette, mot de Cô Mai en encart, champs `rounded-field`. | — |
| Mise à jour PWA | OK | Pastille sombre au rayon commun, ombre du système, retour de pression sur « Mettre à jour », `text-nuoc/85` remonté à AA. | — |

## Social, classes, Cô Mai

| Écran | État | Ce qui a été corrigé | Reste à faire |
|---|---|---|---|
| Cô Mai — conversation (`/co-mai/:id`) | OK | Bulles distinctes (tutrice sur surface bordée, apprenant en jade clair), texte vietnamien comme objet visuel, indicateur d'écriture au lieu d'une bulle vide, champ ≥ 16 px. | — |
| Cô Mai — bilan (`/bilan-semaine`) | OK | Carte-héros chiffrée, sections à titres, `EmptyState` quand il n'y a rien à débriefer. | — |
| Entrée Cô Mai (accueil) | OK | Carte à icône, alignée sur le langage de l'accueil. | — |
| Ligue (`/ligue`) | OK | Classement hiérarchisé : la ligne de l'apprenant est la carte forte, podium marqué par la coupe, cascade sur les six premières lignes, `EmptyState`. | — |
| Défis (`/defis`, `/defi/:code`) | OK | Cartes de défi, états vides illustrés, invitations lisibles. | — |
| Défi express / partage | OK | Même langage ; le trophée et la flamme viennent du jeu d'icônes. | — |
| Mes classes (`/mes-classes`, `/classe/:code`) | OK | Code d'inscription en champ `rounded-field`, devoirs en cartes avec échéance en `Chip` et `ProgressBar`, `EmptyState` si aucune classe. | — |
| Carte de devoir (accueil) | OK | Intégrée au langage de l'accueil, hauteur conservée (le `Slot` la réserve). | — |

## Outils internes (passe légère, hors périmètre de refonte)

| Écran | État | Ce qui a été corrigé | Reste à faire |
|---|---|---|---|
| Studio (`/studio/*`) | OK\* | Aucune refonte : l'écran hérite du fond texturé, des rayons et du focus visible via les jetons globaux. | Passe de cohérence complète (cartes, icônes, états vides) si le studio sort du cercle interne. |
| Espace enseignant (`/prof/*`) | OK\* | Idem : bénéficie des jetons, pas des primitives. | Même réserve. |

## Contrôles automatiques

| Contrôle | Où | Résultat |
|---|---|---|
| Débordement horizontal (10 écrans × 2 téléphones) | `apps/web/e2e/design.spec.ts` | aucun |
| CLS ≤ 0,05 (accueil, parcours, réviser, profil, leçon) | `design.spec.ts` (`PerformanceObserver`, Edge) | tenu |
| `prefers-reduced-motion` | `design.spec.ts` | aucune animation > 1 ms en cours |
| Contraste AA (échantillon de tous les styles de texte visibles) | `design.spec.ts` | aucun style sous le seuil |
| États vides illustrés (`/reviser`, `/notes`, `/bienvenue`) | `design.spec.ts` | illustration + phrase + action présentes |
| Liens internes → route existante | script ponctuel sur `App.tsx` (48 routes) | 0 lien mort |
| Textes fr/en | `npm run i18n:check` | 1546 clés, 0 sans anglais, 0 texte codé en dur |
| Dégradés décoratifs, majuscules espacées, flèches collées, emojis | balayage du dossier `src/` | aucun (le seul `uppercase tracking` restant est la **saisie** d'un code de classe, pas un libellé) |

## Réserves connues

1. **Studio et espace enseignant** n'ont reçu qu'une passe de cohérence (jetons globaux). Ce sont des
   outils internes : ils ne montrent pas d'état vide illustré ni de cascade d'entrée.
2. **`text-nghe` (curcuma pur) ne tient pas AA en texte** (2,2:1 sur surface claire). Le jeton
   `--color-nghe-ecrit` (5,9:1) existe pour ça et `Stat tone="nghe"` l'utilise ; le curcuma pur reste
   réservé aux icônes, aplats et bordures. À surveiller à chaque nouvel écran.
3. **Mesure du CLS** : WebKit n'expose pas `layout-shift`. Le budget est donc vérifié sur
   Galaxy S25 Ultra (Edge) ; sur iPhone, seuls débordement, contraste et états vides sont contrôlés.
4. **Les illustrations vivent dans le paquet `design`** (19 ko brut / 6,2 ko gzip avec les primitives
   et les icônes), préchargé parce que l'accueil et l'écran de bienvenue en dépendent. Un chargement
   différé du delta ferait clignoter le héros : arbitrage assumé.
5. **Captures** : `docs/audits/shots/{before,after}/{iphone-13,galaxy-s25-ultra}/` — 15 écrans par
   appareil, pris sur un vrai parcours joué, pas sur des maquettes.

---

# Phase 9 — récompenses, missions, atelier, thème sombre

Passe faite écran par écran sur les nouveautés du contrat `phase9-recompenses.md`. Les écrans
existants n'ont pas changé de structure : ils héritent du thème par les jetons.

| Écran | État | Ce qui a été vérifié |
|---|---|---|
| `/missions` | OK | Trois périodes, squelette de chargement, état vide illustré, barre de progression nommée, bouton de réclamation ≥ 44 px avec `aria-label` explicite, pastille « réclamée » après coup. |
| `/recompenses` | OK | Bourse en carte forte, 8 familles de trophées avec palier atteint **et** reste à faire, 4 collections avec les objets manquants en silhouette, état vide illustré pour la collection. |
| `/atelier` | OK | Personnage mis à jour au doigt, six emplacements, « Rien » pour les facultatifs, pièce verrouillée **expliquée** en une phrase, achat refusé avec le manque chiffré (`role="status"`). |
| Carte de félicitations | OK | `role="dialog"` + `aria-modal`, focus posé sur le bouton, Échap ferme, voile cliquable, une carte à la fois, compteur du reste, nom du profil (« Bravo, {name} ! ») et repli sans nom. |
| Accueil (carte missions) | OK | Sous le défi de la semaine, masquée quand il n'y a rien, `Slot` pour réserver sa hauteur. |
| Profil (bloc récompenses) | OK | Personnage 72 px, xu, compte de trophées, trois rangées de 48 px vers missions / récompenses / atelier, hauteurs réservées avant la lecture d'IndexedDB. |
| `/jeux/lo_to` | OK | Intro, grille 3×3 au pouce, barre de temps nommée, repli **au sens** en mode silencieux, état vide quand le pool est trop petit, `aria-live` sur le retour. |
| `/jeux/ca_phe` | OK | Intro, commande par la voix (jetons numérotés, pas les mots), repli **écrit** en mode silencieux, la bonne réponse montrée après une erreur, état vide. |
| Thème sombre | OK | Appliqué avant le premier rendu (`installTheme` dans `main.tsx`), suit le téléphone en mode « système », `color-scheme` et `theme-color` alignés, texture d'eau redessinée. |

## Contrôles automatiques (ajouts)

| Contrôle | Où | Résultat |
|---|---|---|
| Logique de récompense (compteurs, missions, trophées, coffres, atelier) | `packages/core/src/rewards/rewards.test.ts` | 40 cas |
| Deux nouveaux jeux (pool, grille, service, score) | `packages/core/src/games/{lo-to,ca-phe}.test.ts` | 20 cas |
| `build_sentence` en révision (jetons sans ponctuation) | `packages/core/src/review.test.ts` | 18 cas |
| Gains locaux (double comptage, doublons, double réclamation, achat) | `apps/web/src/rewards/rewards-store.test.ts` | 21 cas |
| Félicitations et thème | `apps/web/src/rewards/celebration.test.tsx` | 10 cas |
| Textes fr/en | `npm run i18n:check` | 1751 clés, 0 sans anglais, 0 texte codé en dur |

## Réserves connues

1. **Les récompenses ne quittent pas l'appareil** (contrat §1) : ni xu, ni trophées, ni objets, ni
   personnage ne sont synchronisés. Changer de téléphone les perd — l'export local (RGPD) les
   contient. C'est le prix de la minimisation (spec §14) et de zéro changement du contrat d'API.
2. **Les missions ne donnent pas d'XP**, seulement des xu : l'XP est réécrite par `applyServerState`
   à chaque lecture de `/me`, une XP locale s'évaporerait à la synchronisation suivante.
3. **Pas de cinquième onglet** : la barre basse reste à quatre entrées (contrat phase8 §4). Missions,
   récompenses et atelier s'atteignent depuis le profil, la carte de l'accueil et « Réviser ».
4. **Le bloc « mise en pratique » reste piloté par le contenu** : une séance de révision seule ne se
   termine pas par un mini-jeu (il faudrait toucher `planSession` et la reprise de séance). La
   variété d'une révision vient des six formats, dont `build_sentence` désormais.
5. **`prefers-reduced-motion`** : la barre de temps de Lô tô continue d'avancer — c'est une
   information, pas une décoration. Elle est mise à jour par intervalle, jamais par animation CSS.
6. **Pas de nouvelle capture e2e** : `apps/web/e2e/` n'a pas été étendu à ces écrans (Playwright non
   exécuté ici). Les tests unitaires couvrent la logique et l'accessibilité de la carte de
   félicitations ; une passe Playwright reste à faire avant livraison.
