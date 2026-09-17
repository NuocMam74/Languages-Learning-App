import { describe, expect, it } from "vitest";
import { checkContent, checkLessonStep } from "./content-checks.ts";
import {
  buildExercise,
  currentItem,
  evaluate,
  GAP,
  isFinished,
  lessonScore,
  PARTIAL_NEAR_MISS_RATIO,
  recordResult,
  SPEAK_PASS_SCORE,
  startLesson,
  type Exercise,
  type ExerciseResponse,
} from "./engine.ts";
import { isStepPlayable, playableStepIndexes } from "./media.ts";
import { loadPack } from "./testing/pack.ts";
import type { ContentIndex, Dialogue, Lesson, LessonStep } from "./types.ts";

/**
 * Catalogue d'exercices de la spec §4.4 (contrat phase6) : construction déterministe,
 * notation, « presque juste », règles de médias. Les étapes sont synthétiques : le contenu
 * réel ne les utilise pas encore, le moteur doit pourtant les jouer.
 */

const pack = loadPack();
const model = pack.lessons.get("vi-south.u01.l03") ?? [...pack.lessons.values()][0]!;

function lessonWith(steps: LessonStep[], concepts: string[] = model.concepts): Lesson {
  return { ...model, concepts: [...new Set([...model.concepts, ...concepts])], steps };
}

function build(step: LessonStep, seed = "s", content: ContentIndex = pack): Exercise {
  return buildExercise(content, lessonWith([step]), 0, seed);
}

const dialogue: Dialogue = {
  id: "dlg_cho_noi",
  title: { fr: "Au marché flottant" },
  turns: [
    { speaker: "Cô Mai", vi: "Chào anh, mua gì?", translation: { fr: "Bonjour, vous achetez quoi ?" }, audio: "audio/dlg1.opus" },
    { speaker: "Anh Nam", vi: "Cho tôi hai ký xoài.", translation: { fr: "Donnez-moi deux kilos de mangues." }, audio: "audio/dlg2.opus" },
  ],
  question: {
    prompt: { fr: "Que demande Nam ?" },
    options: [{ fr: "Des mangues" }, { fr: "Du café" }, { fr: "Un taxi" }],
    answer: 0,
    explain: { fr: "« xoài » = mangue." },
  },
  reviewed: true,
};

const withDialogue = (d: Dialogue = dialogue, content = pack): ContentIndex => ({ ...content, dialogues: new Map([[d.id, d]]) });

// ---------------------------------------------------------------------------

describe("listen_transcribe", () => {
  const step: LessonStep = { type: "listen_transcribe", concept: "c_ma_mom", accepted: ["Má"] };

  it("se construit avec l'audio du concept et la forme de référence en tête", () => {
    const ex = build(step);
    if (ex.type !== "listen_transcribe") throw new Error(ex.type);
    expect(ex.audio.id).toBe("c_ma_mom");
    expect(ex.accepted[0]).toBe("má");
    expect(ex.conceptIds).toEqual(["c_ma_mom"]);
    expect(ex.explain?.fr).toContain("Au Sud");
  });

  it("est déterministe", () => {
    expect(build(step, "z")).toEqual(build(step, "z"));
  });

  it("note la transcription : juste, ton seul, diacritique seul, faux", () => {
    const ex = build(step);
    expect(evaluate(ex, { kind: "text", text: " Má ! " })).toMatchObject({ correct: true, graded: true, match: "correct" });
    expect(evaluate(ex, { kind: "text", text: "mà" })).toMatchObject({ correct: false, nearMiss: true, match: "tone_only", expected: "má" });
    expect(evaluate(ex, { kind: "text", text: "ba" })).toMatchObject({ correct: false, nearMiss: false, match: "wrong", graded: true });
  });

  it("accepte les formes alternatives déclarées", () => {
    const ex = build({ type: "listen_transcribe", concept: "c_ma_mom", accepted: ["má ơi"] });
    expect(evaluate(ex, { kind: "text", text: "má ơi" })).toMatchObject({ correct: true });
  });

  it("une réponse d'une autre forme n'est pas notée mais reste fausse", () => {
    expect(evaluate(build(step), { kind: "choice", optionId: "x" })).toMatchObject({ correct: false, graded: false });
  });

  it("sans audio natif, l'étape est retirée de la séance (comme les étapes tonales)", () => {
    const noMedia: ContentIndex = { ...pack, mediaIndex: new Set<string>() };
    expect(isStepPlayable(noMedia, step)).toBe(false);
    // Le repli de synthèse ne rattrape pas une transcription : on ne transcrit pas une voix de synthèse.
    expect(isStepPlayable(noMedia, step, { toneFallback: true })).toBe(false);
    expect(isStepPlayable(pack, step)).toBe(true);
    const lesson = lessonWith([{ type: "culture_card", ref: "cc_ba_mien" }, step]);
    expect(playableStepIndexes(noMedia, lesson)).toEqual([0]);
  });
});

