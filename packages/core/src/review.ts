import { ContentError, GAP, seededRandom, shuffle, type ChoiceOption, type Exercise } from "./engine.ts";
import { heardClassOf, normalizeAnswer, stripTones, syllables, toneOf } from "./text.ts";
import { contentMedia, hasNativeAudio as hasIndexedNativeAudio, type MediaIndex } from "./media.ts";
import { hasFeature, type Concept, type ConceptId, type ContentIndex, type Localized } from "./types.ts";

/**
 * Exercices de révision construits à partir d'un concept seul (blocs Réveil et
 * Rappel espacé, spec §4.3) : le SRS porte sur des concepts, pas sur des étapes
 * de leçon (spec §6.3), donc un même concept revient sous des formats variés.
 */

export type ReviewFormat = "listen_pick_text" | "tone_identify" | "listen_pick_image" | "fill_gap" | "match_pairs";

/**
 * Formats riches (contrat phase6 §5) : `fill_gap` (le concept dans une de ses phrases d'exemple)
 * et `match_pairs` (le concept et 2–3 voisins). Ils demandent une interface dédiée : `reviewFormats`
 * ne les propose qu'avec `richFormats` (la PWA l'active dans `apps/web/src/session-store.ts`, ses vues
 * existent depuis `apps/web/src/exercises`) ; les autres clients gardent le défaut prudent.
 */
export const RICH_REVIEW_FORMATS: ReadonlySet<ReviewFormat> = new Set<ReviewFormat>(["fill_gap", "match_pairs"]);

/** Nombre de concepts d'un appariement de révision (cible comprise). */
export const REVIEW_MATCH_SIZE = 3;

export interface ReviewOptions {
  /** Concepts déjà rencontrés par l'apprenant : distracteurs privilégiés. */
  known?: Iterable<ConceptId>;
  /** Position de l'item dans la séance (reportée dans l'événement answer_submitted). */
  stepIndex?: number;
  /**
   * Autorise tone_identify sans audio natif (synthèse vocale). À laisser à false
   * en production : jamais de TTS pour un exercice de tons (spec §7.4).
   */
  allowTtsTone?: boolean;
  /** Médias présents (défaut : ceux du contenu). */
  media?: MediaIndex | null;
  /** Nombre maximal d'options (cible comprise) : 2 pour un exercice plus facile après 3 erreurs. */
  maxOptions?: number;
  /** Autorise les formats riches (fill_gap, match_pairs) : à activer quand l'interface sait les afficher. */
  richFormats?: boolean;
}

/** Nombre maximal d'options proposées (cible comprise). */
export const REVIEW_MAX_OPTIONS = 4;


function orderedCandidates(content: ContentIndex, target: Concept, known: ReadonlySet<ConceptId>, rand: () => number, keep: (c: Concept) => boolean): Concept[] {
  const others = [...content.concepts.values()].filter((c) => c.id !== target.id && keep(c));
  const knownOnes = shuffle(others.filter((c) => known.has(c.id)), rand);
  const rest = shuffle(others.filter((c) => !known.has(c.id)), rand);
  return [...knownOnes, ...rest];
}

/**
 * Distracteurs textuels. Pack tonal : variantes tonales d'abord (le vrai piège), puis
 * concepts du même type. Pack sans tons : les accents écrits ne distinguent pas
 * forcément des sons (es : « si » / « sí »), donc jamais deux formes qui ne diffèrent
 * que par ces marques dans un exercice d'écoute.
 */
function textDistractors(content: ContentIndex, target: Concept, known: ReadonlySet<ConceptId>, rand: () => number, max = REVIEW_MAX_OPTIONS): string[] {
  const tonal = hasFeature(content.pack, "tones");
  const norm = normalizeAnswer(target.vi);
  const base = stripTones(norm);
  const seen = new Set([norm]);
  const out: string[] = [];
  const take = (c: Concept) => {
    const n = normalizeAnswer(c.vi);
    if (seen.has(n) || out.length >= max - 1) return;
    seen.add(n);
    out.push(c.vi);
  };
  if (tonal) orderedCandidates(content, target, known, rand, (c) => stripTones(normalizeAnswer(c.vi)) === base).forEach(take);
  orderedCandidates(content, target, known, rand, (c) => c.type === target.type && (tonal || stripTones(normalizeAnswer(c.vi)) !== base)).forEach(take);
  return out;
}

