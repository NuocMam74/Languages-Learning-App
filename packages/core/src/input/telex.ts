/**
 * Clavier vietnamien intégré (spec §8.4) — implémentation de référence.
 *
 * Telex : `aa → â` · `ee → ê` · `oo → ô` · `aw → ă` · `ow → ơ` · `uw → ư` · `uow → ươ` · `w → ư` · `dd → đ`
 *         `s` sắc · `f` huyền · `r` hỏi · `x` ngã · `j` nặng · `z` retire le ton
 * VNI  : `1` sắc · `2` huyền · `3` hỏi · `4` ngã · `5` nặng · `0` retire le ton
 *         `6` â/ê/ô · `7` ơ/ư (et `uo7 → ươ`) · `8` ă · `9` đ
 *
 * Saisie « libre » comme Unikey : la touche de modification s'applique à la voyelle concernée où
 * qu'elle soit dans le mot (`tieengs` et `tiesng` → `tiếng`). Taper deux fois la même touche annule
 * la transformation et écrit la touche (`ass` → `as`, `ma11` → `ma1`). Sortie toujours en NFC.
 *
 * Placement du ton (style du contenu : `hòa`, `khỏe`) : voyelle modifiée (â ê ô ơ ă ư ; ơ pour ươ) >
 * syllabe fermée : dernière voyelle > deux voyelles finales : la première > trois voyelles : celle du milieu.
 *
 * Le studio (apps/web/src/studio/telex.ts) a sa propre copie historique : ce module est la référence,
 * même comportement Telex, plus le VNI et la barre de diacritiques.
 */

import type { Tone } from "../types.ts";

export type InputMethod = "telex" | "vni";

type Mod = "" | "circ" | "breve" | "horn" | "stroke";

interface Glyph {
  base: string;
  upper: boolean;
  mod: Mod;
  tone: Tone | null;
}

const c = (code: number) => String.fromCharCode(code);
const TONE_MARK: Record<Exclude<Tone, "ngang">, string> = { huyen: c(0x300), sac: c(0x301), hoi: c(0x309), nga: c(0x303), nang: c(0x323) };
const MARK_TONE: Record<string, Tone> = Object.fromEntries(Object.entries(TONE_MARK).map(([tone, mark]) => [mark, tone as Tone]));
const MOD_MARK: Record<"circ" | "breve" | "horn", string> = { circ: c(0x302), breve: c(0x306), horn: c(0x31b) };
const MARK_MOD: Record<string, Mod> = Object.fromEntries(Object.entries(MOD_MARK).map(([mod, mark]) => [mark, mod as Mod]));
const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

/** Touches de ton par méthode ; « none » retire le ton posé. */
const TONE_KEYS: Record<InputMethod, Record<string, Tone | "none">> = {
  telex: { s: "sac", f: "huyen", r: "hoi", x: "nga", j: "nang", z: "none" },
  vni: { "1": "sac", "2": "huyen", "3": "hoi", "4": "nga", "5": "nang", "0": "none" },
};

/** Touches de modification de voyelle par méthode : bases visées + marque posée. */
interface ModKey {
  bases: readonly string[];
  mod: Exclude<Mod, "" | "stroke">;
  /** `uo` + touche → `ươ` (la corne se pose aussi sur le `u`). */
  pairUo?: boolean;
  /** Caractère écrit quand aucune base n'est trouvée (Telex : `w` seul donne `ư`). */
  fallback?: string;
}

const MOD_KEYS: Record<InputMethod, Record<string, ModKey>> = {
  telex: {
    a: { bases: ["a"], mod: "circ" },
    e: { bases: ["e"], mod: "circ" },
    o: { bases: ["o"], mod: "circ" },
    w: { bases: ["a", "o", "u"], mod: "horn", pairUo: true, fallback: "ư" },
  },
  vni: {
    "6": { bases: ["a", "e", "o"], mod: "circ" },
    "7": { bases: ["o", "u"], mod: "horn", pairUo: true },
    "8": { bases: ["a"], mod: "breve" },
  },
};

const STROKE_KEYS: Record<InputMethod, string> = { telex: "d", vni: "9" };

// ---------------------------------------------------------------------------
// Décomposition / recomposition