describe("listen_gist", () => {
  const step: LessonStep = { type: "listen_gist", dialogue: "dlg_cho_noi" };
  const content = withDialogue();

  it("expose le dialogue et la question, options dans l'ordre du fichier", () => {
    const ex = build(step, "s", content);
    if (ex.type !== "listen_gist") throw new Error(ex.type);
    expect(ex.dialogue.turns).toHaveLength(2);
    expect(ex.options.map((o) => o.label?.fr)).toEqual(["Des mangues", "Du café", "Un taxi"]);
    expect(ex.answerId).toBe("0");
    expect(ex.explain?.fr).toContain("xoài");
  });

  it("est noté comme un QCM (contrairement à la carte culture)", () => {
    const ex = build(step, "s", content);
    expect(evaluate(ex, { kind: "choice", optionId: "0" })).toMatchObject({ correct: true, graded: true });
    expect(evaluate(ex, { kind: "choice", optionId: "1" })).toMatchObject({ correct: false, graded: true });
  });

  it("dialogue absent ou sans question : erreur de contenu", () => {
    expect(() => build(step)).toThrow(/Dialogue inconnu/);
    const { question: _q, ...noQuestion } = dialogue;
    expect(() => build(step, "s", withDialogue(noQuestion))).toThrow(/sans question/);
  });

  it("un tour sans audio présent rend l'étape injouable", () => {
    const media = new Set(["audio/dlg1.opus", "audio/dlg2.opus"]);
    expect(isStepPlayable({ ...content, mediaIndex: media }, step)).toBe(true);
    expect(isStepPlayable({ ...content, mediaIndex: new Set(["audio/dlg1.opus"]) }, step)).toBe(false);
  });
});

describe("match_pairs", () => {
  const step: LessonStep = { type: "match_pairs", concepts: ["c_ma_mom", "c_ba", "c_toi"] };

  it("deux colonnes des mêmes concepts, mélangées indépendamment", () => {
    const ex = build(step);
    if (ex.type !== "match_pairs") throw new Error(ex.type);
    expect(ex.mode).toBe("text_gloss");
    expect(ex.left.map((o) => o.conceptId).sort()).toEqual(["c_ba", "c_ma_mom", "c_toi"]);
    expect(ex.right.map((o) => o.label?.fr).every(Boolean)).toBe(true);
    expect(new Set([...ex.left, ...ex.right].map((o) => o.id)).size).toBe(6);
    expect(ex.answer).toHaveLength(3);
    expect(ex.conceptIds).toEqual(["c_ma_mom", "c_ba", "c_toi"]);
    expect(build(step, "s")).toEqual(build(step, "s"));
  });

  it("mode audio_text : la colonne à écouter ne montre aucun texte", () => {
    const ex = build({ ...step, mode: "audio_text" } as LessonStep);
    if (ex.type !== "match_pairs") throw new Error(ex.type);
    expect(ex.left.every((o) => o.text === undefined && o.label === undefined)).toBe(true);
    expect(ex.right.every((o) => typeof o.text === "string")).toBe(true);
  });

  it("tout juste pour réussir, « presque » au-delà du seuil partiel", () => {
    const ex = build(step);
    if (ex.type !== "match_pairs") throw new Error(ex.type);
    expect(evaluate(ex, { kind: "pairs", pairs: ex.answer })).toMatchObject({ correct: true, graded: true });

    const [first, second, third] = ex.answer;
    const swapped = [first!, { leftId: second!.leftId, rightId: third!.rightId }, { leftId: third!.leftId, rightId: second!.rightId }];
    const partial = evaluate(ex, { kind: "pairs", pairs: swapped });
    expect(partial).toMatchObject({ correct: false, graded: true });
    expect(partial.nearMiss).toBe(1 / 3 >= PARTIAL_NEAR_MISS_RATIO);
    expect(partial.expected).toContain("→");

    expect(evaluate(ex, { kind: "pairs", pairs: [] })).toMatchObject({ correct: false, nearMiss: false, graded: true });
  });

  it("4 paires sur 5 = « presque » (70 % atteint)", () => {
    const five: LessonStep = { type: "match_pairs", concepts: ["c_ma_mom", "c_ba", "c_toi", "c_ma_tomb", "c_ma_but"] };
    const ex = build(five);
    if (ex.type !== "match_pairs") throw new Error(ex.type);
    const wrongLast = ex.answer.slice(0, 4).concat({ leftId: ex.answer[4]!.leftId, rightId: ex.answer[0]!.rightId });
    expect(evaluate(ex, { kind: "pairs", pairs: wrongLast })).toMatchObject({ correct: false, nearMiss: true });
  });

  it("une association en double ne compte qu'une fois", () => {
    const ex = build(step);
    if (ex.type !== "match_pairs") throw new Error(ex.type);
    const cheat = [{ leftId: ex.answer[0]!.leftId, rightId: ex.answer[1]!.rightId }, ...ex.answer];
    expect(evaluate(ex, { kind: "pairs", pairs: cheat })).toMatchObject({ correct: false });
  });
});

