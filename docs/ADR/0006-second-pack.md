# ADR 0006 — Deuxième pack de langue : l'espagnol (preuve d'extensibilité)

- Statut : accepté
- Date : 2026-09-15
- Contexte : spec §2, §9, §15 (Phase 3) ; contrat `docs/contracts/phase3.md` §4–5 ; ADR 0002, 0004

## Contexte

L'ADR 0002 promet qu'ajouter une langue revient à ajouter `content/<code>/` conforme aux schémas,
les modules spécifiques étant activés par `pack.json#features`. Jusqu'ici un seul pack existait
(`vi-south`, `features: ["tones", "lexical_variants", "diacritic_keyboard"]`) : la promesse n'était
pas vérifiée, et l'app web codait `ACTIVE_PACK = "vi-south"` avec une base locale mono-pack.

## Décision

### Quel pack

**Espagnol, variante neutre d'Amérique latine (`es`, `features: []`).**

- **Le contraire du premier pack sur les deux axes à risque** : pas de tons, pas de variantes lexicales
  gérées par la garde régionale. Tous les chemins « module absent » du moteur, des scripts et de l'app
  sont exercés (pas de `toneSystem`, pas de `lexical-variants.json`, pas d'`exams/`, `games/`,
  `placement.json`).
- **Écriture latine, sens ltr** : l'interface existante suffit, ce qui isole la question de
  l'architecture de celle du rendu.
- **Très grande base d'apprenants francophones et anglophones** : une vraie option produit, pas un jouet.
- **Relecture native peu coûteuse** : le contenu reste `reviewed: false` jusqu'à relecture, comme vi-south.

Un pack **tonal à écriture non latine** (thaï) sera la bonne troisième preuve : `toneSystem` différent
(5 tons, classes auditives propres), script `thai` à ajouter au schéma, clavier, césure sans espaces.

### Contenu

`content/es/` : 1 unité disponible `es.u01`, 3 leçons (salutations, se présenter, nombres 1–10),
22 concepts préfixés `c_es_` / `s_es_` (le motif de schéma `^(c|s|t|p)_…` est respecté sans le modifier),
3 cartes culture `cc_es_…`, 18 pictogrammes SVG. Types d'étapes non tonals uniquement :
`culture_card`, `listen_pick_image`, `listen_pick_text`, `build_sentence`, `speak_repeat` (sans courbe
de référence → écoute non notée), `game: cho_noi`. Le champ historique `vi` des schémas porte le texte
de la langue cible (renommage = rupture de schéma, reporté).

### Ce qui a changé, génériquement (aucun code propre à l'espagnol)

**Moteur (`packages/core`)** — toujours piloté par `pack.features` (`hasFeature`) :

- `content-checks` : cohérence `features` ↔ contenu — `tones` ⇔ `toneSystem` ; exercices de tons,
  concepts marqués d'un ton et karaoké tonal refusés sans `tones` ; `spot_the_south` refusé sans
  `lexical_variants` ; `lexical_variants` exige le fichier ; ids d'unité/leçon préfixés par le code du pack.
- `review` : formats de tons jamais choisis sans `tones` ; distracteurs « variante tonale » réservés aux
  packs tonals ; sans tons, deux formes qui ne diffèrent que par un accent (« si » / « sí ») ne sont
  jamais opposées à l'oreille.
- `games/cho-noi` : sans `heardClasses`, clé auditive prudente (accents ignorés).
- `badges` : `badgeCodesFor(pack)` — « oreille tonale » seulement pour un pack tonal.

**Scripts** : `content:validate` exige des ids de concept uniques **entre packs** (l'état SRS local et
serveur est indexé par id de concept) et isole les erreurs de schéma par pack ; `content:lint` (garde du
Sud) ne s'applique qu'aux packs `lexical_variants` ; `listPacks` ignore un dossier sans `pack.json`.

**App web** :

- `packs/` : pack actif (clé `kv` globale `activePack`, lue au démarrage), `switchPack` écrit
  `pack_switched {fromPack, toPack}` dans l'outbox dans la même transaction, choix de langue et réglages
  listant les packs du manifeste avec le nom tiré de leur `pack.json`, placement découvert au build
  (`import.meta.glob`, plus de table `"vi-south": import(...)`).
