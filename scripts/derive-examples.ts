/**
 * Phrases d'exemple dérivées du corpus (contrat phase12 §1).
 *
 * Un concept sans phrase d'exemple prive l'apprenant de beaucoup : la fiche de découverte n'a rien
 * à montrer, et les formats de révision `fill_gap` et `build_sentence` ne peuvent pas se construire
 * (`packages/core/src/review.ts`). Avant ce script, 21 concepts sur 713 avaient un exemple — les
 * deux formats riches étaient donc quasi théoriques.
 *
 * Ce script **n'invente aucune phrase**. Il ne fait que rattacher à un concept une phrase déjà
 * écrite ailleurs dans le pack, avec sa traduction :
 *
 *   - les cibles des étapes `build_sentence` (« Tôi tên là Lan. ») ;
 *   - les phrases à trou `fill_gap`, une fois le trou rempli par sa réponse ;
 *   - les questions de `speak_answer` ;
 *   - les phrases de `translate_to_vi` et `translate_to_fr` ;
 *   - les répliques des dialogues.
 *
 * Donc : rien de nouveau à faire relire — ces phrases sont déjà dans le corpus, au même état de
 * relecture (`reviewed: false` partout aujourd'hui), et elles passent déjà la garde du Sud.
 *
 * Règles de choix, dans cet ordre :
 *   1. la phrase contient la forme du concept comme **suite de mots entière** (le vietnamien
 *      s'écrit en syllabes séparées : une comparaison de sous-chaîne attraperait « ba » dans
 *      « bàn ») ;
 *   2. elle ne se réduit pas au concept lui-même (« má » n'illustre pas « má ») ;
 *   3. on préfère une phrase de la leçon qui introduit le concept, ou de la plus proche : un
 *      exemple ne doit pas convoquer du vocabulaire venu bien plus tard ;
 *   4. à distance égale, la plus courte ; et parmi elles, celles de 3 à 8 mots — les bornes de
 *      `build_sentence` (BUILD_SENTENCE_MIN/MAX_TOKENS).
 *
 * Un concept qui a déjà un exemple **n'est jamais touché** : le travail éditorial passe avant.
 * Le script est idempotent — le relancer ne change rien.
 *
 * Usage : npx tsx scripts/derive-examples.ts [--pack vi-south] [--write] [--json]
 * Sans `--write`, il ne fait que rendre compte.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const write = args.includes("--write");
const asJson = args.includes("--json");
const pack = args[args.indexOf("--pack") + 1] && args.includes("--pack") ? args[args.indexOf("--pack") + 1]! : "vi-south";

/** Bornes de `build_sentence` (packages/core/src/review.ts) : un exemple utile les respecte. */
const MIN_TOKENS = 3;
const MAX_TOKENS = 8;
const GAP = "___";

interface Localized {
  fr: string;
  en?: string;
}
interface Example {
  vi: string;
  fr: string;
  en?: string;
}
interface Concept {
  id: string;
  vi: string;
  examples?: Example[];
  [key: string]: unknown;
}
interface Step {
  type: string;
  target?: string;
  text?: string;
  answer?: string;
  prompt?: string;
  source?: string | Localized;
  accepted?: string[] | { fr: string[] };
  translation?: Localized;
}
interface Lesson {
  id: string;
  steps: Step[];
  review?: { srsIntroduce?: string[] };
}
interface Dialogue {
  turns?: { vi?: string; translation?: Localized }[];
}

const packDir = join(ROOT, "content", pack);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const jsonFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => join(e.parentPath, e.name))
      .sort();
  } catch {
    return [];
  }
};

const lessonPaths = jsonFiles(join(packDir, "lessons"));
const lessons = lessonPaths.map((p) => readJson<Lesson>(p));
const conceptPaths = jsonFiles(join(packDir, "concepts"));
const dialogues = jsonFiles(join(packDir, "dialogues")).map((p) => readJson<Dialogue>(p));

/** Position d'une leçon dans le cursus : sert à préférer une phrase du bon moment. */
const lessonOrder = new Map(lessons.map((lesson, index) => [lesson.id, index]));
/** Très loin : une réplique de dialogue n'appartient à aucune leçon précise. */
const FAR = Number.MAX_SAFE_INTEGER;

interface Pair {
  vi: string;
  fr: string;
  en?: string;
  /** Rang de la leçon d'où vient la phrase. */
  at: number;
}

const pairs: Pair[] = [];
function collect(vi: string | undefined, fr: string | undefined, en: string | undefined, at: number): void {
  const text = (vi ?? "").trim();
  const gloss = (fr ?? "").trim();
  // Une phrase, pas un mot seul : c'est un *exemple* qu'on cherche.
  if (!text || !gloss || text.includes(GAP) || tokens(text).length < 2) return;
  pairs.push({ vi: text, fr: gloss, ...(en?.trim() ? { en: en.trim() } : {}), at });
}