describe("fill_gap", () => {
  const step: LessonStep = {
    type: "fill_gap",
    text: `Đây là ${GAP} tôi.`,
    answer: "má",
    options: ["má", "mà", "mã"],
    translation: { fr: "Voici ma mère." },
  };

  it("mélange les options et retrouve la bonne réponse", () => {
    const ex = build(step);
    if (ex.type !== "fill_gap") throw new Error(ex.type);
    expect(ex.options).toHaveLength(3);
    expect(ex.options.find((o) => o.id === ex.answerId)?.text).toBe("má");
    expect(ex.text).toContain(GAP);
    expect(ex.translation?.fr).toBe("Voici ma mère.");
    expect(build(step, "s")).toEqual(build(step, "s"));
  });

  it("rattache la phrase aux concepts de la leçon (SRS)", () => {
    const ex = build(step);
    expect(ex.conceptIds).toContain("c_ma_mom");
  });

  it("une confusion de ton est « presque juste »", () => {
    const ex = build(step);
    if (ex.type !== "fill_gap") throw new Error(ex.type);
    const wrong = ex.options.find((o) => o.text === "mà")!;
    expect(evaluate(ex, { kind: "choice", optionId: ex.answerId })).toMatchObject({ correct: true, graded: true });
    expect(evaluate(ex, { kind: "choice", optionId: wrong.id })).toMatchObject({ correct: false, nearMiss: true, graded: true, expected: "má" });
  });
});

describe("translate_to_vi", () => {
  const step: LessonStep = { type: "translate_to_vi", source: { fr: "Voici ma mère." }, accepted: ["Đây là má tôi.", "Đây là má của tôi."] };

  it("garde la source localisée et les formes acceptées", () => {
    const ex = build(step);
    if (ex.type !== "translate_to_vi") throw new Error(ex.type);
    expect(ex.source.fr).toBe("Voici ma mère.");
    expect(ex.accepted).toHaveLength(2);
  });

  it("tolère casse et ponctuation, signale l'erreur de ton", () => {
    const ex = build(step);
    expect(evaluate(ex, { kind: "text", text: "đây là má tôi" })).toMatchObject({ correct: true, graded: true });
    expect(evaluate(ex, { kind: "text", text: "Đây là má của tôi." })).toMatchObject({ correct: true });
    expect(evaluate(ex, { kind: "text", text: "Đây là mà tôi." })).toMatchObject({ correct: false, nearMiss: true, match: "tone_only" });
    expect(evaluate(ex, { kind: "text", text: "Day la ma toi." })).toMatchObject({ correct: false, nearMiss: true, match: "diacritics_only" });
    expect(evaluate(ex, { kind: "text", text: "Tôi ăn cơm." })).toMatchObject({ correct: false, nearMiss: false });
  });
});