function imageDistractors(content: ContentIndex, target: Concept, known: ReadonlySet<ConceptId>, rand: () => number, max = REVIEW_MAX_OPTIONS): Concept[] {
  const norm = normalizeAnswer(target.vi);
  const images = new Set([target.image]);
  const texts = new Set([norm]);
  const out: Concept[] = [];
  for (const c of orderedCandidates(content, target, known, rand, (c) => c.type === target.type && c.image !== undefined)) {
    if (out.length >= max - 1) break;
    if (images.has(c.image) || texts.has(normalizeAnswer(c.vi))) continue;
    images.add(c.image);
    texts.add(normalizeAnswer(c.vi));
    out.push(c);
  }
  return out;
}

function toneFeasible(content: ContentIndex, target: Concept, allowTtsTone: boolean, media: MediaIndex | null): boolean {
  return (
    hasFeature(content.pack, "tones") &&
    content.pack.toneSystem !== undefined &&
    target.type === "word" &&
    syllables(target.vi).length === 1 &&
    (allowTtsTone || hasIndexedNativeAudio(target, media))
  );
}

/**
 * Phrase d'exemple du concept contenant sa forme : support d'un `fill_gap` de révision.
 * La première occurrence est remplacée par le trou (la casse initiale est conservée).
 */
function gapSentence(target: Concept): { text: string; translation: Localized } | null {
  for (const example of target.examples ?? []) {
    const at = example.vi.toLocaleLowerCase("vi").indexOf(target.vi.toLocaleLowerCase("vi"));
    if (at < 0) continue;
    const text = example.vi.slice(0, at) + GAP + example.vi.slice(at + target.vi.length);
    return { text, translation: { fr: example.fr, ...(example.en ? { en: example.en } : {}) } };
  }
  return null;
}

/** Concepts appariables avec la cible : même type, forme et traduction distinctes. */
function matchMates(content: ContentIndex, target: Concept, known: ReadonlySet<ConceptId>, rand: () => number): Concept[] {
  const glosses = new Set([target.gloss.fr]);
  const texts = new Set([normalizeAnswer(target.vi)]);
  const out: Concept[] = [];
  for (const c of orderedCandidates(content, target, known, rand, (c) => c.type === target.type)) {
    if (out.length >= REVIEW_MATCH_SIZE - 1) break;
    if (glosses.has(c.gloss.fr) || texts.has(normalizeAnswer(c.vi))) continue;
    glosses.add(c.gloss.fr);
    texts.add(normalizeAnswer(c.vi));
    out.push(c);
  }
  return out;
}

/** Formats applicables à ce concept, dans un ordre stable. */
export function reviewFormats(content: ContentIndex, conceptId: ConceptId, opts: ReviewOptions = {}): ReviewFormat[] {
  const target = content.concepts.get(conceptId);
  if (!target) return [];
  const known = new Set(opts.known ?? []);
  const rand = seededRandom("formats");
  const formats: ReviewFormat[] = [];
  if (textDistractors(content, target, known, rand).length >= 1) formats.push("listen_pick_text");
  if (toneFeasible(content, target, opts.allowTtsTone ?? false, opts.media === undefined ? contentMedia(content) : opts.media)) formats.push("tone_identify");
  if (target.image && imageDistractors(content, target, known, rand).length >= 2) formats.push("listen_pick_image");
  if (opts.richFormats) {
    if (gapSentence(target) && textDistractors(content, target, known, rand).length >= 1) formats.push("fill_gap");
    if (matchMates(content, target, known, rand).length >= REVIEW_MATCH_SIZE - 1) formats.push("match_pairs");
  }
  return formats;
}