- Onboarding par pack (profil propre au pack) ; placement proposé seulement si le pack en fournit un ;
  lien Examens masqué quand le pack n'a pas d'examen.
- Synthèse vocale de repli dans la langue du pack (`pack.lang`, voix préférée d'après `variant`/`accent`) ;
  attribut `lang` du texte appris = langue du pack actif.
- Synchronisation : l'outbox est commune et part quel que soit le pack ; `/me` ne met à jour les totaux
  du pack actif qu'avec l'inscription (`enrollment(s)`, `courseCode`) de ce pack.

### Stockage local : une base, clé `packCode` (pas une base par pack)

Dexie **version 3** de la base `parlo` :

| Table / clé | Avant | Après |
|---|---|---|
| `srsCards` | clé `conceptId` | même clé + index `packCode` |
| `lessonProgress` | clé `lessonId` | même clé + index `packCode` (déduit de l'id) |
| `snapshot` | une ligne `current` | une ligne par pack (`key` = code du pack) |
| `kv` propres à une langue (`profile`, `totals`, `badges`, `placement`, `toneLog`, `games.*`, `karaoke.*`, `exams.*`) | `totals` | `vi-south:totals`, `es:totals` |
| `outbox`, `syncLog`, `packs`, `kv` globales (`account`, `activity`, préférences…) | — | inchangées, communes |

- **Clés primaires inchangées** : les ids de leçon portent le code du pack et les ids de concept sont
  uniques entre packs (vérifié en CI). La migration n'a donc ni recopie de table ni changement de clé
  primaire (non supporté par IndexedDB) : elle étiquette et renomme, sans rien supprimer. Toutes les
  données existantes (schémas v1 et v2) sont rattachées au pack d'origine (`vi-south`), qui devient le
  pack actif enregistré. Des hooks Dexie étiquettent toute carte écrite sans `packCode` (pack actif) et
  empêchent un `put` du moteur SRS d'effacer l'étiquette existante.
- `getKv`/`setKv` appliquent la portée de façon transparente : les modules existants (jeux, examens,
  défis…) deviennent « par pack » sans modification.
- **Pourquoi pas une base par pack** : l'outbox doit rester unique et ordonnée (UUID v7) pour la
  synchronisation, le compte et les préférences sont communs, et une dizaine de modules appellent `db()`
  directement ; plusieurs bases auraient imposé une fusion d'outbox et des transactions inter-bases
  (impossibles en IndexedDB).
- Tests : `apps/web/src/packs/multi-pack.test.ts` (migration v1→v3 et v2→v3 avec progression, séance
  interrompue, badges, records et compte ; deux packs sur un appareil ; hooks) ; e2e
  `apps/web/e2e/phase3-pack.spec.ts`.

## Conséquences

- Ajouter un pack = un dossier `content/<code>/` ; le build l'embarque (manifeste, bundle précaché),
  le choix de langue le propose. Aucun code à modifier tant que ses exercices existent déjà.
- **Configuration restante** : `DEFAULT_PACK` (`apps/web/src/packs/active.ts`) désigne le pack proposé à la
  première ouverture et propriétaire des données antérieures à la Phase 3 — un choix produit, pas une
  logique de langue. Les langues annoncées « bientôt » restent une liste d'interface.
- **Contraintes nouvelles** : un id de concept ne peut exister que dans un seul pack (préfixer, ex.
  `c_es_…`) ; renommer le code d'un pack casserait l'état local et serveur (comme renommer un id, ADR 0002).
- **Limites connues** : la série (streak) du serveur est par utilisateur mais stockée dans les totaux du
  pack actif ; le professeur Cô Mai et les mini-jeux Xe ôm / Bữa cơm / Đối đáp sont conçus pour vi-south
  (Xe ôm s'affiche vide sans données de pack). Les schémas gardent le nom de champ `vi` et la description
  « vietnamien » ; un renommage (`text`) demandera une version de schéma.
