import { heardClassOf, isToneMinimalPair, normalizeAnswer, toneOf } from "./text.ts";
import type { ContentIndex, Lesson, LessonStep } from "./types.ts";

/**
 * Contrôles sémantiques du contenu, au-delà des schémas JSON :
 * intégrité référentielle, règles linguistiques du pack (hỏi/ngã), cohérence
 * des exercices. Utilisé par scripts/validate-content.ts en CI.
 */

export interface ContentIssue {
  level: "error" | "warning";
  where: string;
  message: string;
}

export const CULTURE_MAX_WORDS = 60;

export function checkContent(content: ContentIndex, opts: { production?: boolean } = {}): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ level: "warning", where, message });

  checkNfc(content, err);

  // Cursus ↔ leçons
  const listed = new Map<string, string>();
  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      if (listed.has(lessonId)) err(unit.id, `Leçon ${lessonId} listée deux fois`);
      listed.set(lessonId, unit.id);
      if (!content.lessons.has(lessonId)) err(unit.id, `Leçon ${lessonId} listée mais fichier absent`);
    }
    if (unit.status === "available" && unit.lessons.length === 0) err(unit.id, `Unité publiée sans leçon`);
  }

  for (const lesson of content.lessons.values()) {
    const where = lesson.id;
    const unitOfLesson = listed.get(lesson.id);
    if (!unitOfLesson) err(where, `Leçon absente de curriculum.json`);
    else if (unitOfLesson !== lesson.unit) err(where, `Déclarée dans ${lesson.unit} mais listée dans ${unitOfLesson}`);

    for (const p of lesson.prerequisites) if (!content.lessons.has(p)) err(where, `Prérequis inconnu : ${p}`);
    for (const c of lesson.concepts) if (!content.concepts.has(c)) err(where, `Concept inconnu : ${c}`);
    for (const c of lesson.review.srsIntroduce) {
      if (!lesson.concepts.includes(c)) err(where, `srsIntroduce contient ${c}, absent de concepts`);
    }
    if (!lesson.reviewed) (opts.production ? err : warn)(where, `Leçon non relue par un locuteur natif`);

    lesson.steps.forEach((step, i) => checkStep(content, lesson, step, `${where} étape ${i + 1} (${step.type})`, err, warn));
  }

  checkPrerequisiteCycles(content, err);

  for (const concept of content.concepts.values()) {
    if (!concept.reviewed && opts.production) err(concept.id, `Concept non relu`);
    if (concept.type === "word" && concept.tone && !concept.vi.includes(" ") && toneOf(concept.vi) !== concept.tone) {
      err(concept.id, `tone "${concept.tone}" ne correspond pas à l'orthographe « ${concept.vi} » (${toneOf(concept.vi)})`);
    }
    if (concept.audio.some((a) => a.source === "tts") && (concept.type === "tone" || concept.pitch)) {
      err(concept.id, `Audio TTS interdit pour un concept de ton ou de karaoké tonal`);
    }
  }

  for (const card of content.culture.values()) {
    for (const [locale, text] of Object.entries(card.body)) {
      const words = (text ?? "").split(/\s+/).filter(Boolean).length;
      if (words > CULTURE_MAX_WORDS) err(card.id, `Corps ${locale} : ${words} mots (max ${CULTURE_MAX_WORDS})`);
    }
    if (card.question.answer >= card.question.options.length) err(card.id, `Réponse hors des options`);
  }

  return issues;
}

type Report = (where: string, message: string) => void;