export function buildReviewExercise(
  content: ContentIndex,
  conceptId: ConceptId,
  seed: string,
  formatHint?: ReviewFormat,
  opts: ReviewOptions = {},
): Exercise {
  const target = content.concepts.get(conceptId);
  if (!target) throw new ContentError(`Concept inconnu : ${conceptId}`);
  const known = new Set(opts.known ?? []);
  const stepIndex = opts.stepIndex ?? 0;
  const rand = seededRandom(`${seed}:review:${conceptId}`);
  const explain = target.note ?? null;
  const max = Math.max(2, Math.min(REVIEW_MAX_OPTIONS, opts.maxOptions ?? REVIEW_MAX_OPTIONS));

  const feasible = reviewFormats(content, conceptId, opts);
  const format: ReviewFormat | null =
    formatHint && feasible.includes(formatHint) ? formatHint : (feasible[Math.floor(rand() * feasible.length)] ?? null);

  switch (format) {
    case "listen_pick_text": {
      const texts = shuffle([target.vi, ...textDistractors(content, target, known, rand, max)], rand);
      const options: ChoiceOption[] = texts.map((text, i) => ({ id: `t${i}`, text }));
      const answerId = options.find((o) => o.text === target.vi)?.id ?? "";
      return { type: "listen_pick_text", stepIndex, conceptIds: [target.id], explain, audio: target, options, answerId };
    }

    case "tone_identify": {
      const classes = content.pack.toneSystem?.heardClasses ?? [];
      const answerClass = heardClassOf(target.tone ?? toneOf(target.vi), classes);
      const options = classes.map((tones, i) => ({ id: `tone${i}`, tones: [...tones] }));
      return { type: "tone_identify", stepIndex, conceptIds: [target.id], explain, audio: target, options, answerId: `tone${answerClass}` };
    }

    case "listen_pick_image": {
      const all = shuffle([target, ...imageDistractors(content, target, known, rand, max)], rand);
      const options = all.map((c) => ({ id: c.id, conceptId: c.id, text: c.vi, ...(c.image ? { image: c.image } : {}) }));
      return { type: "listen_pick_image", stepIndex, conceptIds: [target.id], explain, audio: target, options, answerId: target.id };
    }

    case "fill_gap": {
      // gapSentence est garanti par reviewFormats ; sinon on retombe sur une question de sens.
      const gap = gapSentence(target);
      if (!gap) return buildReviewExercise(content, conceptId, seed, "listen_pick_text", opts);
      const texts = shuffle([target.vi, ...textDistractors(content, target, known, rand, max)], rand);
      const options = texts.map((text, i) => ({ id: `o${i}`, text }));
      const answerId = options.find((o) => o.text === target.vi)?.id ?? "";
      return { type: "fill_gap", stepIndex, conceptIds: [target.id], explain, text: gap.text, translation: gap.translation, options, answerId };
    }

    case "match_pairs": {
      const mates = matchMates(content, target, known, rand);
      const concepts = [target, ...mates];
      const left = shuffle(concepts, rand).map((c) => ({ id: `l${c.id}`, conceptId: c.id, text: c.vi }));
      const right = shuffle(concepts, rand).map((c) => ({ id: `r${c.id}`, conceptId: c.id, label: c.gloss }));
      return {
        type: "match_pairs", stepIndex, conceptIds: concepts.map((c) => c.id), explain,
        mode: "text_gloss", left, right, answer: concepts.map((c) => ({ leftId: `l${c.id}`, rightId: `r${c.id}` })),
      };
    }

    case null: {
      // Aucun distracteur de forme : on vérifie le sens (audio → traduction).
      const seenGloss = new Set([target.gloss.fr]);
      const others = orderedCandidates(content, target, known, rand, () => true).filter((c) => {
        if (seenGloss.has(c.gloss.fr)) return false;
        seenGloss.add(c.gloss.fr);
        return true;
      });
      if (others.length === 0) throw new ContentError(`Impossible de réviser ${conceptId} : aucun autre concept`);
      const picks = shuffle([target, ...others.slice(0, max - 1)], rand);
      const options = picks.map((c, i) => ({ id: `g${i}`, label: c.gloss }));
      const answerId = `g${picks.indexOf(target)}`;
      return { type: "listen_pick_text", stepIndex, conceptIds: [target.id], explain, audio: target, options, answerId };
    }
  }
}
