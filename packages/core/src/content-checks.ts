import { GAP } from "./engine.ts";
import { GRADED_STEPS_PER_LESSON, gradedSteps, unpracticedConcepts } from "./practice.ts";
import { lexiconOf, unmetDemands, unmetExposure, type KnownLexicon } from "./prerequisites.ts";
import { heardClassOf, isToneMinimalPair, normalizeAnswer, toneOf } from "./text.ts";
import {
  DIALOGUE_CHOICE_MAX_TURNS,
  DIALOGUE_CHOICE_MIN_TURNS,
  DIALOGUE_MAX_TURNS,
  hasFeature,
  ROLEPLAY_MAX_PROMPTS,
  ROLEPLAY_MIN_PROMPTS,
  TONAL_STEP_TYPES,
  type ContentIndex,
  type Lesson,
  type LessonStep,
  type LocalizedQuestion,
} from "./types.ts";

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
  checkPackFeatures(content, err);

  // Cursus ↔ leçons
  const listed = new Map<string, string>();
  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      if (listed.has(lessonId)) err(unit.id, `Leçon ${lessonId} listée deux fois`);
      listed.set(lessonId, unit.id);
      if (!content.lessons.has(lessonId)) err(unit.id, `Leçon ${lessonId} listée mais fichier absent`);
    }
    if (unit.status === "available" && unit.lessons.length === 0) err(unit.id, `Unité publiée sans leçon`);
    // Lecture préalable (contrat phase16 §3) : une fiche introuvable ne préviendrait personne —
    // la préparation la sauterait en silence.
    for (const guideId of unit.guides ?? []) if (!content.guides.has(guideId)) err(unit.id, `Fiche conseil inconnue : ${guideId}`);
  }

  for (const lesson of content.lessons.values()) {
    const where = lesson.id;
    const unitOfLesson = listed.get(lesson.id);
    if (!unitOfLesson) err(where, `Leçon absente de curriculum.json`);
    else if (unitOfLesson !== lesson.unit) err(where, `Déclarée dans ${lesson.unit} mais listée dans ${unitOfLesson}`);

    for (const p of lesson.prerequisites) if (!content.lessons.has(p)) err(where, `Prérequis inconnu : ${p}`);
    for (const guideId of lesson.guides ?? []) if (!content.guides.has(guideId)) err(where, `Fiche conseil inconnue : ${guideId}`);
    for (const c of lesson.concepts) if (!content.concepts.has(c)) err(where, `Concept inconnu : ${c}`);
    for (const c of lesson.review.srsIntroduce) {
      if (!lesson.concepts.includes(c)) err(where, `srsIntroduce contient ${c}, absent de concepts`);
    }
    if (!lesson.reviewed) (opts.production ? err : warn)(where, `Leçon non relue par un locuteur natif`);

    lesson.steps.forEach((step, i) => checkStep(content, lesson, step, `${where} étape ${i + 1} (${step.type})`, err, warn));
    checkPractice(content, lesson, where, err);
    checkGradedCount(content, lesson, where, err, warn);
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

  checkDialogues(content, opts, err, warn);
  checkGuides(content, opts, err, warn);
  checkPrerequisites(content, err);

  return issues;
}

/**
 * Garde des prérequis (contrat phase16 §1) : **aucune leçon ne fait produire un mot que rien n'a
 * présenté avant elle**.
 *
 * Sans cette garde, on écrit un `build_sentence` dont un jeton n'apparaît nulle part dans le
 * cursus amont, et l'apprenant assemble une phrase à l'aveugle. C'était le cas de 55 leçons sur
 * 194 au moment d'écrire ce contrôle ; le corpus a été corrigé, et le compte est désormais nul.
 *
 * Niveau `error`, donc : la dette est soldée, elle ne doit pas revenir. Écrire une phrase avec un
 * mot que le cursus n'a pas encore donné bloque la CI, et le message dit quoi faire — le concept
 * du pack à présenter plus tôt, ou le mot qui reste à écrire.
 */