describe("translate_to_fr", () => {
  const step: LessonStep = {
    type: "translate_to_fr",
    source: "Đây là má tôi.",
    accepted: { fr: ["Voici ma mère.", "C'est ma mère."], en: ["This is my mom."] },
  };

  it("comparaison relâchée : accents, ponctuation et casse facultatifs", () => {
    const ex = build(step);
    if (ex.type !== "translate_to_fr") throw new Error(ex.type);
    expect(ex.source).toBe("Đây là má tôi.");
    expect(evaluate(ex, { kind: "text", text: "voici ma mere" })).toMatchObject({ correct: true, graded: true, expected: "Voici ma mère." });
    expect(evaluate(ex, { kind: "text", text: "C'est ma mère !" })).toMatchObject({ correct: true });
    expect(evaluate(ex, { kind: "text", text: "This is my mom" })).toMatchObject({ correct: true });
    expect(evaluate(ex, { kind: "text", text: "Voici mon père" })).toMatchObject({ correct: false, graded: true });
    expect(evaluate(ex, { kind: "text", text: "  " })).toMatchObject({ correct: false });
  });

  it("l'article initial est facultatif", () => {
    const ex = build({ type: "translate_to_fr", source: "xoài", accepted: { fr: ["la mangue"] } });
    expect(evaluate(ex, { kind: "text", text: "mangue" })).toMatchObject({ correct: true });
    expect(evaluate(ex, { kind: "text", text: "une mangue" })).toMatchObject({ correct: true });
  });
});

describe("speak_answer", () => {
  const step: LessonStep = {
    type: "speak_answer",
    prompt: "Đây là ai?",
    translation: { fr: "Qui est-ce ?" },
    accepted: ["s_day_la", "c_ma_mom"],
  };

  it("expose la question, les réponses acceptées et la courbe de référence", () => {
    const ex = build(step);
    if (ex.type !== "speak_answer") throw new Error(ex.type);
    expect(ex.prompt).toBe("Đây là ai?");
    expect(ex.accepted.map((c) => c.id)).toEqual(["s_day_la", "c_ma_mom"]);
    expect(ex.pitchRef).toBe("pitch/s_day_la.json");
    expect(ex.conceptIds).toEqual(["s_day_la", "c_ma_mom"]);
  });

  it("noté comme speak_repeat quand une courbe existe", () => {
    const ex = build(step);
    expect(evaluate(ex, { kind: "speech", score: 90 })).toMatchObject({ correct: true, graded: true, expected: "Đây là…" });
    expect(evaluate(ex, { kind: "speech", score: SPEAK_PASS_SCORE - 5 })).toMatchObject({ correct: false, nearMiss: true, graded: true });
    expect(evaluate(ex, { kind: "speech", score: null })).toMatchObject({ correct: true, graded: false });
  });

  it("sans courbe de référence : entraînement libre, jamais noté", () => {
    const ex = build({ type: "speak_answer", prompt: "Đây là ai?", translation: { fr: "Qui ?" }, accepted: ["c_ma_mom"] });
    if (ex.type !== "speak_answer") throw new Error(ex.type);
    expect(ex.pitchRef).toBeNull();
    expect(evaluate(ex, { kind: "speech", score: 20 })).toMatchObject({ correct: true, graded: false });
  });

  it("courbe absente du pack (média manquant) : non noté", () => {
    const noPitch: ContentIndex = { ...pack, mediaIndex: new Set(["audio/c_ma_mom_mai.opus"]) };
    const ex = buildExercise(noPitch, lessonWith([step]), 0, "s");
    if (ex.type !== "speak_answer") throw new Error(ex.type);
    expect(ex.pitchRef).toBeNull();
    // L'étape reste jouable : elle devient de l'écoute (comme speak_repeat sans courbe).
    expect(isStepPlayable(noPitch, step)).toBe(true);
  });
});