function checkStep(content: ContentIndex, lesson: Lesson, step: LessonStep, where: string, err: Report, warn: Report) {
  const needConcept = (id: string) => {
    if (!content.concepts.has(id)) err(where, `Concept inconnu : ${id}`);
    else if (!lesson.concepts.includes(id)) warn(where, `Concept ${id} utilisé mais absent de lesson.concepts`);
  };

  switch (step.type) {
    case "culture_card":
      if (!content.culture.has(step.ref)) err(where, `Carte culture inconnue : ${step.ref}`);
      break;

    case "listen_pick_image":
      needConcept(step.concept);
      for (const d of step.distractors) {
        if (!content.concepts.has(d)) err(where, `Distracteur inconnu : ${d}`);
      }
      for (const id of [step.concept, ...step.distractors]) {
        if (content.concepts.get(id) && !content.concepts.get(id)?.image) err(where, `${id} n'a pas d'image`);
      }
      if (step.distractors.includes(step.concept)) err(where, `Le concept cible figure dans les distracteurs`);
      break;

    case "listen_pick_text": {
      needConcept(step.concept);
      const target = content.concepts.get(step.concept);
      if (target && step.distractors.some((d) => normalizeAnswer(d) === normalizeAnswer(target.vi))) {
        err(where, `Un distracteur est identique à la réponse`);
      }
      break;
    }

    case "tone_identify": {
      needConcept(step.concept);
      if (!content.pack.toneSystem) err(where, `Le pack n'a pas de toneSystem`);
      break;
    }

    case "tone_minimal_pair": {
      const classes = content.pack.toneSystem?.heardClasses ?? [];
      for (let i = 0; i < step.pair.length; i++) {
        for (let j = i + 1; j < step.pair.length; j++) {
          const a = step.pair[i] ?? "";
          const b = step.pair[j] ?? "";
          if (!isToneMinimalPair(a, b)) err(where, `« ${a} » / « ${b} » n'est pas une paire minimale tonale`);
          const ca = heardClassOf(toneOf(a), classes);
          if (ca !== -1 && ca === heardClassOf(toneOf(b), classes)) {
            err(where, `« ${a} » / « ${b} » : tons indiscernables à l'oreille dans ce parler (ex. hỏi/ngã au Sud)`);
          }
        }
      }
      if (step.audioConcepts) {
        if (step.audioConcepts.length !== step.pair.length) err(where, `audioConcepts doit avoir la longueur de pair`);
        step.audioConcepts.forEach((id, k) => {
          needConcept(id);
          const c = content.concepts.get(id);
          if (c && normalizeAnswer(c.vi) !== normalizeAnswer(step.pair[k] ?? "")) {
            err(where, `audioConcepts[${k}] = ${id} (« ${c.vi} ») ne correspond pas à « ${step.pair[k]} »`);
          }
        });
      } else {
        warn(where, `Pas d'audioConcepts : l'exercice n'aura pas de son`);
      }
      break;
    }

    case "build_sentence": {
      if (step.audioConcept) needConcept(step.audioConcept);
      if (!canBuild(step.target, step.tokens)) err(where, `Impossible de former « ${step.target} » avec les jetons fournis`);
      break;
    }

    case "speak_repeat":
    case "tone_produce":
    case "listen_transcribe":
      needConcept(step.concept);
      break;

    case "match_pairs":
      step.concepts.forEach(needConcept);
      break;

    case "fill_gap":
      if (!step.options.some((o) => normalizeAnswer(o) === normalizeAnswer(step.answer))) err(where, `La réponse n'est pas dans les options`);
      break;

    case "spot_the_south": {
      const entry = content.variants?.entries.find((e) => e.id === step.variant);
      if (!entry) err(where, `Variante inconnue : ${step.variant}`);
      else if (entry.severity === "none") err(where, `${step.variant} : formes identiques Nord/Sud, rien à distinguer`);
      break;
    }

    case "game":
      if (Array.isArray(step.conceptPool)) step.conceptPool.forEach(needConcept);
      break;

    case "translate_to_vi":
    case "translate_to_fr":
      break;
  }
}

/** La cible peut-elle être formée en enchaînant des jetons (chacun au plus une fois) ? */
export function canBuild(target: string, tokens: readonly string[]): boolean {
  const goal = normalizeAnswer(target);
  const parts = tokens.map(normalizeAnswer);
  const used = new Array<boolean>(parts.length).fill(false);
  const search = (rest: string): boolean => {
    if (rest === "") return true;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] ?? "";
      if (used[i] || p === "") continue;
      if (rest === p || rest.startsWith(`${p} `)) {
        used[i] = true;
        if (search(rest.slice(p.length).trimStart())) return true;
        used[i] = false;
      }
    }
    return false;
  };
  return search(goal);
}

function checkPrerequisiteCycles(content: ContentIndex, err: Report) {
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      err(id, `Cycle de prérequis : ${[...path, id].join(" → ")}`);
      return;
    }
    state.set(id, "visiting");
    for (const p of content.lessons.get(id)?.prerequisites ?? []) visit(p, [...path, id]);
    state.set(id, "done");
  };
  for (const id of content.lessons.keys()) visit(id, []);
}

/** Toute chaîne du contenu doit être en NFC (sinon comparaisons et recherche échouent). */
function checkNfc(content: ContentIndex, err: Report) {
  const walk = (value: unknown, where: string, path: string): void => {
    if (typeof value === "string") {
      if (value !== value.normalize("NFC")) err(where, `Chaîne non NFC en ${path || "(racine)"}`);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, where, `${path}[${i}]`));
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, where, path ? `${path}.${k}` : k);
    }
  };
  walk(content.pack, "pack.json", "");
  walk(content.curriculum, "curriculum.json", "");
  walk(content.variants, "lexical-variants.json", "");
  for (const l of content.lessons.values()) walk(l, l.id, "");
  for (const c of content.concepts.values()) walk(c, c.id, "");
  for (const c of content.culture.values()) walk(c, c.id, "");
}