function checkPrerequisites(content: ContentIndex, err: Report) {
  const concepts = new Set<string>();
  const forms = new Set<string>();
  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      const lesson = content.lessons.get(lessonId);
      if (!lesson) continue;
      // Ce que la leçon présente elle-même compte comme acquis : c'est le rôle de la fiche.
      const own = lexiconOf(content, lesson.review.srsIntroduce);
      const known: KnownLexicon = {
        concepts: new Set([...concepts, ...own.concepts]),
        forms: new Set([...forms, ...own.forms]),
      };
      for (const unmet of unmetExposure(content, lesson, known)) {
        const what = unmet.kind === "decoy" ? "montre en choix possible" : "cite dans un conseil";
        const fix =
          unmet.candidates.length > 0
            ? ` — à présenter plus tôt : ${unmet.candidates.join(", ")}, ou à remplacer par un mot déjà appris`
            : unmet.kind === "decoy"
              ? ` — à remplacer par un mot déjà appris`
              : ` — aucun concept du pack ne porte ce mot : l'écrire, ou le retirer du conseil`;
        err(lesson.id, `${unmet.step} ${what} « ${unmet.what} », que rien n'a présenté avant${fix}`);
      }
      for (const unmet of unmetDemands(content, lesson, known)) {
        const fix =
          unmet.candidates.length > 0
            ? ` — à présenter plus tôt : ${unmet.candidates.join(", ")}`
            : ` — aucun concept du pack ne porte ce mot : il reste à écrire`;
        err(lesson.id, `${unmet.step} fait produire « ${unmet.what} », que rien n'a présenté avant${unmet.kind === "concept" ? "" : fix}`);
      }
      for (const id of own.concepts) concepts.add(id);
      for (const form of own.forms) forms.add(form);
    }
  }
}

/**
 * Garde de la mise en pratique (contrat phase20 §1) : **aucun mot montré par une leçon n'en sort
 * sans avoir été la réponse d'au moins un exercice.**
 *
 * Sans cette garde, on écrit une leçon qui présente cinq tons et n'en fait reconnaître qu'un :
 * c'était le cas de la toute première leçon du parcours, et de 124 leçons sur 194 au moment
 * d'écrire ce contrôle. Le corpus a été corrigé (`scripts/derive-practice.ts`), et le compte est
 * désormais nul — d'où le niveau `error` : la dette est soldée, elle ne doit pas revenir.
 *
 * Le décompte ignore les étapes retirées de la séance faute d'enregistrement (voir `practice.ts`) :
 * un exercice de tons que personne ne joue ne met rien en pratique.
 */
function checkPractice(content: ContentIndex, lesson: Lesson, where: string, err: Report) {
  const missing = unpracticedConcepts(content, lesson).filter((id) => content.concepts.has(id));
  if (missing.length === 0) return;
  err(
    where,
    `Jamais mis en pratique (aucun exercice jouable dont c'est la réponse) : ${missing.join(", ")}` +
      ` — ajouter un listen_pick_text ou un match_pairs, ou retirer ces concepts de la leçon`,
  );
}

/**
 * Barème d'un niveau (contrat phase21 §1) : **20 exercices notés, ni plus ni moins**. C'est ce qui
 * rend la réussite lisible comme une note sur 20 (une bonne réponse, un point) et, surtout, ce qui
 * rend deux niveaux comparables — donc une moyenne, donc un classement des thèmes par faiblesse.
 * Avec un barème mouvant (6 à 14 exercices selon le niveau, avant ce contrat), « 6 sur 8 » et
 * « 11 sur 14 » ne se moyennent pas honnêtement.
 *
 * Le décompte est celui de `practice.ts` : étapes retirées faute d'enregistrement exclues, mini-jeu
 * exclu. C'est ce que l'apprenant voit vraiment.
 *
 * **Deux niveaux de gravité, et la différence compte.**
 *
 * *Dépasser 20 est une erreur* : le générateur sait toujours s'arrêter à 20, donc un niveau à 22 est
 * une étape écrite en trop par-dessus, et la note de ce niveau pèserait plus lourd que les autres
 * dans la moyenne.
 *
 * *Rester en dessous n'est qu'un avertissement*, parce qu'aucun script ne peut le corriger. Un
 * niveau ne peut réviser que les mots **de son thème** (voir `derive-practice.ts` : au-delà, une
 * unité téléchargée seule ne se jouerait plus hors ligne). Le niveau qui ouvre un thème n'a donc
 * rien à réviser, et le corpus n'y fait pas 20 questions sans réciter : 21 niveaux sur 197 sont dans
 * ce cas. Leur note reste sur 20 — chaque question y vaut simplement plus de points, et l'écran dit
 * sur combien de questions elle porte. Ce qui les rapprocherait de 20, ce sont des phrases d'exemple
 * et des images pour leurs mots : du contenu à écrire, pas une règle à changer.
 */