describe("speak_roleplay", () => {
  const step: LessonStep = {
    type: "speak_roleplay",
    situation: { fr: "Tu arrives au marché." },
    prompts: [
      { cue: { fr: "Salue la vendeuse." }, concept: "s_day_la" },
      { cue: { fr: "Présente ta mère." }, concept: "c_ma_mom" },
    ],
  };

  it("résout les concepts et leurs courbes", () => {
    const ex = build(step);
    if (ex.type !== "speak_roleplay") throw new Error(ex.type);
    expect(ex.prompts.map((p) => p.concept.id)).toEqual(["s_day_la", "c_ma_mom"]);
    expect(ex.prompts[0]?.pitchRef).toBe("pitch/s_day_la.json");
    expect(ex.prompts[1]?.pitchRef).toBeNull();
    expect(ex.situation.fr).toBe("Tu arrives au marché.");
  });

  it("noté dès qu'une réplique a une courbe, sinon entraînement libre", () => {
    const ex = build(step);
    expect(evaluate(ex, { kind: "speech", score: 75 })).toMatchObject({ correct: true, graded: true });
    expect(evaluate(ex, { kind: "speech", score: null })).toMatchObject({ graded: false });

    const free = build({ ...step, prompts: [{ cue: { fr: "Dis maman." }, concept: "c_ma_mom" }, { cue: { fr: "Encore." }, concept: "c_ba" }] } as LessonStep);
    expect(evaluate(free, { kind: "speech", score: 10 })).toMatchObject({ correct: true, graded: false });
  });
});

