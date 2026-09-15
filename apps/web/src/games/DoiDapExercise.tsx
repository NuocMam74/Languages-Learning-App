import type { ContentIndex, Exercise, ExerciseResponse } from "@parlo/core";
import { Button } from "../components/ui.tsx";
import { t } from "../i18n/index.ts";
import { useSession } from "../session-store.ts";
import { DoiDap } from "./DoiDap.tsx";

/**
 * Đối đáp en étape de leçon (`game: doi_dap`) : fluidité → {correct, total} pour
 * le moteur. Hors ligne ou invité : « Continuer sans jouer » (skip, non noté).
 */
export function DoiDapExercise({ content, onAnswer, locked }: {
  exercise: Extract<Exercise, { type: "game" }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}) {
  const lessonId = useSession((s) => (s.phase && (s.phase.kind === "new" || s.phase.kind === "practice") ? s.phase.lesson.lessonId : undefined));
  return (
    <DoiDap
      content={content}
      topicLessonId={lessonId}
      onSkip={() => onAnswer({ kind: "skip" })}
      resultActions={(result) => (
        <Button disabled={locked} onClick={() => onAnswer(result.total > 0 ? { kind: "game", correct: result.correct, total: result.total } : { kind: "skip" })}>
          {t("games.continue")}
        </Button>
      )}
    />
  );
}