function parse(word: string): Glyph[] {
  const out: Glyph[] = [];
  for (const ch of word.normalize("NFC")) {
    const decomposed = ch.normalize("NFD");
    const letter = decomposed[0] ?? ch;
    const glyph: Glyph = { base: letter.toLowerCase(), upper: letter !== letter.toLowerCase(), mod: "", tone: null };
    if (glyph.base === "đ") {
      glyph.base = "d";
      glyph.mod = "stroke";
    }
    for (const mark of decomposed.slice(1)) {
      if (MARK_MOD[mark]) glyph.mod = MARK_MOD[mark];
      else if (MARK_TONE[mark]) glyph.tone = MARK_TONE[mark];
    }
    out.push(glyph);
  }
  return out;
}

function compose(glyphs: readonly Glyph[]): string {
  return glyphs
    .map((g) => {
      let s = g.mod === "stroke" ? "đ" : g.base;
      if (g.mod === "circ" || g.mod === "breve" || g.mod === "horn") s += MOD_MARK[g.mod];
      if (g.tone && g.tone !== "ngang") s += TONE_MARK[g.tone];
      s = s.normalize("NFC");
      return g.upper ? s.toUpperCase() : s;
    })
    .join("");
}

const isVowel = (g: Glyph | undefined) => !!g && VOWELS.has(g.base) && g.mod !== "stroke";

/** Index de la voyelle qui porte le ton, -1 s'il n'y a pas de voyelle. */
function toneIndex(glyphs: readonly Glyph[]): number {
  // Dernier groupe de voyelles contigu.
  let end = -1;
  for (let i = glyphs.length - 1; i >= 0; i--) {
    if (isVowel(glyphs[i])) {
      end = i;
      break;
    }
  }
  if (end < 0) return -1;
  let start = end;
  while (start > 0 && isVowel(glyphs[start - 1])) start--;
  let cluster: number[] = [];
  for (let i = start; i <= end; i++) cluster.push(i);
  // « qu » et « gi » + voyelle : u et i font partie de la consonne.
  const first = cluster[0] ?? -1;
  const before = glyphs[first - 1];
  if (cluster.length > 1 && before && ((before.base === "q" && glyphs[first]?.base === "u") || (before.base === "g" && glyphs[first]?.base === "i"))) {
    cluster = cluster.slice(1);
  }
  const modded = cluster.filter((i) => {
    const m = glyphs[i]?.mod;
    return m === "circ" || m === "breve" || m === "horn";
  });
  if (modded.length > 0) return modded[modded.length - 1] ?? -1;
  if (cluster.length === 1) return cluster[0] ?? -1;
  const closed = end < glyphs.length - 1;
  if (closed) return cluster[cluster.length - 1] ?? -1;
  if (cluster.length === 2) return cluster[0] ?? -1;
  return cluster[1] ?? -1;
}

function currentTone(glyphs: readonly Glyph[]): Tone | null {
  return glyphs.find((g) => g.tone)?.tone ?? null;
}

function withTone(glyphs: Glyph[], tone: Tone | null): Glyph[] {
  const cleared: Glyph[] = glyphs.map((g) => ({ ...g, tone: null }));
  if (!tone) return cleared;
  const at = toneIndex(cleared);
  const target = cleared[at];
  if (target) target.tone = tone;
  return cleared;
}

// ---------------------------------------------------------------------------
// Application d'une touche

/**
 * Applique une touche à la fin d'un mot déjà converti.
 * Retourne le nouveau mot, ou null si la touche n'est pas une commande ici (lettre ordinaire).
 */
export function applyTelexKey(word: string, key: string, method: InputMethod = "telex"): string | null {
  const command = keyCommand(word, key, method);
  if (command !== null) return command;
  // Lettre ordinaire : le ton déjà posé se replace (« hòa » + n → « hoàn »).
  const appended = parse(word + key);
  const tone = currentTone(appended);
  if (!tone) return null;
  const moved = compose(withTone(appended, tone));
  return moved === (word + key).normalize("NFC") ? null : moved;
}

function keyCommand(word: string, key: string, method: InputMethod): string | null {
  const k = key.toLowerCase();
  if (key.length !== 1) return null;
  // Rien à modifier sur un mot vide, sauf le `w` Telex qui écrit « ư » directement.
  if (word.length === 0 && !(method === "telex" && k === "w")) return null;
  const glyphs = parse(word);

  const toneKey = TONE_KEYS[method][k];
  if (toneKey) return applyToneKey(glyphs, toneKey, key);

  const modKey = MOD_KEYS[method][k];
  if (modKey) return applyModKey(glyphs, modKey, key);

  if (k === STROKE_KEYS[method]) return applyStroke(glyphs, key, method);
  return null;
}

