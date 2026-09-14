# Audio et karaoké tonal

Référence : SPEC §7.1 (tons), §7.4 (audio), §8.3 (karaoké tonal), §15 Phase 2.

## Règle d'or : pas de TTS pour les tons

- Tout l'audio est **enregistré par des voix natives du Sud**. Le TTS n'est qu'un repli
  (`audio.source: "tts"`, marqueur discret dans l'app) et est **interdit** pour les exercices de tons
  (`tone_*`), `speak_repeat` et le karaoké tonal. Une voix `vi-VN` par défaut est souvent du Nord.
- La version lente est fabriquée par **time-stretch sans changement de hauteur**. Ne jamais ralentir
  en changeant `playbackRate` (sans `preservesPitch`) ni avec `asetrate` : le ton deviendrait faux.

---

## 1. Guide d'enregistrement (pour les voix)

### Voix

| Jeton | Voix (pack.json) | Profil |
|---|---|---|
| `mai` | `mai_hcm_f` | femme, Hô Chi Minh-Ville |
| `tuan` | `tuan_ct_m` | homme, Cần Thơ (delta) |

### Matériel et pièce

- Pièce **calme et meublée** (rideaux, canapé, livres) : pas de cuisine carrelée, pas de salle de bain.
  Couper ventilateur, climatisation, frigo si possible. Téléphone en mode avion.
- Micro à **15–20 cm** de la bouche, légèrement de côté (évite les « p » qui claquent), toujours à la même
  distance. Un filtre anti-pop si disponible.
- Régler le gain pour que les pics les plus forts restent vers **−12 à −6 dB** : jamais dans le rouge.

### Format

- **WAV, 48 kHz, 24 bits, mono.** (Le pipeline accepte d'autres fréquences mais le signale.)
- **Une seule prise par fichier** : garder la meilleure, supprimer les autres. Pas de fichier contenant
  plusieurs mots.
- Environ **0,5 s de silence** avant et après la parole (le pipeline rogne automatiquement à ~150 ms).
- Nom de fichier **exact** : `<id>_<voix>.wav`, par exemple `c_ma_mom_mai.wav`, `s_chao_anh_tuan.wav`.
  Le script d'enregistrement (ci-dessous) donne la liste des noms.

### Diction

- Débit **naturel** et accent du Sud habituel, comme on parle à un ami poli. Ne pas « articuler pour
  l'étranger » : la version lente est générée par le pipeline.
- Garder la même énergie d'un fichier à l'autre ; faire une pause et boire de l'eau régulièrement.
- Pour les tons (`ma, mà, má, mả, mạ`), prononcer chaque mot seul, sans intonation de liste
  (éviter de monter sur l'avant-dernier et de descendre sur le dernier).
- hỏi et ngã : les prononcer comme on le fait naturellement dans le Sud (ils se confondent, c'est voulu).

### Livrer

Déposer les wav dans `content/vi-south/audio/wav/` (ignoré par git : les sources sont lourdes)
ou sur le partage de l'équipe.

---

## 2. Pipeline (pour l'équipe)

Prérequis : `ffmpeg` et `ffprobe` dans le PATH (build avec `libopus` ; `rubberband` recommandé).

```bash
npm run audio:list                        # script d'enregistrement → scripts/audio/out/recording/<pack>/
npm run audio:process -- --dry-run        # ce qui serait fait
npm run audio:process                     # wav → content/vi-south/audio/*.opus|m4a + pitch/*.json
npm run audio:e2e                         # test de bout en bout sur signaux synthétiques (dossier temporaire)
```

`scripts/audio/out/` est une sortie générée : l'ajouter à `.gitignore`.

### `audio:list` — script d'enregistrement

Lit le pack (concepts, exemples avec audio, cartes culture avec `vi`, `pack.welcome`) et produit :

- `recording-list.csv` (UTF-8 BOM, s'ouvre dans Excel) : statut, voix, fichier, vietnamien, français, type, id ;
- `recording-list.html` imprimable, une section par voix, texte vietnamien en grand, case à cocher.

Le statut « enregistré » est déduit de la présence du wav dans `--in` (défaut `content/<pack>/audio/wav`).

### `audio:process` — traitement

Options : `--pack vi-south` (ou `none`), `--in <wav>`, `--out <racine du pack>`, `--dry-run`, `--force`,
`--pitch-all`, `--no-pitch`.

Pour chaque `<id>_<voix>.wav` :

1. **Rognage** des silences de bord (`silenceremove`, seuil −45 dB, ~150 ms conservés), mono.
2. **Loudness** : `loudnorm` en deux passes (mesure puis correction linéaire), cible **−16 LUFS**,
   true peak **−1,5 dBTP**, LRA 11.
3. **Exports** dans `audio/` : `<id>_<voix>.opus` (libopus **48 kbps** mono, 48 kHz) et `.m4a`
   (AAC 64 kbps, repli Safari ancien).
4. **Version lente** `<id>_<voix>_slow.{opus,m4a}` : tempo × 0,75 (durée × 1,33) par le filtre
   `rubberband` (préserve la hauteur) ; si le build ffmpeg ne l'a pas, `atempo` (WSOLA, préserve aussi
   la hauteur). Jamais `asetrate`.
5. **Courbe de référence** `pitch/<id>.json` pour les concepts qui ont un champ `pitch` ou qui sont
   utilisés par `speak_repeat` (chemin `pitchRef`), `tone_produce`, `tone_identify` ou
   `tone_minimal_pair` (`--pitch-all` : pour tous). Une seule voix par concept (celle de l'audio naturel
   du concept si présente) : la courbe étant normalisée par locuteur, elle vaut pour toutes les voix.

Idempotent : une sortie plus récente que son wav est sautée (`--force` pour tout refaire). Le rapport
affiche fréquence d'entrée, loudness mesurée, durées naturelle/lente et leur rapport, F0 médiane,
part voisée et nombre de syllabes détectées. Il signale les voix inconnues, les enregistrements
attendus manquants et les courbes sans wav source.

---

## 3. Courbes de hauteur et karaoké tonal

Module : `packages/core/src/pitch/` (TypeScript pur, sans DOM : navigateur, AudioWorklet, Node),
exporté par `@parlo/core` sous l'espace de noms `pitch`.

### Extraction

1. **YIN** (`analyzePitch`, `YinEstimator`) : fenêtre 40 ms, pas 10 ms, 70–500 Hz, seuil 0,12,
   interpolation parabolique. Le signal est d'abord décimé vers ~16 kHz (FIR).
2. **Nettoyage** (`cleanPitchTrack`) : voisement (confiance ≥ 0,7 et énergie ≥ max(−50 dBFS, −30 dB sous
   la trame la plus forte)), îlots voisés < 50 ms retirés, correction des sauts d'octave, micro-trous
   ≤ 20 ms comblés, médiane glissante sur 5 trames.
3. **Normalisation par locuteur** : demi-tons relatifs à la médiane de F0 de l'enregistrement. Un homme
   à 110 Hz et une femme à 220 Hz qui font la même mélodie obtiennent la même courbe (testé à 0,5 st près).

### Format `pitch/<id>.json`

```json
{"v":1,"hopMs":10,"st":[0.3,0.3,null,-0.5],"syllables":[{"start":0,"end":300,"tone":"huyen"}]}
```

- `st` : demi-tons arrondis à 0,1, `null` = non voisé ; silences de tête et de queue retirés.
- `syllables` (optionnel) : bornes en ms depuis la première trame et ton écrit. Obtenues en faisant
  correspondre les îlots voisés aux syllabes de `concept.vi` (les plus petits silences sont fusionnés
  s'il y a trop d'îlots ; absentes si la parole est trop liée pour être segmentée).
- Lecture par `parsePitchReference` (strict : clé inconnue ou valeur hors bornes = erreur).

### Comparaison et score (dans l'app, 100 % local)

1. Micro via `getUserMedia` → `AudioWorklet` → `StreamingPitchTracker` (blocs de 128 échantillons,
   une trame toutes les 10 ms) → `contourFromFrames` à la fin de la prise.
2. `scorePronunciation(courbeUtilisateur, référence)` : DTW (bande de Sakoe-Chiba 25 %) sur les trames
   voisées, recentrage borné à ±1,5 st, écart moyen *d* compté des deux côtés de l'alignement.
3. **Calibration** : *d* ≤ 0,25 st → 100, *d* ≥ 2,2 st → 0, linéaire entre les deux. Sur signaux
   synthétiques : même mélodie par une autre voix ≈ 97–100 ; chute deux fois trop faible ≈ 90 ;
   ton plat au lieu de descendant ≈ 55 ; montant au lieu de descendant ≈ 0. 20 prises bruitées de la
   même mélodie restent dans un écart < 10 points (critère Phase 2). **À recalibrer** sur les premiers
   enregistrements réels (`ScoreCalibration`).
4. **Indications par syllabe** (si la référence a des `syllables`) — contours du Sud :

| Ton | Forme attendue | Défauts détectés |
|---|---|---|
| ngang | plat, médium | `not_high_enough` |
| huyền | bas, descendant | `not_low_enough`, `too_flat` |
| sắc | montant | `not_high_enough`, `too_flat` |
| hỏi = ngã | creux puis remontée | `no_dip`, `not_low_enough` |
| nặng | bas, bref, descendant / glottal | `too_long`, `not_low_enough` |

`toneHint(issue, ton, syllabe, locale)` produit le message, par exemple « Ton descendant pas assez bas
sur « mà » ».
