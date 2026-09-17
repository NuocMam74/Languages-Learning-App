import { buildContentIndex, buildExercise, evaluate, type ContentIndex, type Exercise, type ExerciseResponse } from "@parlo/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import { usePrefs } from "../prefs.ts";
import { DialogueChoiceView } from "./DialogueChoiceView.tsx";
import { FillGapView } from "./FillGapView.tsx";
import { ListenGistView } from "./ListenGistView.tsx";
import { MatchPairsView } from "./MatchPairsView.tsx";
import { TextAnswerView } from "./TextAnswerView.tsx";

/**
 * Catalogue complet d'exercices (contrat phase6) : chaque vue est jouable avec le contenu réel du
 * pack et rend une réponse que le moteur sait noter (`evaluate`). La notation elle-même est testée
 * dans `packages/core` : ici on vérifie l'enchaînement geste → `ExerciseResponse`.
 */

const content: ContentIndex = buildContentIndex(toRaw(readPackFiles("vi-south")));

/** Premier exercice de ce type dans le pack (le contenu bouge, pas les types). */
function firstOfType<T extends Exercise["type"]>(type: T): Extract<Exercise, { type: T }> {
  for (const lesson of content.lessons.values()) {
    const index = lesson.steps.findIndex((s) => s.type === type);
    if (index >= 0) return buildExercise(content, lesson, index, "test") as Extract<Exercise, { type: T }>;
  }
  throw new Error(`Aucune étape ${type} dans le pack`);
}

const answers: ExerciseResponse[] = [];
const onAnswer = (r: ExerciseResponse) => answers.push(r);