function applyToneKey(glyphs: Glyph[], toneKey: Tone | "none", key: string): string | null {
  if (!glyphs.some(isVowel)) return null;
  const tone = currentTone(glyphs);
  if (toneKey === "none") return tone ? compose(withTone(glyphs, null)) : null;
  // Même touche deux fois : on annule le ton et on écrit la touche.
  if (tone === toneKey) return compose(withTone(glyphs, null)) + key;
  return compose(withTone(glyphs, toneKey));
}

function applyModKey(glyphs: Glyph[], spec: ModKey, key: string): string | null {
  const tone = currentTone(glyphs);
  const fallback = () => (spec.fallback === undefined ? null : compose(glyphs) + (key === key.toLowerCase() ? spec.fallback : spec.fallback.toUpperCase()));
  for (let i = glyphs.length - 1; i >= 0; i--) {
    const g = glyphs[i];
    if (!g || !spec.bases.includes(g.base)) continue;
    // « ă » et « ơ/ư » partagent la touche `w` / des touches VNI distinctes : la marque dépend de la base.
    const target: Exclude<Mod, "" | "stroke"> = spec.mod === "horn" && g.base === "a" ? "breve" : spec.mod;
    const prev = glyphs[i - 1];
    const pairUo = spec.pairUo === true && g.base === "o" && prev?.base === "u";
    if (g.mod === "") {
      g.mod = target;
      if (pairUo && prev && prev.mod === "") prev.mod = "horn";
      return compose(withTone(glyphs, tone));
    }
    if (g.mod === target) {
      g.mod = "";
      if (pairUo && prev && prev.mod === "horn") prev.mod = "";
      return compose(withTone(glyphs, tone)) + key;
    }
    return fallback();
  }
  return fallback();
}