function checkGradedCount(content: ContentIndex, lesson: Lesson, where: string, err: Report, warn: Report) {
  const graded = gradedSteps(content, lesson).length;
  if (graded === GRADED_STEPS_PER_LESSON) return;
  const report = graded > GRADED_STEPS_PER_LESSON ? err : warn;
  const how = graded > GRADED_STEPS_PER_LESSON ? "il y en a" : "il en manque";
  report(
    where,
    `${graded} exercices notés au lieu de ${GRADED_STEPS_PER_LESSON} (${how} ${Math.abs(graded - GRADED_STEPS_PER_LESSON)})` +
      ` — la note de ce niveau ne pèse pas comme celle des autres ; npx tsx scripts/derive-practice.ts --write`,
  );
}

/**
 * Contrôles des fiches conseils (contrat phase15 §1).
 *
 * Une fiche est du contenu de langue : elle passe par la même relecture que le reste. Et comme elle
 * se lit sans séance, une section vide ou un exemple sans traduction n'y serait rattrapé par rien.
 */
function checkGuides(content: ContentIndex, opts: { production?: boolean }, err: Report, warn: Report) {
  for (const guide of content.guides.values()) {
    const where = guide.id;
    if ((guide.title.fr ?? "").trim() === "") err(where, `Titre français manquant`);
    if ((guide.summary.fr ?? "").trim() === "") err(where, `Résumé français manquant`);
    if (guide.sections.length === 0) err(where, `Fiche sans section`);
    guide.sections.forEach((section, i) => {
      const at = `${where} section ${i + 1}`;
      if ((section.heading.fr ?? "").trim() === "") err(at, `Titre de section manquant`);
      if ((section.body.fr ?? "").trim() === "") err(at, `Section vide`);
      for (const example of section.examples ?? []) {
        if (example.vi.trim() === "") err(at, `Exemple sans vietnamien`);
        if (example.fr.trim() === "") err(at, `Exemple sans traduction française : ${example.vi}`);
      }
    });
    if (!guide.reviewed) (opts.production ? err : warn)(where, `Fiche conseil non relue par un locuteur natif`);
  }
}

/** Contrôles des dialogues (contrat phase6 §3) : longueur, traductions, question, audio. */
function checkDialogues(content: ContentIndex, opts: { production?: boolean }, err: Report, warn: Report) {
  for (const dialogue of content.dialogues.values()) {
    const where = dialogue.id;
    if (dialogue.turns.length === 0) err(where, `Dialogue sans réplique`);
    if (dialogue.turns.length > DIALOGUE_MAX_TURNS) {
      err(where, `${dialogue.turns.length} répliques (max ${DIALOGUE_MAX_TURNS} : un dialogue de 15 s)`);
    }
    dialogue.turns.forEach((turn, i) => {
      const at = `${where} réplique ${i + 1}`;
      if (turn.speaker.trim() === "") err(at, `Locuteur vide`);
      if (turn.vi.trim() === "") err(at, `Réplique vide`);
      if ((turn.translation.fr ?? "").trim() === "") err(at, `Traduction française manquante`);
      if (turn.audio !== undefined && !mediaPresent(content, turn.audio)) err(at, `Audio absent du pack : ${turn.audio}`);
    });
    // Sans audio complet, `listen_gist` serait retiré de toutes les séances (règle médias).
    if (dialogue.turns.some((t) => t.audio === undefined)) warn(where, `Répliques sans audio : le dialogue ne sera pas jouable à l'écoute`);
    if (dialogue.question) checkQuestion(dialogue.question, where, err);
    else warn(where, `Dialogue sans question : inutilisable en listen_gist`);
    if (!dialogue.reviewed) (opts.production ? err : warn)(where, `Dialogue non relu par un locuteur natif`);
  }
}

/** Un média référencé est-il présent ? `mediaIndex` absent (tests sur disque) = tout est présent. */
function mediaPresent(content: ContentIndex, path: string): boolean {
  return content.mediaIndex === undefined || content.mediaIndex.has(path);
}

function checkQuestion(question: LocalizedQuestion, where: string, err: Report) {
  if (question.answer < 0 || question.answer >= question.options.length) err(where, `Réponse hors des options`);
  if (question.options.length < 2) err(where, `Question à moins de 2 options`);
}

type Report = (where: string, message: string) => void;

/** Contrôle d'une étape hors de son fichier de leçon (examens : leçon synthétique). */
export function checkLessonStep(content: ContentIndex, lesson: Lesson, step: LessonStep, where: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  checkStep(content, lesson, step, where, (w, message) => issues.push({ level: "error", where: w, message }), (w, message) => issues.push({ level: "warning", where: w, message }));
  return issues;
}

