/**
 * Garde du Sud : repère dans un texte vietnamien les formes lexicales du Nord
 * déclarées dans `lexical-variants.json`.
 *
 * Correspondance par syllabes entières (jamais de sous-chaîne : « bố » ne
 * matche pas « bốn »), insensible à la casse, sur texte normalisé NFC.
 * Une occurrence couverte par une expression d'exception (« công bố ») est ignorée.
 *
 * L'implémentation Python de l'API (apps/api/app/south_lint.py) doit passer
 * les mêmes cas : cases.json.
 */

export type Severity = "error" | "warning" | "none";

export interface LexicalVariantEntry {
  id: string;
  south: readonly string[];
  north: readonly string[];
  severity: Severity;
  exceptions?: readonly string[];
}

export interface SouthLintFinding {
  entryId: string;
  /** Forme telle qu'elle apparaît dans le texte (NFC). */
  found: string;
  suggestions: readonly string[];
  severity: Exclude<Severity, "none">;
  /** Décalages en unités UTF-16 dans la version NFC du texte. */
  start: number;
  end: number;
}

interface Syllable {
  text: string;
  start: number;
  end: number;
}

interface CompiledPattern {
  entry: LexicalVariantEntry;
  north: readonly string[];
  exceptions: readonly (readonly string[])[];
}

const SYLLABLE = /[\p{L}\p{M}]+/gu;

export function tokenize(text: string): Syllable[] {
  const nfc = text.normalize("NFC");
  const out: Syllable[] = [];
  for (const m of nfc.matchAll(SYLLABLE)) {
    out.push({ text: m[0].toLocaleLowerCase("vi"), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function splitPhrase(phrase: string): string[] {
  return tokenize(phrase).map((s) => s.text);
}

function matchesAt(syllables: readonly Syllable[], at: number, pattern: readonly string[]): boolean {
  if (at < 0 || at + pattern.length > syllables.length) return false;
  return pattern.every((p, i) => syllables[at + i]?.text === p);
}

/** Vrai si la plage [at, at+len) est entièrement couverte par une occurrence d'exception. */
function coveredByException(
  syllables: readonly Syllable[],
  at: number,
  len: number,
  exceptions: readonly (readonly string[])[],
): boolean {
  for (const exc of exceptions) {
    for (let excStart = at + len - exc.length; excStart <= at; excStart++) {
      if (matchesAt(syllables, excStart, exc)) return true;
    }
  }
  return false;
}

export function createSouthLinter(entries: readonly LexicalVariantEntry[]) {
  const patterns: CompiledPattern[] = [];
  for (const entry of entries) {
    if (entry.severity === "none") continue;
    const southForms = new Set(entry.south.map((s) => splitPhrase(s).join(" ")));
    const exceptions = (entry.exceptions ?? []).map(splitPhrase).filter((e) => e.length > 0);
    for (const north of entry.north) {
      const tokens = splitPhrase(north);
      // Forme identique au Nord et au Sud : rien à signaler.
      if (tokens.length === 0 || southForms.has(tokens.join(" "))) continue;
      patterns.push({ entry, north: tokens, exceptions });
    }
  }

  return function lint(text: string): SouthLintFinding[] {
    const syllables = tokenize(text);
    const nfc = text.normalize("NFC");
    const findings: SouthLintFinding[] = [];
    for (let i = 0; i < syllables.length; i++) {
      for (const p of patterns) {
        if (!matchesAt(syllables, i, p.north)) continue;
        if (coveredByException(syllables, i, p.north.length, p.exceptions)) continue;
        const first = syllables[i];
        const last = syllables[i + p.north.length - 1];
        if (!first || !last) continue;
        findings.push({
          entryId: p.entry.id,
          found: nfc.slice(first.start, last.end),
          suggestions: p.entry.south,
          severity: p.entry.severity === "error" ? "error" : "warning",
          start: first.start,
          end: last.end,
        });
      }
    }
    return findings;
  };
}

export function hasBlocking(findings: readonly SouthLintFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