function applyStroke(glyphs: Glyph[], key: string, method: InputMethod): string | null {
  for (let i = glyphs.length - 1; i >= 0; i--) {
    const g = glyphs[i];
    if (!g || g.base !== "d") continue;
    if (g.mod === "") {
      g.mod = "stroke";
      return compose(glyphs);
    }
    if (g.mod === "stroke") {
      g.mod = "";
      // En VNI le `9` n'est pas une lettre : on ne réécrit pas la touche.
      return compose(glyphs) + (method === "telex" ? key : "");
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Conversions

const LETTER = /[\p{L}\p{M}]/u;
const TYPED = /[\p{L}\p{M}\p{Nd}]/u;

const isTypedChar = (ch: string, method: InputMethod) => (method === "vni" ? TYPED.test(ch) : LETTER.test(ch));

/** Convertit un texte tapé, caractère par caractère (tests, collage, contenu du studio). */
export function telexToVietnamese(text: string, method: InputMethod = "telex"): string {
  let out = "";
  let word = "";
  for (const ch of text) {
    if (isTypedChar(ch, method)) {
      const next = applyTelexKey(word, ch, method);
      word = next ?? word + ch;
    } else {
      out += word + ch;
      word = "";
    }
  }
  return (out + word).normalize("NFC");
}

/**
 * Saisie en direct : `previous` → `typed` après insertion d'un caractère à `caret` (position après
 * la frappe). Retourne le texte converti et la nouvelle position du curseur, ou null si rien à convertir.
 */
export function telexInput(previous: string, typed: string, caret: number, method: InputMethod = "telex"): { value: string; caret: number } | null {
  if (typed.length !== previous.length + 1 || caret < 1) return null;
  const key = typed[caret - 1] ?? "";
  if (typed.slice(0, caret - 1) + typed.slice(caret) !== previous || !isTypedChar(key, method)) return null;
  const before = typed.slice(0, caret - 1);
  let start = before.length;
  while (start > 0 && isTypedChar(before[start - 1] ?? "", method)) start--;
  const word = before.slice(start);
  const converted = applyTelexKey(word, key, method);
  if (converted === null) return null;
  const head = before.slice(0, start) + converted;
  return { value: (head + typed.slice(caret)).normalize("NFC"), caret: head.normalize("NFC").length };
}

// ---------------------------------------------------------------------------
// Barre de diacritiques (secours tactile)

export interface DiacriticKey {
  id: string;
  /** Caractère affiché sur la touche (le ton est montré sur un cercle pointillé : ◌́). */
  label: string;
  kind: "vowel" | "tone" | "consonant";
  tone?: Tone;
  /** Touche équivalente au clavier. */
  telex: string;
  vni: string;
  /**
   * Mot obtenu si la touche est appliquée au mot en cours de saisie ; null = sans effet ici
   * (l'interface grise alors la touche).
   */
  preview: string | null;
}

const DOTTED = c(0x25cc);

const BAR: readonly Omit<DiacriticKey, "preview">[] = [
  { id: "circ_a", label: "â", kind: "vowel", telex: "a", vni: "6" },
  { id: "circ_e", label: "ê", kind: "vowel", telex: "e", vni: "6" },
  { id: "circ_o", label: "ô", kind: "vowel", telex: "o", vni: "6" },
  { id: "breve_a", label: "ă", kind: "vowel", telex: "w", vni: "8" },
  { id: "horn_o", label: "ơ", kind: "vowel", telex: "w", vni: "7" },
  { id: "horn_u", label: "ư", kind: "vowel", telex: "w", vni: "7" },
  { id: "stroke_d", label: "đ", kind: "consonant", telex: "d", vni: "9" },
  { id: "tone_sac", label: `${DOTTED}${TONE_MARK.sac}`, kind: "tone", tone: "sac", telex: "s", vni: "1" },
  { id: "tone_huyen", label: `${DOTTED}${TONE_MARK.huyen}`, kind: "tone", tone: "huyen", telex: "f", vni: "2" },
  { id: "tone_hoi", label: `${DOTTED}${TONE_MARK.hoi}`, kind: "tone", tone: "hoi", telex: "r", vni: "3" },
  { id: "tone_nga", label: `${DOTTED}${TONE_MARK.nga}`, kind: "tone", tone: "nga", telex: "x", vni: "4" },
  { id: "tone_nang", label: `${DOTTED}${TONE_MARK.nang}`, kind: "tone", tone: "nang", telex: "j", vni: "5" },
  { id: "tone_none", label: DOTTED, kind: "tone", telex: "z", vni: "0" },
];

/**
 * Touches de la barre de diacritiques, avec l'aperçu du mot obtenu pour chacune (spec §8.4).
 * `word` = mot en cours de saisie (le dernier mot du champ) ; vide = barre sans aperçu.
 */
export function describeDiacritics(word = ""): DiacriticKey[] {
  return BAR.map((key) => {
    const applied = applyDiacritic(word, key.id);
    return { ...key, preview: applied === word.normalize("NFC") ? null : applied };
  });
}

/**
 * Applique une touche de la barre à un mot (même résultat que la frappe correspondante).
 * Retourne le mot inchangé (NFC) si la touche n'a pas d'effet, ou pour un identifiant inconnu.
 */
export function applyDiacritic(word: string, keyId: string): string {
  const key = BAR.find((k) => k.id === keyId);
  const current = word.normalize("NFC");
  if (!key) return current;
  // La barre pose la marque, elle n'annule jamais par double frappe : on part du mot « nu ».
  const glyphs = parse(current);
  if (key.kind === "tone") {
    if (!glyphs.some(isVowel)) return current;
    return compose(withTone(glyphs, key.tone ?? null));
  }
  if (key.kind === "consonant") {
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const g = glyphs[i];
      if (!g || g.base !== "d") continue;
      if (g.mod === "stroke") return current;
      g.mod = "stroke";
      return compose(glyphs);
    }
    return current;
  }
  const base = key.id.slice(key.id.indexOf("_") + 1);
  const mod: Exclude<Mod, "" | "stroke"> = key.id.startsWith("circ") ? "circ" : key.id.startsWith("breve") ? "breve" : "horn";
  const tone = currentTone(glyphs);
  for (let i = glyphs.length - 1; i >= 0; i--) {
    const g = glyphs[i];
    if (!g || g.base !== base || g.mod === "stroke") continue;
    if (g.mod === mod) return current;
    g.mod = mod;
    const prev = glyphs[i - 1];
    if (mod === "horn" && base === "o" && prev?.base === "u" && prev.mod === "") prev.mod = "horn";
    return compose(withTone(glyphs, tone));
  }
  return current;
}
