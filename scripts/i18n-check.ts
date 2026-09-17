/**
 * Garde de localisation (spec §2 : interface fr par défaut, en en seconde langue). Bloquant en CI.
 *   1. chaque clé des modules apps/web/src/i18n/messages/*.ts a une traduction `en` non vide ;
 *   2. les placeholders `{x}` sont identiques entre fr et en ;
 *   3. aucune chaîne d'interface française codée en dur dans les composants (heuristique :
 *      texte JSX, attributs aria-* / title / alt / placeholder / label, et arguments de
 *      confirm / alert / Notification / document.title / fillText / share).
 *
 * Usage : npm run i18n:check [-- --json] [-- --verbose]
 * Faux positif ? Ajoute le mot à ALLOWED_WORDS (contenu vietnamien, noms propres) ou mets
 * `// i18n-ignore` en fin de ligne.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_SRC = join(ROOT, "apps", "web", "src");
const MESSAGES_DIR = join(WEB_SRC, "i18n", "messages");
const verbose = process.argv.includes("--verbose");
const jsonOutput = process.argv.includes("--json");

type Problem = { where: string; message: string };
const problems: Problem[] = [];

// ---------------------------------------------------------------------------
// 1 + 2. Modules de messages
// ---------------------------------------------------------------------------

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

let keyCount = 0;
async function checkMessages(): Promise<void> {
  for (const file of readdirSync(MESSAGES_DIR).sort()) {
    if (!file.endsWith(".ts") || file === "index.ts" || file.includes(".test.")) continue;
    const mod = (await import(pathToFileURL(join(MESSAGES_DIR, file)).href)) as { fr?: Record<string, string>; en?: Record<string, string> };
    const where = `i18n/messages/${file}`;
    if (!mod.fr) {
      problems.push({ where, message: "pas d'export `fr`" });
      continue;
    }
    const en = mod.en ?? {};
    for (const [key, frText] of Object.entries(mod.fr)) {
      keyCount++;
      const enText = en[key];
      if (typeof enText !== "string" || enText.trim() === "") {
        problems.push({ where: `${where} ${key}`, message: "traduction anglaise manquante" });
        continue;
      }
      if (looksFrench(enText)) problems.push({ where: `${where} ${key}`, message: `la traduction anglaise semble en français : « ${enText.slice(0, 80)} »` });
      const a = placeholders(frText).join(",");
      const b = placeholders(enText).join(",");
      if (a !== b) problems.push({ where: `${where} ${key}`, message: `placeholders différents : fr {${a}} / en {${b}}` });
    }
    for (const key of Object.keys(en)) {
      if (!(key in mod.fr)) problems.push({ where: `${where} ${key}`, message: "clé anglaise sans équivalent français" });
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Chaînes françaises codées en dur
// ---------------------------------------------------------------------------

/** Lettres propres au vietnamien (absentes du français) : un mot qui en contient est du contenu. */
const VIETNAMESE_ONLY = /[ăđơưạảãấầẩẫậắằẳẵặẹẻẽếềểễệỉĩịọỏõốồổỗộớờởỡợụủũứừửữựỳỵỷỹýìíòóúĂĐƠƯ]/i;
/** Accents exclusivement français (absents du vietnamien). */
const FRENCH_ONLY_ACCENT = /[çëïîûœ]/i;
/** Accents partagés avec le vietnamien (cà phê, công, chè) : décisifs seulement sur un mot long. */
const SHARED_ACCENT = /[éèêàâôù]/i;

/** Mots français courants d'interface (sans accent) qui n'existent pas en anglais. */
const FRENCH_WORDS = new Set(
  (
    "le la les de des du en une et est pour avec sans pas tu ta tes toi te vous votre vos dans sur aux au ce cette ces qui que " +
    "mais ou ne mon mes sa ses nous il elle ils leur encore aucun aucune rien jamais toujours " +
    "continuer valider retour fermer annuler suivant quitter jouer passer seance reglages bientot examens examen " +
    "lecon mot mots carte cartes chargement erreur reessayer envoyer enregistrer supprimer ajouter retirer ouvrir " +
    "partager copier jour jours semaine commencer terminer termine parler ecouter choisis choisir oui " +
    "connexion compte connecte hors ligne telecharger certificat defi defis ligue classement barque barques " +
    "voir ici maintenant depuis apres avant pendant"
  ).split(" "),
);

/** Contenu vietnamien sans lettre propre au vietnamien, noms propres, endonymes et termes techniques. */
const ALLOWED_WORDS = new Set(
  (
    "français english parlo mai cô co saigon saïgon ba bà ma má mà la là cà phê ca cá chè xe om ôm bun phở pho bánh mì hue huế công " +
    "xp ipa json telex pdf qr url id ok stop a0 a1 a2 b1 b2 min ngang huyen sac hoi nga nang " +
    "pack packs division badge badges image images audio note date version code format type points " +
    "question questions minutes secondes"
  ).split(" "),
);

