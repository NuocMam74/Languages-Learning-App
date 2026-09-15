# Graphe des unités — vietnamien du Sud

Pour les relecteurs natifs et les éditeurs. Source de vérité : `curriculum.json` → `units[].requires`
(contrat parcours §2). Une unité est proposée quand **toutes** les unités requises ont leur épreuve réussie
(score ≥ 0,7) ou ont été sautées au placement. Parmi les unités disponibles, le profil (famille, voyage,
travail…) trie par `tags` : c'est ce graphe qui permet à chaque parcours de changer réellement l'ordre.

Règles de conception : graphe sans cycle, une seule racine (u01), toute unité atteignable ; l'ordre de la
liste reste un ordre valide ; une unité ne dépend jamais d'une unité d'un bloc de certificat ultérieur ;
chaque dépendance est justifiée par un besoin de langue (mot ou structure réellement réemployé dans les
leçons, hors distracteurs d'image).

| Unité | Requiert | Pourquoi |
|---|---|---|
| u01 Premiers sons | — | Tronc commun : tons, salutations. |
| u02 Alphabet, sons du Sud | u01 | Tronc commun : lecture et finales du Sud. |
| u03 Pronoms, âge | u02 | Tronc commun : tout le reste s'adresse à quelqu'un (anh/chị/em, cô/chú…). |
| u04 Famille | u03 | Termes de parenté = extension des pronoms. Famille remontée juste après le tronc (§6.2). |
| u05 Se présenter | u03 | Tên gì, người nước nào : pronoms d'adresse requis. |
| u06 Chiffres | u03 | Bao nhiêu tuổi réemploie l'âge et les pronoms. |
| u07 Manger et boire | u06 | Commander, l'addition : quantités et prix. |
| u08 Marché et prix | u06 | Prix, ký, ngàn. |
| u09 Temps et heures | u06 | Mấy giờ, dates : chiffres. |
| u10 Lieux | u05, u06 | Anh ở đâu (u05) ; numéros de rue et d'hẻm (u06). |
| u11 Se déplacer | u10 | Directions à partir des lieux et de trái/phải. |
| u12 Questions | u04, u07, u09, u10 | Synthèse des mots interrogatifs sur les thèmes vus : có… chưa (u04), métiers et lieux (u05/u10), khi nào (u09). |
| u13 Passé et futur | u08, u11, u12 | Đã/rồi/chưa/sẽ après les questions ; exemples de fruits et de moyens de transport. |
| u14 Goûts et opinions | u08, u12 | Thích, ngon/dở sur la nourriture et les fruits ; « vậy hả ? » après les questions. |
| u15 Téléphone | u05, u09 | Se présenter au téléphone, numéro, « đợi chút », heure d'un rappel. Remonté tôt pour le parcours travail. |
| u16 Santé | u10, u12 | Nhà thuốc, bệnh viện (lieux) ; questions du médecin. |
| u17 Logement | u08, u11, u12 | Loyer (prix), hẻm et lầu (adresses, trajet), questions au propriétaire. |
| u18 Travail | u13, u15 | Réunions et congés au passé/futur ; appels professionnels. |
| u19 Démarches | u17, u18 | Déclaration de résidence (logement), collègues et employeur (travail). |
| u20 Invitations | u04, u14, u18 | Đám giỗ/đám cưới (famille), accepter/refuser (goûts), « bận » (travail). |
| u21 Parler du Sud | u11, u14 | Registre familier et particules sur des énoncés déjà maîtrisés ; exemples de transport. |
| u22 Raconter le passé | u13, u20 | Hồi nhỏ, hồi đó : aspect (u13) et récits de fêtes et de famille (u20). |
| u23 Hypothèses | u19, u21, u22 | Nếu… thì… sur les démarches, la vie au quotidien et les récits. |
| u24 Donner son avis | u21, u23 | Theo tui, hơi/khá/lắm : nuances du parler du Sud et hypothèses. |

## Certificats

- **A0 Bén rễ** (bloc b1) : examen sur u01–u06. Le sous-graphe u01–u06 est fermé (aucune dépendance hors de lui).
- **A1 Mở lời** (bloc b3) : u01–u16, fermé.
- **A2 Trò chuyện** (bloc b5) : u01–u24.

## Prérequis de leçons

Les prérequis de leçons entre unités sont ignorés par le moteur (seuls ceux internes à une unité comptent).
Pour garder les fichiers lisibles, la première leçon de chaque unité (sauf u01) pointe vers l'épreuve d'**une**
de ses unités requises.

## Placement

Niveau 0 → u01, 1 → u03, 2 → u05, 3 → u07. Les unités antérieures sont « sautées » : u04 est sautée au
niveau 2, u04–u06 au niveau 3.

Vérifier après toute modification : `npm run content:validate`.
