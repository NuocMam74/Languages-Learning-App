import type { Concept, ContentIndex, Exercise, ExerciseResponse } from "@parlo/core";
import { useMemo, useState } from "react";
import { Button } from "../components/ui.tsx";
import { t } from "../i18n/index.ts";
import { ChoNoi } from "./ChoNoi.tsx";

/**
 * Mini-jeu en bloc 4 d'une séance (spec §4.3) : le résultat {correct, total}
 * part au moteur (GAME_PASS_RATIO). « Continuer sans jouer » / « Passer » → skip, non noté.
 */
export function GameExercise({ exercise, content, onAnswer, locked }: {
  exercise: Extract<Exercise, { type: "game" }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}) {
  const concepts = useMemo(
    () => exercise.conceptIds.flatMap((id): Concept[] => {
      const c = content.concepts.get(id);
      return c ? [c] : [];
    }),
    [exercise, content],
  );
  // Nouvelle partie à chaque affichage (une relance en fin de leçon ne rejoue pas la même).
  const [seed] = useState(() => `${exercise.stepIndex}:${Date.now()}`);
  const skip = () => onAnswer({ kind: "skip" });

  return (
    <ChoNoi
      content={content}
      concepts={concepts}
      seed={seed}
      onSkip={skip}
      resultActions={(result) => (
        <Button
          disabled={locked}
          onClick={() => onAnswer(result.total > 0 ? { kind: "game", correct: result.correct, total: result.total } : { kind: "skip" })}
        >
          {t("games.continue")}
        </Button>
      )}
    />
  );
}