function normalize(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Heuristique : le texte ressemble-t-il à du français d'interface ? Les mots vietnamiens sont ignorés. */
function looksFrench(text: string): boolean {
  const words = text.match(/[\p{L}'’]+/gu) ?? [];
  let score = 0;
  let meaningful = 0;
  for (const raw of words) {
    const word = raw.replace(/^['’]+|['’]+$/g, "");
    if (!word || VIETNAMESE_ONLY.test(word)) continue;
    const lower = word.toLowerCase();
    if (ALLOWED_WORDS.has(lower) || ALLOWED_WORDS.has(normalize(word))) continue;
    meaningful++;
    // élisions : l'examen, d'abord, qu'on, n'est, c'est, j'ai, s'affiche
    if (/^(l|d|qu|n|c|j|s|t|m)['’]\p{L}/u.test(lower)) score += 2;
    else if (FRENCH_ONLY_ACCENT.test(word)) score += 2;
    else if (SHARED_ACCENT.test(word)) score += word.length >= 5 ? 2 : word.length > 1 ? 1 : 0;
    else if (FRENCH_WORDS.has(normalize(word))) score += 1;
  }
  // Un mot d'interface isolé (« Retour », « Séance ») suffit ; sinon il faut deux indices.
  return score >= 2 || (meaningful === 1 && score >= 1 && words.join("").length > 3);
}

/** Retire commentaires en conservant les chaînes et la position des lignes. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const chunk = source.slice(i, end < 0 ? source.length : end + 2);
      out += chunk.replace(/[^\n]/g, " ");
      i += chunk.length;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // apostrophe dans du texte JSX (« C'est ») : ne pas ouvrir de chaîne si précédée d'une lettre
      if (c === "'" && /\p{L}/u.test(source[i - 1] ?? "")) {
        out += c;
        i++;
        continue;
      }
      quote = c;
    }
    out += c;
    i++;
  }
  return out;
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const ATTRIBUTE = /\b(aria-[a-z]+|title|alt|placeholder|label)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/g;
const CALL = /\b(confirm|alert|prompt|fillText|strokeText|new\s+Notification|showNotification|document\.title\s*=|setError|text\s*:|title\s*:|body\s*:|message\s*:|label\s*:|hint\s*:|placeholder\s*:)\s*\(?\s*["'`]([^"'`]*)["'`]/g;
const JSX_TEXT = />([^<>{}]*[\p{L}][^<>{}]*)</gu;

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // messages : les modules eux-mêmes ; demo : galerie de composants chargée seulement en développement.
      if (name === "messages" || name === "node_modules" || name === "demo") continue;
      walk(path, files);
    } else if (/\.(tsx?|mts)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && name !== "test-setup.ts" && !name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

await checkMessages();

let hardcoded = 0;
for (const file of walk(WEB_SRC)) {
  const raw = readFileSync(file, "utf8");
  const source = stripComments(raw);
  const rawLines = raw.split("\n");
  const where = relative(WEB_SRC, file).replaceAll("\\", "/");
  const seen = new Set<string>();
  const report = (index: number, text: string, kind: string) => {
    const line = lineOf(source, index);
    if (/i18n-ignore/.test(rawLines[line - 1] ?? "")) return;
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed || !looksFrench(trimmed)) return;
    const id = `${line}:${trimmed}`;
    if (seen.has(id)) return;
    seen.add(id);
    hardcoded++;
    problems.push({ where: `${where}:${line}`, message: `texte français codé en dur (${kind}) : « ${trimmed.slice(0, 80)} »` });
  };
  for (const m of source.matchAll(ATTRIBUTE)) report(m.index!, m[2] ?? m[3] ?? m[4] ?? "", m[1]!);
  for (const m of source.matchAll(CALL)) report(m.index!, m[2] ?? "", m[1]!.replace(/\s+/g, " "));
  if (file.endsWith(".tsx")) {
    for (const m of source.matchAll(JSX_TEXT)) {
      const text = m[1]!;
      // Code TypeScript entre deux chevrons (génériques, comparaisons) : ignoré s'il ressemble à du code.
      if (/[;=()&|]|=>|\breturn\b|\bconst\b/.test(text)) continue;
      report(m.index!, text, "JSX");
    }
  }
}

if (jsonOutput) {
  process.stdout.write(JSON.stringify({ keys: keyCount, problems }, null, 2) + "\n");
} else {
  for (const p of problems) console.error(`✗ ${p.where} — ${p.message}`);
  const missing = problems.filter((p) => p.message.startsWith("traduction anglaise manquante")).length;
  console.log(`i18n:check — ${keyCount} clés, ${missing} sans anglais, ${problems.length - missing - hardcoded} autres écarts de messages, ${hardcoded} texte(s) codé(s) en dur.`);
  if (verbose && problems.length === 0) console.log("Tout est traduit.");
}
process.exit(problems.length > 0 ? 1 : 0);
