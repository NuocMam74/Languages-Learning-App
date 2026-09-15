import { normalizeAnswer, type ContentIndex, type Localized } from "@parlo/core";

/**
 * Gloses des mots de Cô Mai : d'abord celles envoyées par le serveur
 * (événements `gloss`), sinon les concepts du pack local. Recherche par
 * groupes de syllabes (jusqu'à 4), le plus long d'abord.
 */

export type Glossary = ReadonlyMap<string, Localized>;

const MAX_SYLLABLES = 4;

export const glossKey = (vi: string) => normalizeAnswer(vi);

export function contentGlossary(content: ContentIndex): Map<string, Localized> {
  const map = new Map<string, Localized>();
  for (const concept of content.concepts.values()) {
    if (concept.type !== "word" && concept.type !== "structure") continue;
    const key = glossKey(concept.vi);
    if (key && key.split(" ").length <= MAX_SYLLABLES && !map.has(key)) map.set(key, concept.gloss);
  }
  return map;
}

export type Segment = { text: string; key: string | null };

/**
 * Découpe une phrase en segments : groupes glosés (key) et texte libre
 * (espaces et ponctuation conservés tels quels).
 */
export function segmentSentence(sentence: string, ...glossaries: Glossary[]): Segment[] {
  const parts = sentence.normalize("NFC").split(/(\s+)/);
  // split avec groupe capturant : indices pairs = mots, impairs = espaces.
  const isWord = parts.map((p, i) => i % 2 === 0 && p !== "");
  const out: Segment[] = [];
  let i = 0;
  const pushText = (text: string) => {
    const last = out[out.length - 1];
    if (last && last.key === null) last.text += text;
    else out.push({ text, key: null });
  };
  const find = (key: string) => glossaries.find((g) => g.has(key)) !== undefined;
  while (i < parts.length) {
    if (!isWord[i]) {
      pushText(parts[i]!);
      i++;
      continue;
    }
    let matched = 0;
    let matchedKey = "";
    for (let n = MAX_SYLLABLES; n >= 1 && !matched; n--) {
      const end = i + (n - 1) * 2;
      if (end >= parts.length) continue;
      const slice = parts.slice(i, end + 1).join("");
      const key = glossKey(slice);
      if (key && key.split(" ").length === n && find(key)) {
        matched = end + 1 - i;
        matchedKey = key;
      }
    }
    if (!matched) {
      pushText(parts[i]!);
      i++;
      continue;
    }
    // La ponctuation collée (« khỏe, ») reste hors du bouton.
    const raw = parts.slice(i, i + matched).join("");
    const lead = /^[\p{P}\p{S}]*/u.exec(raw)![0];
    const trail = /[\p{P}\p{S}]*$/u.exec(raw)![0];
    if (lead) pushText(lead);
    out.push({ text: raw.slice(lead.length, raw.length - trail.length), key: matchedKey });
    if (trail) pushText(trail);
    i += matched;
  }
  return out;
}

export function lookupGloss(key: string, ...glossaries: Glossary[]): Localized | null {
  for (const g of glossaries) {
    const hit = g.get(key);
    if (hit) return hit;
  }
  return null;
}
