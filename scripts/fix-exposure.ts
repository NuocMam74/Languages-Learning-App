/**
 * Remplace, dans les niveaux existants, les leurres que l'apprenant ne peut pas connaître
 * (contrat phase26 §4).
 *
 * La règle est celle de `unmetExposure` : un choix possible, un jeton en trop, une image voisine ou
 * le reste d'une phrase à trous ne montrent que des mots **déjà appris** à ce point du cursus — les
 * variantes tonales de la bonne réponse mises à part. Au moment d'écrire ce script, 191 niveaux sur
 * 194 enfreignaient la règle, pour l'essentiel à cause de leurres tirés de tout le pack par
 * `derive-practice.ts`.
 *
 * Étape par étape :
 *   - `listen_pick_text`, `fill_gap` : les options inconnues sont remplacées par des mots appris
 *     (même tirage que `derive-practice.ts`) ; s'il n'en reste pas deux, l'étape est retirée ;
 *   - `fill_gap` dont la phrase elle-même contient un mot inconnu : retirée ;
 *   - `build_sentence` : les jetons en trop inconnus sont retirés (la phrase reste constructible) ;
 *   - `listen_pick_image` : les images voisines inconnues sont remplacées par des images de mots
 *     appris ; faute d'en trouver deux, l'étape devient un `listen_pick_text` sur le même mot.
 *
 * Les étapes retirées font baisser le barème : relancer ensuite `derive-practice.ts --write`, qui
 * complète avec des exercices respectant la même règle. Le script ne réécrit aucun conseil : un mot
 * cité sans concept reste signalé par la validation, à corriger à la main.
 *
 * Usage : npx tsx scripts/fix-exposure.ts [--pack vi-south] [--write]
 */
import { writeFileSync } from "node:fs";
import {
  buildContentIndex,
  GAP,
  lexicalKey,
  lexiconBefore,
  lexiconOf,
  normalizeAnswer,
  seededRandom,
  stripTones,
  unmetExposure,
  type Concept,
  type ContentIndex,
  type KnownLexicon,
  type Lesson,
  type LessonStep,
} from "@parlo/core";
import { pickDistractors, pickImageMates, type DistractorPools, type HeardClasses } from "./lib/distractors.ts";
import { listPacks, readPackFiles, toRaw } from "./lib/load-pack.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const packArg = args.includes("--pack") ? args[args.indexOf("--pack") + 1] : undefined;

/** Options d'un choix, réponse comprise : 4 pour un mot, 3 pour une phrase (comme `derive-practice.ts`). */
const MAX_OPTIONS_WORD = 4;
const MAX_OPTIONS_PHRASE = 3;
const MIN_DISTRACTORS = 2;

/** Tous les mots de la forme sont-ils appris ? (chiffres et noms propres mis à part) */
function formKnown(form: string, known: KnownLexicon): boolean {
  const key = lexicalKey(form);
  if (key === "" || known.forms.has(key)) return true;
  return key.split(" ").every((part) => part === "" || known.forms.has(part) || /^\p{Nd}+$/u.test(part));
}

/** Leurre admis : appris, ou variante tonale (mot à mot) de la bonne réponse. */
function decoyAllowed(decoy: string, target: string, known: KnownLexicon): boolean {
  if (formKnown(decoy, known)) return true;
  const a = lexicalKey(decoy).split(" ");
  const b = lexicalKey(target).split(" ");
  return a.length === b.length && a.every((w, i) => known.forms.has(w) || stripTones(w) === stripTones(b[i] ?? ""));
}

interface Ctx {
  content: ContentIndex;
  lesson: Lesson;
  known: KnownLexicon;
  pools: DistractorPools;
  classes: HeardClasses;
}

