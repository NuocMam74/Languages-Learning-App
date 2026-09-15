/**
 * Saisie Telex (spec §8.4) pour les champs vietnamiens du studio.
 *
 *   aa → â · ee → ê · oo → ô · aw → ă · ow → ơ · uw → ư · uow → ươ · w → ư · dd → đ
 *   s sắc · f huyền · r hỏi · x ngã · j nặng · z retire le ton
 *
 * Saisie « libre » comme Unikey : la touche de modification s'applique à la voyelle
 * concernée où qu'elle soit dans le mot (`tieengs` et `tiesng` → `tiếng`). Taper deux fois
 * la même touche annule la transformation et écrit la lettre (`ass` → `as`).
 * Placement du ton (style courant du contenu : `hòa`, `khỏe`) :
 *   voyelle modifiée (â ê ô ơ ă ư ; ơ pour ươ) > syllabe fermée : dernière voyelle >
 *   deux voyelles finales : la première > trois voyelles : celle du milieu.
 */

import type { Tone } from "@parlo/core";

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
const TONE_KEYS: Record<string, Tone | "none"> = { s: "sac", f: "huyen", r: "hoi", x: "nga", j: "nang", z: "none" };
const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

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
export function toneIndex(glyphs: readonly Glyph[]): number {
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

/**
 * Applique une touche Telex à la fin d'un mot déjà converti.
 * Retourne le nouveau mot, ou null si la touche n'est pas une commande ici (lettre ordinaire).
 */
export function applyTelexKey(word: string, key: string): string | null {
  const command = telexCommand(word, key);
  if (command !== null) return command;
  // Lettre ordinaire : le ton déjà posé se replace (« hòa » + n → « hoàn »).
  const appended = parse(word + key);
  const tone = currentTone(appended);
  if (!tone) return null;
  const moved = compose(withTone(appended, tone));
  return moved === (word + key).normalize("NFC") ? null : moved;
}

function telexCommand(word: string, key: string): string | null {
  const k = key.toLowerCase();
  if (key.length !== 1 || (word.length === 0 && k !== "w")) return null;
  const upperKey = key !== k;
  const glyphs = parse(word);

  const toneKey = TONE_KEYS[k];
  if (toneKey) {
    if (!glyphs.some(isVowel)) return null;
    const tone = currentTone(glyphs);
    if (toneKey === "none") return tone ? compose(withTone(glyphs, null)) : null;
    // Même touche deux fois : on annule le ton et on écrit la lettre.
    if (tone === toneKey) return compose(withTone(glyphs, null)) + key;
    return compose(withTone(glyphs, toneKey));
  }

  if (k === "a" || k === "e" || k === "o") {
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const g = glyphs[i];
      if (!g || g.base !== k) continue;
      const tone = currentTone(glyphs);
      if (g.mod === "") {
        g.mod = "circ";
        return compose(withTone(glyphs, tone));
      }
      if (g.mod === "circ") {
        g.mod = "";
        return compose(withTone(glyphs, tone)) + key;
      }
      return null;
    }
    return null;
  }

  if (k === "w") {
    const tone = currentTone(glyphs);
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const g = glyphs[i];
      if (!g || !["a", "o", "u"].includes(g.base)) continue;
      const prev = glyphs[i - 1];
      const pairUo = g.base === "o" && prev?.base === "u";
      const target: Mod = g.base === "a" ? "breve" : "horn";
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
      break;
    }
    return compose(glyphs) + (upperKey ? "Ư" : "ư");
  }

  if (k === "d") {
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const g = glyphs[i];
      if (!g || g.base !== "d") continue;
      if (g.mod === "") {
        g.mod = "stroke";
        return compose(glyphs);
      }
      if (g.mod === "stroke") {
        g.mod = "";
        return compose(glyphs) + key;
      }
    }
    return null;
  }
  return null;
}

const LETTER = /[\p{L}\p{M}]/u;

/** Convertit un texte tapé en Telex, caractère par caractère (tests, collage). */
export function telexToVietnamese(text: string): string {
  let out = "";
  let word = "";
  for (const ch of text) {
    if (LETTER.test(ch)) {
      const next = applyTelexKey(word, ch);
      word = next ?? word + ch;
    } else {
      out += word + ch;
      word = "";
    }
  }
  return (out + word).normalize("NFC");
}

/**
 * Saisie en direct : `previous` → `typed` après insertion d'un caractère à `caret` (position après la frappe).
 * Retourne le texte converti et la nouvelle position du curseur, ou null si rien à convertir.
 */
export function telexInput(previous: string, typed: string, caret: number): { value: string; caret: number } | null {
  if (typed.length !== previous.length + 1 || caret < 1) return null;
  const key = typed[caret - 1] ?? "";
  if (typed.slice(0, caret - 1) + typed.slice(caret) !== previous || !LETTER.test(key)) return null;
  const before = typed.slice(0, caret - 1);
  let start = before.length;
  while (start > 0 && LETTER.test(before[start - 1] ?? "")) start--;
  const word = before.slice(start);
  const converted = applyTelexKey(word, key);
  if (converted === null) return null;
  const head = before.slice(0, start) + converted;
  return { value: (head + typed.slice(caret)).normalize("NFC"), caret: head.normalize("NFC").length };
}
