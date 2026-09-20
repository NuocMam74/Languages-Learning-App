import { buildContentIndex, buildExercise, type ContentIndex, type Exercise } from "@parlo/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import { ExerciseView } from "../components/exercises.tsx";
import { usePrefs } from "../prefs.ts";
import { exerciseMeaning, meaningGivesAnswer } from "./meaning.tsx";

/**
 * La traduction, à chaque exercice (et jamais avant l'heure).
 *
 * Deux exigences qui se contredisent en apparence : on ne fait pas manipuler une phrase dont on
 * ignore le sens, mais le sens **est** la réponse de plusieurs formats. Ces cas disent où passe la
 * ligne, avec le contenu réel du pack.
 */

const content: ContentIndex = buildContentIndex(toRaw(readPackFiles("vi-south")));

function firstOfType<T extends Exercise["type"]>(type: T): Extract<Exercise, { type: T }> {
  for (const lesson of content.lessons.values()) {
    const index = lesson.steps.findIndex((s) => s.type === type);
    if (index >= 0) return buildExercise(content, lesson, index, "test") as Extract<Exercise, { type: T }>;
  }
  throw new Error(`Aucune étape ${type} dans le pack`);
}

beforeEach(() => {
  usePrefs.setState({ silent: false });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sens de l'exercice", () => {
  it("une phrase à assembler dit ce qu'elle veut dire, pas comment on l'écrit", () => {
    const exercise = firstOfType("build_sentence");
    expect(meaningGivesAnswer(exercise)).toBe(false);
    // La consigne (le sens) est là dès le départ ; la phrase cible, qui **est** la réponse, non.
    expect(exerciseMeaning(content, exercise)?.gloss).toBeTruthy();
    expect(exerciseMeaning(content, exercise)).toMatchObject({ vi: null });
  });

  it("une écoute à choix garde son sens pour la correction", () => {
    const exercise = firstOfType("listen_pick_text");
    expect(meaningGivesAnswer(exercise)).toBe(true);
    // Le sens existe : c'est le moment de l'afficher qui change, pas son contenu.
    expect(exerciseMeaning(content, exercise)?.gloss).toBeTruthy();
  });

  it("identifier un ton : le sens est montré, la graphie non — elle porte la réponse", () => {
    const exercise = firstOfType("tone_identify");
    expect(meaningGivesAnswer(exercise)).toBe(false);
    expect(exerciseMeaning(content, exercise)).toMatchObject({ vi: null });
    expect(exerciseMeaning(content, exercise)?.gloss).toBeTruthy();
  });
});

describe("ligne de sens à l'écran", () => {
  it("s'affiche sous la consigne d'un exercice qu'elle ne trahit pas", () => {
    const exercise = firstOfType("build_sentence");
    render(<ExerciseView exercise={exercise} content={content} onAnswer={() => undefined} locked={false} />);
    expect(screen.getAllByTestId("exercise-meaning").length).toBeGreaterThan(0);
  });

  it("une phrase à assembler n'est jamais écrite à l'écran avant d'être assemblée", () => {
    const exercise = firstOfType("build_sentence");
    render(<ExerciseView exercise={exercise} content={content} onAnswer={() => undefined} locked={false} />);
    // La consigne dit quoi dire (la traduction) ; la phrase cible, qui est la réponse, n'est nulle
    // part — ni dans la ligne de sens, ni ailleurs. Les jetons, eux, la contiennent mot à mot mais
    // dans le désordre : c'est l'exercice.
    expect(screen.getByTestId("exercise-meaning").textContent).not.toContain(exercise.target);
    const tokens = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(tokens).not.toContain(exercise.target);
  });

  it("attend la réponse quand elle la donnerait, puis paraît", () => {
    const exercise = firstOfType("listen_pick_text");
    const { rerender } = render(<ExerciseView exercise={exercise} content={content} onAnswer={() => undefined} locked={false} />);
    expect(screen.queryByTestId("exercise-meaning")).toBeNull();
    // `locked` : la réponse est donnée, la correction est à l'écran — le sens peut paraître.
    rerender(<ExerciseView exercise={exercise} content={content} onAnswer={() => undefined} locked />);
    expect(screen.getByTestId("exercise-meaning")).toBeTruthy();
  });
});