/** L'étape corrigée, ou `null` si elle doit disparaître. */
function fixStep(ctx: Ctx, step: LessonStep, index: number): LessonStep | null {
  const { content, known, pools, classes } = ctx;
  const rand = seededRandom(`${ctx.lesson.id}:${index}:exposure`);
  switch (step.type) {
    case "listen_pick_text": {
      const target = content.concepts.get(step.concept);
      if (!target) return step;
      const kept = step.distractors.filter((d) => decoyAllowed(d, target.vi, known));
      if (kept.length === step.distractors.length) return step;
      const max = (target.vi.includes(" ") ? MAX_OPTIONS_PHRASE : MAX_OPTIONS_WORD) - 1;
      const extra = pickDistractors(target, pools, Math.max(0, max - kept.length), classes, rand, kept);
      const distractors = [...kept, ...extra];
      return distractors.length >= MIN_DISTRACTORS ? { ...step, distractors } : null;
    }
    case "fill_gap": {
      if (!formKnown(step.text.replace(GAP, " "), known)) return null;
      const kept = step.options.filter((o) => normalizeAnswer(o) === normalizeAnswer(step.answer) || decoyAllowed(o, step.answer, known));
      if (kept.length === step.options.length) return step;
      const others = kept.filter((o) => normalizeAnswer(o) !== normalizeAnswer(step.answer));
      const extra = pickDistractors({ vi: step.answer, type: step.answer.includes(" ") ? "structure" : "word" }, pools, Math.max(0, MAX_OPTIONS_WORD - 1 - others.length), classes, rand, others);
      const distractors = [...others, ...extra];
      if (distractors.length < MIN_DISTRACTORS) return null;
      // L'ordre des options est mélangé à l'affichage : la réponse peut rester en tête.
      return { ...step, options: [step.answer, ...distractors] };
    }
    case "build_sentence": {
      const wanted = new Set(lexicalKey(step.target).split(" "));
      const tokens = step.tokens.filter((t) => lexicalKey(t).split(" ").every((w) => wanted.has(w)) || formKnown(t, known));
      return tokens.length === step.tokens.length ? step : { ...step, tokens };
    }
    case "listen_pick_image": {
      const target = content.concepts.get(step.concept);
      if (!target) return step;
      const keep = step.distractors.flatMap((id) => {
        const c = content.concepts.get(id);
        return c && known.concepts.has(id) ? [c] : [];
      });
      if (keep.length === step.distractors.length) return step;
      const knownImages = pools.known.filter((c) => c.image);
      const mates = [...keep, ...pickImageMates(target, knownImages, Math.max(0, MAX_OPTIONS_WORD - 1 - keep.length), rand, keep)];
      if (mates.length >= MIN_DISTRACTORS) return { ...step, distractors: mates.map((c) => c.id) };
      // Pas assez d'images connues : le même mot, reconnu à l'écrit plutôt qu'en image.
      const distractors = pickDistractors(target, pools, MAX_OPTIONS_WORD - 1, classes, rand);
      return distractors.length >= MIN_DISTRACTORS ? { type: "listen_pick_text", concept: target.id, distractors, ...(step.explain ? { explain: step.explain } : {}) } : null;
    }
    default:
      return step;
  }
}

const packs = packArg ? [packArg] : listPacks();
let changedLessons = 0;
let changedSteps = 0;
let removedSteps = 0;
let before = 0;
let after = 0;

for (const code of packs) {
  const files = readPackFiles(code);
  const content = buildContentIndex(toRaw(files));
  const pathOf = new Map(files.lessons.map((f) => [(f.data as Lesson).id, f.path]));
  const all = [...content.concepts.values()].sort((a, b) => a.id.localeCompare(b.id));

  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      const lesson = content.lessons.get(lessonId);
      const path = pathOf.get(lessonId);
      if (!lesson || !path) continue;
      const prior = lexiconBefore(content, lesson.id);
      const own = lexiconOf(content, lesson.review.srsIntroduce);
      const known: KnownLexicon = { concepts: new Set([...prior.concepts, ...own.concepts]), forms: new Set([...prior.forms, ...own.forms]) };
      const pools: DistractorPools = { known: all.filter((c: Concept) => known.concepts.has(c.id)), all };
      const ctx: Ctx = { content, lesson, known, pools, classes: content.pack.toneSystem?.heardClasses };

      before += unmetExposure(content, lesson, known).filter((u) => u.kind === "decoy").length;
      let touched = false;
      const steps: LessonStep[] = [];
      lesson.steps.forEach((step, i) => {
        const fixed = fixStep(ctx, step, i);
        if (fixed === null) {
          removedSteps++;
          touched = true;
          return;
        }
        if (fixed !== step) {
          changedSteps++;
          touched = true;
        }
        steps.push(fixed);
      });
      if (!touched) continue;
      lesson.steps = steps;
      // Un mot qui n'est plus la réponse d'aucune étape reste dans `concepts` : `derive-practice`
      // le reprendra (contrat phase20 §1).
      after += unmetExposure(content, lesson, known).filter((u) => u.kind === "decoy").length;
      changedLessons++;
      if (write) writeFileSync(path, `${JSON.stringify(lesson, null, 2)}\n`, "utf8");
    }
  }
}

console.log(`fix-exposure (${packs.join(", ")})${write ? "" : " — aperçu, rien n'est écrit"}`);
console.log(`  leurres inconnus avant : ${before} — restants dans les niveaux modifiés : ${after}`);
console.log(`  niveaux modifiés : ${changedLessons} — étapes corrigées : ${changedSteps} — retirées : ${removedSteps}`);
if (!write) console.log("  relancer avec --write pour appliquer, puis derive-practice.ts --write");