describe("dialogue_choice", () => {
  const step: LessonStep = {
    type: "dialogue_choice",
    situation: { fr: "Au marché." },
    turns: [
      {
        id: "t1", vi: "Chào em!", translation: { fr: "Bonjour !" },
        replies: [
          { id: "r1a", vi: "Dạ, chào cô.", next: "t2", best: true },
          { id: "r1b", vi: "Ờ.", next: "t2" },
        ],
      },
      {
        id: "t2", vi: "Mua gì?", translation: { fr: "Tu achètes quoi ?" },
        replies: [
          { id: "r2a", vi: "Cho tôi hai ký xoài.", next: "t3", best: true },
          { id: "r2b", translation: { fr: "(ne rien dire)" }, next: "t3" },
        ],
      },
      {
        id: "t3", vi: "Bốn chục ngàn.", translation: { fr: "Quarante mille." },
        replies: [
          { id: "r3a", vi: "Cảm ơn cô.", best: true, feedback: { fr: "Poli et naturel." } },
          { id: "r3b", vi: "Mắc quá!" },
        ],
      },
    ],
  };

  it("mélange les réponses de chaque tour, garde la structure", () => {
    const ex = build(step);
    if (ex.type !== "dialogue_choice") throw new Error(ex.type);
    expect(ex.startId).toBe("t1");
    expect(ex.turns.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(ex.bestReplyIds.sort()).toEqual(["r1a", "r2a", "r3a"]);
    expect(ex.turns[1]?.replies.map((r) => r.id).sort()).toEqual(["r2a", "r2b"]);
    expect(ex.turns[1]?.replies.find((r) => r.id === "r2b")?.vi).toBeNull();
    expect(ex.turns[2]?.replies.find((r) => r.id === "r3a")?.feedback?.fr).toBe("Poli et naturel.");
    expect(ex.turns[0]?.replies.find((r) => r.id === "r1a")?.next).toBe("t2");
    expect(build(step, "s")).toEqual(build(step, "s"));
  });

  it("noté sur le nombre de meilleurs choix", () => {
    const ex = build(step);
    expect(evaluate(ex, { kind: "path", turnIds: ["r1a", "r2a", "r3a"] })).toMatchObject({ correct: true, graded: true });
    const two = evaluate(ex, { kind: "path", turnIds: ["r1a", "r2a", "r3b"] });
    expect(two).toMatchObject({ correct: false, graded: true });
    expect(two.nearMiss).toBe(2 / 3 >= PARTIAL_NEAR_MISS_RATIO);
    expect(evaluate(ex, { kind: "path", turnIds: ["r1b", "r2b", "r3b"] })).toMatchObject({ correct: false, nearMiss: false });
  });

  it("3 bons choix sur 4 = « presque » (seuil partiel atteint)", () => {
    const four = structuredClone(step) as Extract<LessonStep, { type: "dialogue_choice" }>;
    four.turns[2]!.replies[0]!.next = "t4";
    four.turns.push({
      id: "t4", vi: "Hẹn gặp lại!", translation: { fr: "À bientôt !" },
      replies: [{ id: "r4a", vi: "Dạ, chào cô.", best: true }, { id: "r4b", vi: "Ừ." }],
    });
    const ex = build(four);
    expect(evaluate(ex, { kind: "path", turnIds: ["r1a", "r2a", "r3a", "r4b"] })).toMatchObject({ correct: false, nearMiss: true, graded: true });
  });

  it("chemin plus court : noté sur les tours joués", () => {
    const ex = build(step);
    expect(evaluate(ex, { kind: "path", turnIds: ["r1a"] })).toMatchObject({ correct: true, graded: true });
    expect(evaluate(ex, { kind: "path", turnIds: ["inconnu"] })).toMatchObject({ correct: false, graded: false });
  });

  it("aucun meilleur choix déclaré : dialogue d'exploration, non noté", () => {
    const free = structuredClone(step) as Extract<LessonStep, { type: "dialogue_choice" }>;
    for (const turn of free.turns) for (const reply of turn.replies) delete reply.best;
    const ex = build(free);
    expect(evaluate(ex, { kind: "path", turnIds: ["r1a"] })).toMatchObject({ correct: true, graded: false });
  });
});

// ---------------------------------------------------------------------------

describe("déroulé d'une leçon composée des nouveaux types", () => {
  const steps: LessonStep[] = [
    { type: "listen_transcribe", concept: "c_ma_mom" },
    { type: "listen_gist", dialogue: "dlg_cho_noi" },
    { type: "fill_gap", text: `Đây là ${GAP} tôi.`, answer: "má", options: ["má", "mà"] },
    { type: "translate_to_vi", source: { fr: "Voici ma mère." }, accepted: ["Đây là má tôi."] },
    { type: "translate_to_fr", source: "Đây là má tôi.", accepted: { fr: ["Voici ma mère."] } },
    { type: "match_pairs", concepts: ["c_ma_mom", "c_ba", "c_toi"] },
    { type: "speak_answer", prompt: "Đây là ai?", translation: { fr: "Qui ?" }, accepted: ["s_day_la"] },
  ];
  const lesson = lessonWith(steps, ["c_ma_mom", "c_ba", "c_toi", "s_day_la"]);
  const content = withDialogue();

  it("un élève parfait termine en une passe, tout est noté", () => {
    let run = startLesson(lesson, "sess", new Date("2026-09-16T08:00:00Z"));
    while (!isFinished(run)) {
      const item = currentItem(run)!;
      const ex = buildExercise(content, lesson, item.stepIndex, run.sessionId);
      const ev = evaluate(ex, rightAnswer(ex));
      expect(ev.graded).toBe(true);
      run = recordResult(run, ex, ev, 2000);
    }
    expect(run.results).toHaveLength(steps.length);
    expect(lessonScore(run)).toBe(1);
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });

  it("chaque erreur relance son étape une fois", () => {
    let run = startLesson(lesson, "sess", new Date("2026-09-16T08:00:00Z"));
    const ex = buildExercise(content, lesson, 0, run.sessionId);
    run = recordResult(run, ex, evaluate(ex, { kind: "text", text: "ba" }), 1000);
    expect(run.queue.at(-1)).toEqual({ stepIndex: 0, attempt: 2 });
    expect(lessonScore(run)).toBe(0);
  });

  it("les concepts des nouveaux types remontent bien au SRS", () => {
    const ids = steps.map((s, i) => buildExercise(content, lesson, i, "s").conceptIds);
    expect(ids[0]).toEqual(["c_ma_mom"]);
    expect(ids[2]).toContain("c_ma_mom");
    expect(ids[5]).toEqual(["c_ma_mom", "c_ba", "c_toi"]);
    expect(ids[6]).toEqual(["s_day_la"]);
  });
});

/** Réponse juste pour chacun des nouveaux types. */
function rightAnswer(ex: Exercise): ExerciseResponse {
  switch (ex.type) {
    case "listen_transcribe":
    case "translate_to_vi":
      return { kind: "text", text: ex.accepted[0] ?? "" };
    case "translate_to_fr":
      return { kind: "text", text: ex.accepted.fr[0] ?? "" };
    case "match_pairs":
      return { kind: "pairs", pairs: ex.answer };
    case "speak_answer":
    case "speak_roleplay":
      return { kind: "speech", score: 90 };
    case "dialogue_choice":
      return { kind: "path", turnIds: ex.bestReplyIds };
    default:
      return { kind: "choice", optionId: "answerId" in ex ? ex.answerId : "" };
  }
}

// ---------------------------------------------------------------------------

describe("contrôles de contenu", () => {
  const where = "test";
  const check = (step: LessonStep, content: ContentIndex = pack) => checkLessonStep(content, lessonWith([step]), step, where);
  const errors = (step: LessonStep, content: ContentIndex = pack) => check(step, content).filter((i) => i.level === "error").map((i) => i.message);

  it("listen_gist : dialogue inconnu ou sans question", () => {
    expect(errors({ type: "listen_gist", dialogue: "dlg_absent" }, withDialogue())).toContainEqual(expect.stringContaining("Dialogue inconnu"));
    const { question: _q, ...noQuestion } = dialogue;
    expect(errors({ type: "listen_gist", dialogue: dialogue.id }, withDialogue(noQuestion))).toContainEqual(expect.stringContaining("question de compréhension"));
    expect(errors({ type: "listen_gist", dialogue: dialogue.id }, withDialogue())).toEqual([]);
  });

  it("fill_gap : trou manquant, réponse hors options, options en double", () => {
    expect(errors({ type: "fill_gap", text: "Đây là má tôi.", answer: "má", options: ["má", "mà"] })).toContainEqual(expect.stringContaining("trou"));
    expect(errors({ type: "fill_gap", text: `Đây là ${GAP} tôi.`, answer: "ba", options: ["má", "mà"] })).toContainEqual(expect.stringContaining("pas dans les options"));
    expect(errors({ type: "fill_gap", text: `Đây là ${GAP} tôi.`, answer: "má", options: ["má", "Má "] })).toContainEqual(expect.stringContaining("en double"));
  });

  it("match_pairs : images requises en audio_image, cartes ambiguës refusées", () => {
    const step = { type: "match_pairs", concepts: ["c_ma_mom", "c_ma_mom", "c_ba"], mode: "audio_image" } as LessonStep;
    expect(errors(step)).toContainEqual(expect.stringContaining("appariement ambigu"));
  });

  it("dialogue_choice : tours, identifiants, cible de `next`", () => {
    const bad = {
      type: "dialogue_choice",
      turns: [
        { id: "t1", vi: "A", translation: { fr: "a" }, replies: [{ id: "r1", vi: "x", next: "t9" }, { id: "r1", vi: "y", next: "t1" }] },
        { id: "t2", vi: "B", translation: { fr: "b" }, replies: [{ id: "r2", vi: "x" }, { id: "r3", vi: "y" }] },
      ],
    } as LessonStep;
    const found = errors(bad).join(" | ");
    expect(found).toContain("2 tours");
    expect(found).toContain("en double");
    expect(found).toContain("tour suivant inconnu");
    expect(found).toContain("boucle");
    expect(check(bad).some((i) => i.level === "warning" && i.message.includes("inatteignable"))).toBe(true);
  });

  it("speak_answer / speak_roleplay : concepts, bornes, avertissement si non noté", () => {
    const answer: LessonStep = { type: "speak_answer", prompt: "Ai?", translation: { fr: "Qui ?" }, accepted: ["c_ma_mom"] };
    expect(errors(answer)).toEqual([]);
    expect(check(answer).some((i) => i.message.includes("courbe F0"))).toBe(true);
    const tooMany = {
      type: "speak_roleplay", situation: { fr: "x" },
      prompts: Array.from({ length: 5 }, () => ({ cue: { fr: "c" }, concept: "c_ma_mom" })),
    } as LessonStep;
    expect(errors(tooMany)).toContainEqual(expect.stringContaining("5 consignes"));
  });

  it("dialogues : longueur, traduction, question, NFC", () => {
    const long: Dialogue = {
      ...dialogue,
      id: "dlg_long",
      turns: Array.from({ length: 9 }, (_, i) => ({ speaker: "A", vi: `câu ${i}`, translation: { fr: "" } })),
      question: { prompt: { fr: "?" }, options: [{ fr: "a" }, { fr: "b" }], answer: 5 },
    };
    const issues = checkContent(withDialogue(long)).filter((i) => i.where.startsWith("dlg_long"));
    const messages = issues.map((i) => i.message).join(" | ");
    expect(messages).toContain("9 répliques");
    expect(messages).toContain("Traduction française manquante");
    expect(messages).toContain("Réponse hors des options");
  });

  it("un pack sans dialogue reste valide", () => {
    expect(checkContent(pack).filter((i) => i.level === "error")).toEqual([]);
  });
});
