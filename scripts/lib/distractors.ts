/**
 * Choix des leurres, partagé par `derive-practice.ts` et `fix-exposure.ts` (contrat phase26 §4).
 *
 * Un leurre est **un mot déjà appris** : choisir parmi des mots inconnus, c'est deviner. Seule
 * exception, les variantes tonales de la bonne réponse (ma / má / mà) — les entendre est le but de
 * l'exercice, on n'a pas à savoir ce qu'elles veulent dire.
 */
import { heardClassOf, normalizeAnswer, shuffle, stripTones, syllables, toneOf, type Concept, type Tone } from "@parlo/core";

export type HeardClasses = readonly (readonly Tone[])[] | undefined;

/** Ce que l'oreille distingue (cf. games/cho-noi.ts) : base sans tons + classe auditive par syllabe. */
export function heardKey(text: string, heardClasses: HeardClasses): string {
  const parts = syllables(text);
  if (!heardClasses || heardClasses.length === 0) return parts.map((s) => stripTones(s)).join(" ");
  return parts.map((s) => `${stripTones(s)}:${heardClassOf(toneOf(s), heardClasses)}`).join(" ");
}

export const toneless = (text: string) => stripTones(normalizeAnswer(text));

export interface DistractorPools {
  /** Concepts déjà appris à ce point du cursus (ceux du niveau compris). */
  known: readonly Concept[];
  /** Tout le pack : on n'y puise que les variantes tonales de la réponse. */
  all: readonly Concept[];
}

/**
 * Distracteurs textuels, du plus utile au plus lointain :
 *   1. voisin tonal (même base sans tons), pris dans tout le pack — le vrai piège d'une langue à tons ;
 *   2. mot appris de même nature et de même nombre de syllabes ;
 *   3. mot appris de même nature ;
 *   4. n'importe quel autre mot appris de même nombre de syllabes.
 * Jamais deux formes que l'oreille du parler confondrait, jamais la réponse elle-même, jamais une
 * forme de `exclude` (options déjà gardées).
 */
export function pickDistractors(
  target: { id?: string; vi: string; type?: Concept["type"] },
  pools: DistractorPools,
  max: number,
  classes: HeardClasses,
  rand: () => number,
  exclude: readonly string[] = [],
): string[] {
  const base = toneless(target.vi);
  const size = syllables(target.vi).length;
  const known = pools.known.filter((c) => c.id !== target.id);
  const tiers = [
    pools.all.filter((c) => c.id !== target.id && toneless(c.vi) === base),
    known.filter((c) => toneless(c.vi) !== base && c.type === target.type && syllables(c.vi).length === size),
    known.filter((c) => toneless(c.vi) !== base && c.type === target.type && syllables(c.vi).length !== size),
    known.filter((c) => toneless(c.vi) !== base && c.type !== target.type && syllables(c.vi).length === size),
  ];
  const keys = new Set([heardKey(target.vi, classes), ...exclude.map((e) => heardKey(e, classes))]);
  const forms = new Set([normalizeAnswer(target.vi), ...exclude.map(normalizeAnswer)]);
  const out: string[] = [];
  for (const tier of tiers) {
    // Tirage mélangé, mais déterministe : sans ça, l'ordre fixe des candidats ramène les deux mêmes
    // leurres à chaque question du niveau, et l'exercice se résout sans écouter.
    for (const c of shuffle(tier, rand)) {
      if (out.length >= max) return out;
      const key = heardKey(c.vi, classes);
      if (keys.has(key) || forms.has(normalizeAnswer(c.vi))) continue;
      keys.add(key);
      forms.add(normalizeAnswer(c.vi));
      out.push(c.vi);
    }
  }
  return out;
}

/** Concepts appris à images distinctes, de même nature : de quoi bâtir un choix d'images. */
export function pickImageMates(target: Concept, known: readonly Concept[], max: number, rand: () => number, keep: readonly Concept[] = []): Concept[] {
  const images = new Set([target.image, ...keep.map((c) => c.image)]);
  const forms = new Set([normalizeAnswer(target.vi), ...keep.map((c) => normalizeAnswer(c.vi))]);
  const out: Concept[] = [];
  for (const c of shuffle(known, rand)) {
    if (out.length >= max) break;
    if (c.id === target.id || !c.image || c.type !== target.type) continue;
    if (images.has(c.image) || forms.has(normalizeAnswer(c.vi))) continue;
    images.add(c.image);
    forms.add(normalizeAnswer(c.vi));
    out.push(c);
  }
  return out;
}
