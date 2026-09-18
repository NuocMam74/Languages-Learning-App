/**
 * Catégorie grammaticale des concepts (contrat phase14 §1).
 *
 * Le contenu ne portait aucune catégorie : un concept n'avait que `type` (`word`, `structure`,
 * `tone`, `sound`), ce qui est une nature technique, pas une nature grammaticale. Impossible donc
 * d'offrir « les pronoms », « les verbes », « les classificateurs » — alors que ce sont précisément
 * les entrées d'un apprenant qui veut réviser en autonomie.
 *
 * Ce script remplit `pos` (part of speech). Il est **auditable et corrigeable** exprès : tout ce
 * qu'il décide vient de tables lisibles ci-dessous, dans cet ordre de priorité.
 *
 *   1. `OVERRIDES` — décisions explicites, par identifiant. C'est ici qu'on corrige une erreur :
 *      une ligne, et on relance.
 *   2. Les **classes fermées** du vietnamien, énumérées par leur forme : pronoms et termes
 *      d'adresse, particules finales, classificateurs, interrogatifs, nombres, prépositions,
 *      conjonctions. Ces classes se listent — c'est la partie fiable du classement.
 *   3. La **glose française**, pour les classes ouvertes : « classificateur de… » → classificateur,
 *      un infinitif (« manger ») → verbe, un article (« le marché ») → nom, etc.
 *   4. Rien de sûr → **aucune catégorie**. Un mot sans `pos` s'affiche sous « Autres » plutôt que
 *      d'être rangé au hasard : mieux vaut un trou visible qu'une fausse certitude.
 *
 * Les concepts de type `structure` sont des phrases et des tournures : ils reçoivent `phrase`, sans
 * examen — ce n'est pas une partie du discours.
 *
 * AVERTISSEMENT, à lever avec la relecture native : ce classement est **fait par machine**, sur un
 * corpus lui-même non relu (`reviewed: false` partout). Il vaut pour naviguer, pas pour trancher un
 * point de grammaire. Les gloses étant souvent polysémiques (« mưa » = « pluie ; pleuvoir »), la
 * catégorie retenue est celle du **premier sens**.
 *
 * Usage : npx tsx scripts/classify-concepts.ts [--pack vi-south] [--write] [--sample N]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const write = args.includes("--write");
const pack = args.includes("--pack") ? (args[args.indexOf("--pack") + 1] ?? "vi-south") : "vi-south";
const sampleSize = args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1] ?? 20) : 0;

export const POS = [
  "pronoun",
  "noun",
  "verb",
  "adjective",
  "numeral",
  "classifier",
  "adverb",
  "preposition",
  "conjunction",
  "particle",
  "question",
  "phrase",
] as const;
type Pos = (typeof POS)[number];

/** Décisions explicites par identifiant : la table qu'on corrige quand une règle se trompe. */
const OVERRIDES: Record<string, Pos> = {
  // « mới » sert surtout d'adverbe d'aspect (« je viens de… ») ; la glose met l'adjectif en second.
  "c_moi_just": "adverb",};

/**
 * Décisions par **glose exacte**. Plus lisible qu'un identifiant pour qui relit le contenu, et sans
 * ambiguïté là où deux concepts partagent une forme (« không » = « non » et « zéro »).
 *
 * Cette table existe parce qu'aucune règle morphologique française n'est fiable : « tiền »
 * (« argent ») et « ngọt » (« sucré ») se terminent pareil. Ce qui est listé ici a été lu un par un.
 */