/**
 * Cohérence entre `pack.features` et le contenu (ADR 0006) : un pack sans tons ne
 * contient ni système tonal, ni exercice de tons, ni concept marqué d'un ton ; un pack
 * sans variantes régionales n'a pas d'exercice « repère la forme régionale ».
 * Les identifiants de leçon et d'unité portent le code du pack (pas de collision entre packs).
 */
function checkPackFeatures(content: ContentIndex, err: Report) {
  const { pack, curriculum } = content;
  const tonal = hasFeature(pack, "tones");
  if (tonal && !pack.toneSystem) err("pack.json", `features contient "tones" mais toneSystem est absent`);
  if (!tonal && pack.toneSystem) err("pack.json", `toneSystem présent sans la feature "tones"`);
  if (hasFeature(pack, "lexical_variants") && !content.variants) err("pack.json", `features contient "lexical_variants" mais lexical-variants.json est absent`);
  if (curriculum.pack !== pack.code) err("curriculum.json", `pack "${curriculum.pack}" ≠ code du pack "${pack.code}"`);
  const prefix = `${pack.code}.`;
  for (const unit of curriculum.units) {
    if (!unit.id.startsWith(prefix)) err(unit.id, `L'identifiant d'unité doit commencer par ${prefix}`);
  }
  for (const lesson of content.lessons.values()) {
    if (!lesson.id.startsWith(prefix)) err(lesson.id, `L'identifiant de leçon doit commencer par ${prefix}`);
  }
  if (!tonal) {
    for (const concept of content.concepts.values()) {
      if (concept.tone || concept.type === "tone") err(concept.id, `Ton déclaré dans un pack sans la feature "tones"`);
    }
  }
}

function checkStep(content: ContentIndex, lesson: Lesson, step: LessonStep, where: string, err: Report, warn: Report) {
  const needConcept = (id: string) => {
    if (!content.concepts.has(id)) err(where, `Concept inconnu : ${id}`);
    else if (!lesson.concepts.includes(id)) warn(where, `Concept ${id} utilisé mais absent de lesson.concepts`);
  };
  if (TONAL_STEP_TYPES.has(step.type) && !hasFeature(content.pack, "tones")) {
    err(where, `Exercice de tons dans un pack sans la feature "tones"`);
    return;
  }
  if (step.type === "spot_the_south" && !hasFeature(content.pack, "lexical_variants")) {
    err(where, `spot_the_south dans un pack sans la feature "lexical_variants"`);
    return;
  }
  if (step.type === "game" && step.game === "karaoke_tonal" && !hasFeature(content.pack, "tones")) {
    err(where, `Karaoké tonal dans un pack sans la feature "tones"`);
    return;
  }

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

    case "match_pairs": {
      step.concepts.forEach(needConcept);
      const concepts = step.concepts.flatMap((id) => content.concepts.get(id) ?? []);
      const mode = step.mode ?? "text_gloss";
      if (mode === "audio_image") {
        for (const c of concepts) if (!c.image) err(where, `${c.id} n'a pas d'image (mode audio_image)`);
      }
      // Deux cartes identiques d'un côté rendraient l'appariement arbitraire.
      const rights = mode === "text_gloss" ? concepts.map((c) => c.gloss.fr) : concepts.map((c) => normalizeAnswer(c.vi));
      for (const [i, value] of rights.entries()) {
        if (rights.indexOf(value) !== i) err(where, `Deux cartes portent « ${value} » : appariement ambigu`);
      }
      break;
    }

    case "fill_gap":
      if (!step.text.includes(GAP)) err(where, `Le texte ne contient pas le trou « ${GAP} »`);
      if (!step.options.some((o) => normalizeAnswer(o) === normalizeAnswer(step.answer))) err(where, `La réponse n'est pas dans les options`);
      for (const [i, o] of step.options.entries()) {
        if (step.options.findIndex((x) => normalizeAnswer(x) === normalizeAnswer(o)) !== i) err(where, `Option « ${o} » en double`);
      }
      break;

    case "listen_gist": {
      const dialogue = content.dialogues.get(step.dialogue);
      if (!dialogue) err(where, `Dialogue inconnu : ${step.dialogue}`);
      else if (!dialogue.question) err(where, `${step.dialogue} n'a pas de question de compréhension`);
      break;
    }

    case "speak_answer": {
      step.accepted.forEach(needConcept);
      if (step.accepted.length === 0) err(where, `Aucune réponse acceptée`);
      if (step.prompt.trim() === "") err(where, `Question vide`);
      if (step.audio !== undefined && !mediaPresent(content, step.audio)) err(where, `Audio absent du pack : ${step.audio}`);
      const graded = step.accepted.some((id) => {
        const pitch = content.concepts.get(id)?.pitch;
        return pitch !== undefined && mediaPresent(content, pitch);
      });
      if (!graded) warn(where, `Aucune réponse acceptée n'a de courbe F0 : l'exercice ne sera pas noté`);
      break;
    }

    case "speak_roleplay": {
      step.prompts.forEach((p) => needConcept(p.concept));
      if (step.prompts.length < ROLEPLAY_MIN_PROMPTS || step.prompts.length > ROLEPLAY_MAX_PROMPTS) {
        err(where, `${step.prompts.length} consignes (attendu ${ROLEPLAY_MIN_PROMPTS} à ${ROLEPLAY_MAX_PROMPTS})`);
      }
      if (!step.prompts.some((p) => content.concepts.get(p.concept)?.pitch)) {
        warn(where, `Aucune réplique n'a de courbe F0 : le jeu de rôle ne sera pas noté`);
      }
      break;
    }

    case "dialogue_choice":
      checkDialogueChoice(content, step, where, err, warn);
      break;

    case "translate_to_vi":
      if (step.accepted.length === 0) err(where, `Aucune traduction acceptée`);
      break;

    case "translate_to_fr":
      for (const [locale, forms] of Object.entries(step.accepted)) {
        if (!forms || forms.length === 0 || forms.some((f) => f.trim() === "")) err(where, `accepted.${locale} vide`);
      }
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
  }
}