beforeEach(() => {
  answers.length = 0;
  usePrefs.setState({ silent: false });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const check = () => screen.getByRole("button", { name: /Valider|Check/ }) as HTMLButtonElement;

describe("MatchPairsView", () => {
  const exercise = firstOfType("match_pairs");
  const card = (id: string) => document.querySelector<HTMLButtonElement>(`[data-option-id="${id}"]`)!;

  /** Touche la carte de gauche puis celle de droite du même concept. */
  const pairUp = (conceptId: string) => {
    fireEvent.click(card(`l${conceptId}`));
    fireEvent.click(card(`r${conceptId}`));
  };

  it("apparie en deux touchers, numérote les deux cartes et n'accepte la validation qu'une fois complet", () => {
    render(<MatchPairsView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    expect(check().disabled).toBe(true);

    const ids = exercise.answer.map((p) => p.leftId.slice(1));
    pairUp(ids[0]!);
    expect(card(`l${ids[0]}`).dataset.pair).toBe("1");
    expect(card(`r${ids[0]}`).dataset.pair).toBe("1");
    expect(check().disabled).toBe(true);

    for (const id of ids.slice(1)) pairUp(id);
    expect(check().disabled).toBe(false);
    fireEvent.click(check());

    expect(answers).toHaveLength(1);
    expect(evaluate(exercise, answers[0]!)).toMatchObject({ correct: true, graded: true });
  });

  it("une carte déjà appariée se défait au toucher", () => {
    render(<MatchPairsView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    const id = exercise.answer[0]!.leftId.slice(1);
    pairUp(id);
    fireEvent.click(card(`l${id}`));
    expect(card(`l${id}`).dataset.pair).toBeUndefined();
    expect(card(`r${id}`).dataset.pair).toBeUndefined();
  });

  it("association croisée : le moteur ne la compte pas, la vue montre laquelle est fausse", () => {
    render(<MatchPairsView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    const ids = exercise.answer.map((p) => p.leftId.slice(1));
    // Les deux premières colonnes sont échangées, le reste est juste.
    fireEvent.click(card(`l${ids[0]}`));
    fireEvent.click(card(`r${ids[1]}`));
    fireEvent.click(card(`l${ids[1]}`));
    fireEvent.click(card(`r${ids[0]}`));
    for (const id of ids.slice(2)) pairUp(id);
    fireEvent.click(check());

    const evaluation = evaluate(exercise, answers[0]!);
    expect(evaluation.correct).toBe(false);
    expect(card(`l${ids[0]}`).dataset.state).toBe("wrong");
    expect(card(`l${ids[2]}`).dataset.state).toBe("right");
  });
});

describe("FillGapView", () => {
  const exercise = firstOfType("fill_gap");

  it("la pastille choisie remplit le trou et part comme un choix", () => {
    render(<FillGapView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    expect(check().disabled).toBe(true);
    const good = exercise.options.find((o) => o.id === exercise.answerId)!;
    fireEvent.click(document.querySelector(`[data-option-id="${good.id}"]`)!);
    expect(screen.getByTestId("gap-slot").textContent).toContain(good.text);
    fireEvent.click(check());
    expect(answers[0]).toEqual({ kind: "choice", optionId: good.id });
    expect(evaluate(exercise, answers[0]!).correct).toBe(true);
  });
});

describe("TextAnswerView", () => {
  const exercise = firstOfType("listen_transcribe");
  const typeAnswer = (text: string) => {
    const input = screen.getByTestId("answer-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: text, selectionStart: text.length } });
  };

  it("transcription : le texte tapé part tel quel et le moteur le note", () => {
    render(<TextAnswerView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    expect(check().disabled).toBe(true);
    typeAnswer(exercise.accepted[0]!);
    fireEvent.click(check());
    expect(answers[0]).toEqual({ kind: "text", text: exercise.accepted[0] });
    expect(evaluate(exercise, answers[0]!).correct).toBe(true);
  });

  it("erreur de ton seule : « presque », avec la forme attendue et celle qui a été tapée", () => {
    const expected = exercise.accepted[0]!;
    const given = expected.normalize("NFD").replace(/[̣̀́̃̉]/g, "").normalize("NFC");
    render(<TextAnswerView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    typeAnswer(given);
    fireEvent.click(check());
    const evaluation = evaluate(exercise, answers[0]!);
    if (evaluation.correct) return; // mot sans ton : rien à signaler
    expect(evaluation.nearMiss).toBe(true);
    const hint = screen.getByTestId("near-miss").textContent ?? "";
    expect(hint).toContain(expected);
    expect(hint).toContain(given);
  });

  it("mode silencieux : le sens est montré, jamais le mot à écrire", () => {
    usePrefs.setState({ silent: true });
    render(<TextAnswerView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    const transcript = screen.getByTestId("transcript").textContent ?? "";
    expect(transcript).not.toContain(exercise.audio.vi);
  });
});

describe("ListenGistView", () => {
  const exercise = firstOfType("listen_gist");

  it("mode silencieux : transcriptions et question tout de suite, la bonne option est notée", () => {
    usePrefs.setState({ silent: true });
    render(<ListenGistView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    expect(screen.getByTestId("gist-dialogue").textContent).toContain(exercise.dialogue.turns[0]!.vi);
    fireEvent.click(document.querySelector(`[data-option-id="${exercise.answerId}"]`)!);
    fireEvent.click(check());
    expect(evaluate(exercise, answers[0]!)).toMatchObject({ correct: true, graded: true });
  });

  it("avec le son : les transcriptions restent masquées avant la réponse", () => {
    render(<ListenGistView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    expect(screen.getByTestId("gist-dialogue").textContent).not.toContain(exercise.dialogue.turns[0]!.vi);
    expect(screen.getByTestId("gist-listen")).toBeTruthy();
  });
});

describe("DialogueChoiceView", () => {
  const exercise = firstOfType("dialogue_choice");

  it("avance de tour en tour, garde les réponses choisies et récapitule à la fin", () => {
    render(<DialogueChoiceView exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />);
    const chosen: string[] = [];
    for (let i = 0; i < exercise.turns.length + 1; i++) {
      const summary = screen.queryByTestId("dialogue-summary");
      if (summary) break;
      const turnId = screen.getByTestId("dialogue-turn").dataset.turn!;
      const turn = exercise.turns.find((x) => x.id === turnId)!;
      // Le meilleur choix quand il existe, sinon la première réponse.
      const reply = turn.replies.find((r) => r.best) ?? turn.replies[0]!;
      chosen.push(reply.id);
      fireEvent.click(document.querySelector(`[data-option-id="${reply.id}"]`)!);
      const next = screen.queryByRole("button", { name: /Continuer|Continue/ });
      if (next) fireEvent.click(next);
    }
    expect(screen.getByTestId("dialogue-summary")).toBeTruthy();
    fireEvent.click(check());
    expect(answers[0]).toEqual({ kind: "path", turnIds: chosen });
    expect(evaluate(exercise, answers[0]!).correct).toBe(true);
  });
});