const BY_GLOSS: Record<string, Pos> = {
  // Adjectifs (en vietnamien, des verbes d'état) que la règle du nom aurait avalés.
  "doué, bon (en)": "adjective",
  "gêné, timide": "adjective",
  "piquant, épicé": "adjective",
  "acide, aigre": "adjective",
  "pas bon, raté (goût, qualité)": "adjective",
  "prudent ; fais attention": "adjective",
  "normal ; comme d'habitude": "adjective",
  "en forme, en bonne santé": "adjective",
  rassasié: "adjective",
  "bon marché": "adjective",
  "emmêlé ; compliqué, confus": "adjective",
  "fini, épuisé ; plus de…": "adjective",
  "fini, terminé": "adjective",
  "en retard, tard": "adjective",
  "ce…-ci, ceci": "adjective",

  // Adverbes : temps, quantité, manière, négation.
  "sûrement, sans doute": "adverb",
  "sans arrêt, tout le temps (Sud)": "adverb",
  "autrefois, à l'époque (où…)": "adverb",
  "à l'époque, en ce temps-là": "adverb",
  "autrefois, jadis": "adverb",
  "un peu, légèrement": "adverb",
  "un peu (légèrement)": "adverb",
  "non, pas du tout (familier, appuyé, Sud)": "adverb",
  "un tout petit peu": "adverb",
  ici: "adverb",
  "en plus, encore": "adverb",
  "plus (que)": "adverb",
  longtemps: "adverb",
  "tôt, en avance": "adverb",
  "aujourd'hui": "adverb",
  hier: "adverb",
  demain: "adverb",
  "cette année": "adverb",
  "l'année prochaine": "adverb",
  "non ; ne… pas": "adverb",

  // Pronoms contractés de l'oral du Sud : ảnh, bả, chỉ, cổ, ổng.
  "lui (anh ấy, à l'oral au Sud) ; photo": "pronoun",
  "elle (bà ấy, à l'oral au Sud)": "pronoun",
  "elle (chị ấy, à l'oral au Sud) ; seulement": "pronoun",
  "elle (cô ấy, à l'oral au Sud) ; cou": "pronoun",
  "lui (ông ấy, à l'oral au Sud)": "pronoun",

  // Conjonctions.
  mais: "conjunction",
  "parce que": "conjunction",
  "supposons que, imaginons": "conjunction",

  // Localisations : elles se comportent comme des prépositions.
  "à côté (de)": "preposition",
  "en face (de)": "preposition",
  "à droite": "preposition",
  "à gauche": "preposition",

  // Verbes dont la glose est une formule toute faite.
  "demander poliment": "verb",
  "pardon, excuse-moi / excusez-moi": "verb",
  merci: "verb",

  // Particules de service et interjection.
  "pour moi, à ma place (rendre service)": "particle",
  "pour (quelqu'un), à la place de": "particle",
  "allô": "particle",

  // Termes de parenté employés comme adresse : ils fonctionnent en pronoms.
  "grand frère, deuxième enfant (rang « ba »)": "pronoun",
  "frère aîné (Sud)": "pronoun",
  "sœur aînée (Sud)": "pronoun",
  "oncle par alliance (mari de cô ou de dì)": "pronoun",

  // Restes que ni les classes fermées ni les règles ne tranchaient.
  "quand j'étais petit(e), dans l'enfance": "adverb",
  "à ce moment-là": "adverb",
  "peut-être": "adverb",
  "en train de": "particle",
  "si seulement…": "conjunction",
  "étrennes du Tết (enveloppe rouge)": "noun",
  "date de naissance": "noun",
  "billet de loterie": "noun",
  "carte de visite": "noun",
  "đồng (monnaie vietnamienne)": "noun",
  "noix de coco ; cocotier": "noun",
  "bœuf, vache": "noun",
  "histoire, affaire": "noun",
  "anniversaire de la mort d'un ancêtre (repas familial)": "noun",
  "gagner à la loterie": "verb",

  "tout le monde": "pronoun",
  "tout à l'heure (passé)": "adverb",
  "jeune plant de riz": "noun",
  "salle de bain": "noun",
  "chambre en location (meublé modeste)": "noun",
  "arrêt de bus": "noun",
  "sauce de poisson": "noun",
  "jus de canne à sucre": "noun",
  "hủ tiếu (soupe de nouilles du Sud)": "noun",
  "phở (soupe de nouilles de riz)": "noun",
  "Vietnamien(ne) de l'étranger": "noun",

  // Nombres.
  dizaine: "numeral",
  "dizaine (dans 20 à 90)": "numeral",
  "zéro": "numeral",
};

/** Table des gloses, indexée comme on la consulte : la casse des clés n'a alors plus d'importance. */
const byGloss = new Map<string, Pos>();

/** Normalise une forme pour la comparer : minuscules, espaces réduits. */
const norm = (text: string): string => text.toLocaleLowerCase("vi").replace(/\s+/g, " ").trim();

/**
 * Classes fermées du vietnamien, par la **forme**. Elles s'énumèrent, contrairement aux noms et aux
 * verbes : c'est la partie du classement dont on peut répondre.
 */