/**
 * Dialogue à embranchements : 3 à 5 tours, identifiants uniques, `next` qui pointe sur un tour
 * existant (jamais sur lui-même), tours atteignables depuis le premier, au moins un meilleur choix.
 */
function checkDialogueChoice(content: ContentIndex, step: Extract<LessonStep, { type: "dialogue_choice" }>, where: string, err: Report, warn: Report) {
  const { turns } = step;
  if (turns.length < DIALOGUE_CHOICE_MIN_TURNS || turns.length > DIALOGUE_CHOICE_MAX_TURNS) {
    err(where, `${turns.length} tours (attendu ${DIALOGUE_CHOICE_MIN_TURNS} à ${DIALOGUE_CHOICE_MAX_TURNS})`);
  }
  const ids = new Set<string>();
  const replyIds = new Set<string>();
  for (const turn of turns) {
    if (ids.has(turn.id)) err(where, `Tour ${turn.id} en double`);
    ids.add(turn.id);
  }
  for (const turn of turns) {
    const at = `${where} tour ${turn.id}`;
    if (turn.replies.length < 2 || turn.replies.length > 3) err(at, `${turn.replies.length} réponses (attendu 2 ou 3)`);
    if ((turn.translation.fr ?? "").trim() === "") err(at, `Traduction française manquante`);
    if (turn.audio !== undefined && !mediaPresent(content, turn.audio)) err(at, `Audio absent du pack : ${turn.audio}`);
    for (const reply of turn.replies) {
      if (replyIds.has(reply.id) || ids.has(reply.id)) err(at, `Identifiant de réponse ${reply.id} en double`);
      replyIds.add(reply.id);
      if (reply.vi === undefined && reply.translation === undefined) err(at, `Réponse ${reply.id} sans texte`);
      if (reply.next !== undefined && !ids.has(reply.next)) err(at, `Réponse ${reply.id} : tour suivant inconnu (${reply.next})`);
      if (reply.next === turn.id) err(at, `Réponse ${reply.id} : boucle sur son propre tour`);
    }
    if (!turn.replies.some((r) => r.best)) warn(at, `Aucun meilleur choix : ce tour ne compte pas dans la note`);
  }
  // Tours orphelins : le joueur ne les verra jamais.
  const reachable = new Set<string>();
  const visit = (id: string | undefined) => {
    if (id === undefined || reachable.has(id)) return;
    reachable.add(id);
    for (const reply of turns.find((t) => t.id === id)?.replies ?? []) visit(reply.next);
  };
  visit(turns[0]?.id);
  for (const turn of turns) if (!reachable.has(turn.id)) warn(where, `Tour ${turn.id} inatteignable depuis le premier`);
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
  for (const d of content.dialogues.values()) walk(d, d.id, "");
}