function tokens(text: string): string[] {
  return text
    .toLocaleLowerCase("vi")
    .replace(/[.,!?;:…"'«»()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** La suite de mots `needle` apparaît-elle entière dans `haystack` ? */
function containsWords(haystack: string, needle: string): boolean {
  const hay = tokens(haystack);
  const seek = tokens(needle);
  if (seek.length === 0 || hay.length < seek.length) return false;
  return hay.some((_, i) => seek.every((word, k) => hay[i + k] === word));
}

for (const lesson of lessons) {
  const at = lessonOrder.get(lesson.id) ?? FAR;
  for (const step of lesson.steps) {
    const translation = step.translation;
    switch (step.type) {
      case "build_sentence":
        collect(step.target, translation?.fr, translation?.en, at);
        break;
      case "fill_gap":
        collect((step.text ?? "").split(GAP).join(step.answer ?? ""), translation?.fr, translation?.en, at);
        break;
      case "speak_answer":
        collect(step.prompt, translation?.fr, translation?.en, at);
        break;
      case "translate_to_vi": {
        const source = typeof step.source === "object" ? step.source : undefined;
        collect(Array.isArray(step.accepted) ? step.accepted[0] : undefined, source?.fr, source?.en, at);
        break;
      }
      case "translate_to_fr": {
        const accepted = !Array.isArray(step.accepted) ? step.accepted : undefined;
        collect(typeof step.source === "string" ? step.source : undefined, accepted?.fr?.[0], undefined, at);
        break;
      }
      default:
        break;
    }
  }
}
for (const dialogue of dialogues) {
  for (const turn of dialogue.turns ?? []) collect(turn.vi, turn.translation?.fr, turn.translation?.en, FAR);
}

/** Leçon qui introduit chaque concept : la phrase idéale vient de là. */
const introducedAt = new Map<string, number>();
for (const lesson of lessons) {
  const at = lessonOrder.get(lesson.id) ?? FAR;
  for (const conceptId of lesson.review?.srsIntroduce ?? []) if (!introducedAt.has(conceptId)) introducedAt.set(conceptId, at);
}

let already = 0;
let filled = 0;
let untouched = 0;
const changed: { file: string; concept: Concept }[] = [];

for (const path of conceptPaths) {
  const concept = readJson<Concept>(path);
  if (concept.examples && concept.examples.length > 0) {
    already++;
    continue;
  }
  const home = introducedAt.get(concept.id) ?? FAR;
  const candidates = pairs.filter((pair) => containsWords(pair.vi, concept.vi) && tokens(pair.vi).join(" ") !== tokens(concept.vi).join(" "));
  if (candidates.length === 0) {
    untouched++;
    continue;
  }
  candidates.sort((a, b) => {
    const usable = (pair: Pair) => {
      const n = tokens(pair.vi).length;
      return n >= MIN_TOKENS && n <= MAX_TOKENS ? 0 : 1;
    };
    return (
      usable(a) - usable(b) ||
      Math.abs(a.at - home) - Math.abs(b.at - home) ||
      tokens(a.vi).length - tokens(b.vi).length ||
      a.vi.localeCompare(b.vi)
    );
  });
  const best = candidates[0]!;
  concept.examples = [{ vi: best.vi, fr: best.fr, ...(best.en ? { en: best.en } : {}) }];
  filled++;
  changed.push({ file: path, concept });
}

if (write) for (const { file, concept } of changed) writeFileSync(file, `${JSON.stringify(concept, null, 2)}\n`, "utf8");

const usableFor = (n: number) => n >= MIN_TOKENS && n <= MAX_TOKENS;
const buildable = changed.filter(({ concept }) => usableFor(tokens(concept.examples![0]!.vi).length)).length;
const report = {
  pack,
  écrit: write,
  phrasesDisponibles: new Set(pairs.map((p) => p.vi)).size,
  conceptsTotal: conceptPaths.length,
  avaientDéjàUnExemple: already,
  exemplesAjoutés: filled,
  dontUtilisablesEnBuildSentence: buildable,
  sansPhraseDansLeCorpus: untouched,
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`derive-examples (${pack})${write ? "" : " — aperçu, rien n'est écrit"}`);
  console.log(`  phrases distinctes trouvées dans le corpus : ${report.phrasesDisponibles}`);
  console.log(`  concepts : ${report.conceptsTotal} — déjà pourvus : ${already}`);
  console.log(`  exemples ajoutés : ${filled} (dont ${buildable} utilisables en build_sentence)`);
  console.log(`  restent sans exemple : ${untouched} (aucune phrase du corpus ne les contient)`);
  if (!write) console.log("  relancer avec --write pour appliquer");
}