const CLOSED: Partial<Record<Pos, string[]>> = {
  // Pronoms et termes d'adresse — le cœur du vietnamien : on s'adresse par la parenté.
  pronoun: [
    "tôi", "tui", "mình", "ta", "tao", "tớ",
    "anh", "chị", "em", "con", "cháu", "bạn", "mày",
    "ông", "bà", "cô", "chú", "bác", "dì", "cậu", "thím", "mợ",
    "ba", "má", "mẹ", "bố", "cha", "vợ", "chồng",
    "nó", "họ", "hắn", "y",
    "chúng tôi", "chúng ta", "chúng mình", "tụi mình", "tụi tui", "tụi em", "tụi nó",
    "anh em", "chị em", "anh chị em", "ông bà", "ba má", "cô chú",
    "ai", "người ta",
  ],
  // Particules finales : ce qui donne son ton au Sud (nha, nghen, hen…).
  particle: [
    "ạ", "dạ", "nha", "nhé", "nghen", "hen", "há", "hả", "hông", "không nè", "nè", "đó", "đấy",
    "ơi", "à", "ừ", "vâng", "thôi", "vậy", "chớ", "chứ", "mà", "luôn", "nữa", "rồi", "chưa",
  ],
  // Classificateurs : obligatoires devant un nom compté.
  classifier: ["cái", "con", "chiếc", "cây", "quả", "trái", "tấm", "bức", "ly", "chén", "tô", "dĩa", "cuốn", "quyển", "căn", "ngôi", "chai", "lon", "bịch"],
  // Interrogatifs.
  question: ["gì", "đâu", "nào", "sao", "tại sao", "vì sao", "bao nhiêu", "mấy", "khi nào", "bao giờ", "thế nào", "làm sao", "ai", "bao lâu"],
  // Nombres.
  numeral: [
    "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín", "mười",
    "mười một", "mười hai", "hai mươi", "trăm", "nghìn", "ngàn", "triệu", "tỷ", "tỉ",
    "rưỡi", "lẻ", "linh", "mốt", "tư", "lăm", "nửa",
  ],
  // Prépositions et localisateurs.
  preposition: ["ở", "tại", "trong", "ngoài", "trên", "dưới", "trước", "sau", "giữa", "bên", "cạnh", "gần", "xa", "từ", "đến", "tới", "với", "cho", "của", "về", "bằng", "theo", "qua"],
  // Conjonctions.
  conjunction: ["và", "hoặc", "hay", "nhưng", "mà", "vì", "bởi vì", "nên", "nếu", "thì", "khi", "lúc", "rồi", "còn", "cũng", "tuy", "dù", "mặc dù"],
};

/** Formes qui appartiennent à plusieurs classes fermées : la première de cette liste l'emporte. */
const PRIORITY: Pos[] = ["question", "numeral", "classifier", "pronoun", "particle", "preposition", "conjunction"];

for (const [gloss, pos] of Object.entries(BY_GLOSS)) byGloss.set(norm(gloss), pos);

const closedIndex = new Map<string, Pos[]>();
for (const [pos, forms] of Object.entries(CLOSED) as [Pos, string[]][]) {
  for (const form of forms) {
    const key = norm(form);
    closedIndex.set(key, [...(closedIndex.get(key) ?? []), pos]);
  }
}

/**
 * Premier sens de la glose, **sans les parenthèses** : « passer (chez quelqu'un), faire un saut »
 * → « passer ». Les incises expliquent l'emploi, elles ne portent pas la catégorie, et elles
 * faisaient échouer la détection d'infinitif.
 */
