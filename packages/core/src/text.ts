import type { Tone } from "./types.ts";

/**
 * Texte vietnamien : normalisation, tons, comparaison tolérante des réponses.
 *
 * Marques de ton (combinantes, après décomposition NFD) :
 *   U+0300 huyền · U+0301 sắc · U+0309 hỏi · U+0303 ngã · U+0323 nặng
 * Les autres diacritiques (â ê ô ơ ư ă đ) changent la voyelle, pas le ton.
 */

const TONE_MARKS: Readonly<Record<string, Tone>> = {
  "\u0300": "huyen",
  "\u0301": "sac",
  "\u0309": "hoi",
  "\u0303": "nga",
  "\u0323": "nang",
};

const TONE_MARK_RE = /[\u0300\u0301\u0309\u0303\u0323]/g;
const ALL_MARKS_RE = /\p{M}/gu;
const PUNCTUATION_RE = /[\p{P}\p{S}]/gu;

export function nfc(text: string): string {
  return text.normalize("NFC");
}

/** Forme de comparaison : NFC, minuscules, sans ponctuation, espaces réduits. Les diacritiques restent. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(PUNCTUATION_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Retire uniquement les marques de ton (garde â, ơ, đ…). */
export function stripTones(text: string): string {
  return text.normalize("NFD").replace(TONE_MARK_RE, "").normalize("NFC");
}

/** Retire tous les diacritiques, y compris đ → d. */
export function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(ALL_MARKS_RE, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

/** Ton écrit d'une syllabe (ngang si aucune marque). */
export function toneOf(syllable: string): Tone {
  for (const ch of syllable.normalize("NFD")) {
    const tone = TONE_MARKS[ch];
    if (tone) return tone;
  }
  return "ngang";
}

export function syllables(text: string): string[] {
  return normalizeAnswer(text).split(" ").filter(Boolean);
}

/**
 * Classe auditive d'un ton selon le système du pack : au Sud, hỏi et ngã
 * partagent la même classe. Retourne l'index de la classe, ou -1.
 */
export function heardClassOf(tone: Tone, heardClasses: readonly (readonly Tone[])[]): number {
  return heardClasses.findIndex((cls) => cls.includes(tone));
}

/** Deux syllabes sont-elles une paire minimale tonale (même base, tons différents) ? */
export function isToneMinimalPair(a: string, b: string): boolean {
  const na = normalizeAnswer(a);
  const nb = normalizeAnswer(b);
  return na !== nb && stripTones(na) === stripTones(nb);
}

export type AnswerMatch =
  /** Réponse exacte (après normalisation). */
  | { kind: "correct" }
  /** Tout est juste sauf un ou plusieurs tons. `syllables` = positions fautives. */
  | { kind: "tone_only"; expected: string; positions: number[] }
  /** Lettres justes mais autres diacritiques faux (â/a, ơ/o, đ/d…). */
  | { kind: "diacritics_only"; expected: string }
  | { kind: "wrong"; expected: string };

/**
 * Compare une réponse saisie à une ou plusieurs formes acceptées.
 * Les diacritiques comptent, mais une erreur de ton seule est signalée à part
 * (« presque : c'est má, pas mà »).
 */
export function compareAnswer(given: string, accepted: readonly string[]): AnswerMatch {
  const g = normalizeAnswer(given);
  const forms = accepted.map(normalizeAnswer);
  const first = accepted[0] ?? "";
  if (forms.includes(g)) return { kind: "correct" };

  for (const [i, form] of forms.entries()) {
    if (stripTones(form) === stripTones(g)) {
      const fs = form.split(" ");
      const gs = g.split(" ");
      const positions = fs.flatMap((s, idx) => (s !== gs[idx] ? [idx] : []));
      return { kind: "tone_only", expected: accepted[i] ?? first, positions };
    }
  }
  for (const [i, form] of forms.entries()) {
    if (stripDiacritics(form) === stripDiacritics(g)) {
      return { kind: "diacritics_only", expected: accepted[i] ?? first };
    }
  }
  return { kind: "wrong", expected: first };
}