function firstSense(gloss: string): string {
  const withoutParens = gloss.replace(/\([^)]*\)/g, " ");
  const first = withoutParens.split(/[;,]/)[0] ?? withoutParens;
  return norm(first.replace(/^[«"'\s]+|[»"'\s]+$/g, ""));
}

/** La glose porte-t-elle une marque de féminin (« occupé(e) », « content(e) ») ? Signe d'adjectif. */
const hasFeminineMark = (gloss: string): boolean => /\w\(e\)|\w\(ne\)|\w\(se\)|\w\(ve\)/.test(gloss);

/** Gloses qui se reconnaissent à un mot : elles disent la catégorie en toutes lettres. */
function fromGloss(gloss: string): Pos | null {
  const full = norm(gloss);
  const sense = firstSense(gloss);
  if (full.includes("classificateur")) return "classifier";
  if (full.includes("particule")) return "particle";
  if (/\?/.test(full)) return "question";
  if (/^(marque|marqueur) /.test(sense)) return "particle";

  // Adjectif : on le consulte **avant** la morphologie du verbe, sinon « amer » (« đắng ») et
  // « cher » (« mắc ») passent pour des infinitifs en -er.
  // **liste explicite**, pas de morphologie. Une terminaison française ne dit rien de
  // fiable — « tiền » (« argent ») et « ngọt » (« sucré ») finissent pareil. En vietnamien ces mots
  // sont des verbes d'état ; on garde « adjectif », c'est l'entrée que cherche un francophone.
  if (ADJECTIVES.has(sense)) return "adjective";

  // Un infinitif français d'**un seul mot** : « manger », « se déplacer ». On n'accepte -re que par
  // liste : les noms français en -re sont légion (« histoire », « anniversaire », « frère »), et
  // les prendre pour des verbes rangeait « chuyện » et « đám giỗ » parmi les verbes.
  const head = sense.replace(/^(se |s')/, "").split(" ")[0] ?? "";
  if (head && !NOUNISH.has(head) && (/(er|ir|oir)$/.test(head) || RE_VERBS.has(head))) return "verb";
  if (/^être /.test(sense)) return "adjective";
  if (/^(avoir|faire|aller|venir|dire|voir|prendre|mettre|pouvoir|vouloir|devoir|savoir)\b/.test(sense)) return "verb";

  // Un article en tête : « le marché », « une chaise ».
  if (/^(le |la |les |l'|un |une |des |du |de la )/.test(sense)) return "noun";

  // « occupé(e) » est un adjectif, « employé(e) » un nom : la marque de féminin ne tranche que si
  // la forme est déjà connue comme adjectif, sinon on laisse la règle du nom décider.
  if (hasFeminineMark(gloss) && ADJECTIVES.has(sense.replace(/\(e\)$/, ""))) return "adjective";

  // Adverbes fréquents en glose.
  if (/^(très|trop|assez|beaucoup|peu|souvent|toujours|jamais|déjà|encore|maintenant|d'habitude|ensuite|aussi|seulement|vraiment|bientôt)\b/.test(sense)) return "adverb";

  // Glose nue d'un ou deux mots : un nom, sauf si on la connaît comme adjectif.
  if (sense.split(" ").length <= 2 && /^[a-zàâäéèêëîïôöùûüçœæ' -]+$/.test(sense)) {
    return ADJECTIVES.has(sense) ? "adjective" : "noun";
  }

  return null;
}

/**
 * Adjectifs français fréquents dans les gloses du pack. Sans cette liste, une glose nue comme
 * « occupé » ou « cher » serait rangée en nom.
 */
const ADJECTIVES = new Set([
  "occupé", "content", "joyeux", "triste", "fatigué", "malade", "bon", "mauvais", "grand", "petit", "gros", "mince",
  "beau", "joli", "mignon", "laid", "cher", "gratuit", "facile", "difficile", "rapide", "lent", "chaud", "froid",
  "nouveau", "vieux", "jeune", "propre", "sale", "plein", "vide", "long", "court", "haut", "bas", "loin", "proche",
  "juste", "faux", "vrai", "correct", "sûr", "prêt", "libre", "fort", "faible", "doux", "dur", "épicé", "sucré",
  "salé", "amer", "délicieux", "bruyant", "calme", "gentil", "poli", "timide", "drôle", "important", "possible",
  "différent", "pareil", "seul", "ensemble", "heureux", "célibataire", "marié", "riche", "pauvre", "lourd", "léger",
  "clair", "sombre", "sec", "mouillé", "frais", "confortable", "pratique", "utile",
]);

/** Gloses nues qui sont des noms malgré une terminaison d'adjectif. */
const NOUN_WORDS = new Set([
  "café", "thé", "marché", "quartier", "métier", "canapé", "clé", "fée", "idée", "journée", "soirée", "année",
  "matinée", "entrée", "sortie", "envie", "pluie", "vie", "partie", "série", "police", "mairie", "boulangerie",
  "pâtisserie", "épicerie", "pharmacie", "bougie", "famille", "fille", "bouteille", "oreille", "abeille",
]);

/** Verbes français en -re : la terminaison ne suffit pas, on les énumère. */
const RE_VERBS = new Set([
  "prendre", "apprendre", "comprendre", "reprendre", "surprendre", "mettre", "permettre", "promettre", "remettre",
  "faire", "refaire", "dire", "redire", "écrire", "décrire", "lire", "relire", "boire", "croire", "rire", "sourire",
  "vivre", "suivre", "vendre", "attendre", "descendre", "répondre", "perdre", "rendre", "entendre", "défendre",
  "conduire", "construire", "produire", "traduire", "cuire", "plaire", "connaître", "naître", "battre", "peindre",
  "éteindre", "atteindre", "joindre", "craindre", "coudre", "moudre", "résoudre", "clore", "être",
]);

/** Gloses en -er/-ir/-re qui sont des noms, pas des infinitifs : le piège du détecteur. */
const NOUNISH = new Set([
  "cuillère", "rivière", "frère", "mère", "père", "bière", "manière", "affaire", "heure", "fleur", "couleur", "chaleur", "odeur",
  "hiver", "mer", "fer", "hier", "cahier", "papier", "quartier", "chantier", "métier", "escalier", "plancher", "verre", "terre",
  "guerre", "pierre", "lettre", "fenêtre", "théâtre", "ministre", "titre", "chiffre", "livre", "arbre", "ombre", "chambre",
  "nombre", "membre", "centre", "ventre", "sucre", "vinaigre", "poivre", "cuivre", "soir", "miroir", "couloir", "pouvoir",
  "devoir", "savoir", "espoir", "trottoir", "loisir", "plaisir", "désir", "souvenir", "avenir", "ascenseur", "docteur", "voleur",
]);

interface Concept {
  id: string;
  type: string;
  vi: string;
  gloss: { fr: string };
  pos?: Pos;
  [key: string]: unknown;
}

const packDir = join(ROOT, "content", pack, "concepts");
const files = readdirSync(packDir).filter((f) => f.endsWith(".json")).sort();

let changed = 0;
let unchanged = 0;
const counts = new Map<string, number>();
const unresolved: Concept[] = [];
const decided: { concept: Concept; pos: Pos; how: string }[] = [];

for (const file of files) {
  const path = join(packDir, file);
  const concept = JSON.parse(readFileSync(path, "utf8")) as Concept;

  let pos: Pos | null = null;
  let how = "";
  if (OVERRIDES[concept.id]) {
    pos = OVERRIDES[concept.id]!;
    how = "table";
  } else if (concept.type === "structure") {
    pos = "phrase";
    how = "structure";
  } else if (concept.type === "tone" || concept.type === "sound") {
    pos = null; // Un ton n'est pas une partie du discours.
  } else {
    const closed = closedIndex.get(norm(concept.vi));
    if (closed) {
      pos = PRIORITY.find((p) => closed.includes(p)) ?? closed[0]!;
      how = "classe fermée";
    } else if (byGloss.has(norm(concept.gloss.fr))) {
      pos = byGloss.get(norm(concept.gloss.fr))!;
      how = "glose lue";
    } else {
      pos = fromGloss(concept.gloss.fr);
      if (pos) how = "glose";
    }
  }

  if (pos) {
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
    decided.push({ concept, pos, how });
    if (concept.pos !== pos) {
      concept.pos = pos;
      changed++;
      if (write) writeFileSync(path, `${JSON.stringify(concept, null, 2)}\n`, "utf8");
    } else unchanged++;
  } else if (concept.type === "word") unresolved.push(concept);
}

console.log(`classify-concepts (${pack})${write ? "" : " — aperçu, rien n'est écrit"}`);
console.log(`  concepts : ${files.length} — classés : ${decided.length} (${((decided.length / files.length) * 100).toFixed(0)} %)`);
console.log(`  écrits : ${changed} | déjà à jour : ${unchanged}`);
console.log(`  mots sans catégorie sûre : ${unresolved.length}`);
console.log("  répartition :");
for (const [pos, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`     ${pos.padEnd(12)} ${String(n).padStart(4)}`);
const byHow = new Map<string, number>();
for (const d of decided) byHow.set(d.how, (byHow.get(d.how) ?? 0) + 1);
console.log("  décidé par :", [...byHow].map(([k, v]) => `${k} ${v}`).join(", "));

if (args.includes("--by")) {
  const want = args[args.indexOf("--by") + 1];
  const rows = decided.filter((d) => d.pos === want && d.concept.type === "word");
  console.log(`
  ${want} (${rows.length}) :`);
  for (const { concept, how } of rows) console.log(`     ${concept.vi.padEnd(16)} ${how.padEnd(13)} ${concept.gloss.fr.slice(0, 46)}`);
}

if (sampleSize > 0) {
  console.log(`\n  échantillon (${sampleSize}) :`);
  const step = Math.max(1, Math.floor(decided.length / sampleSize));
  for (const { concept, pos, how } of decided.filter((_, i) => i % step === 0).slice(0, sampleSize)) {
    console.log(`     ${concept.vi.padEnd(16)} ${pos.padEnd(11)} ${how.padEnd(13)} ${concept.gloss.fr.slice(0, 40)}`);
  }
  if (unresolved.length > 0) {
    console.log(`\n  non classés (${Math.min(sampleSize, unresolved.length)} sur ${unresolved.length}) :`);
    for (const c of unresolved.slice(0, sampleSize)) console.log(`     ${c.vi.padEnd(16)} ${c.gloss.fr.slice(0, 50)}`);
  }
}
if (!write) console.log("\n  relancer avec --write pour appliquer");
