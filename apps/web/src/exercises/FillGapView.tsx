import { GAP, type ContentIndex, type Exercise, type ExerciseResponse } from "@parlo/core";
import { useState } from "react";
import { Button, Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { Frame } from "./Frame.tsx";

/**
 * `fill_gap` (contrat phase6 §2) : la phrase garde sa forme, le trou est une case visible qui se
 * remplit avec la pastille choisie — on lit la phrase entière avant de valider, pas une liste
 * d'options hors contexte. Un second appui sur la pastille choisie la retire.
 */

interface Props {
  exercise: Extract<Exercise, { type: "fill_gap" }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}

export function FillGapView({ exercise, onAnswer, locked }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const filled = exercise.options.find((o) => o.id === chosen);
  const [before, ...rest] = exercise.text.split(GAP);
  const after = rest.join(GAP);

  return (
    <Frame
      prompt={t("exercise.fillGap.prompt")}
      action={
        <Button disabled={chosen === null || locked} onClick={() => chosen && onAnswer({ kind: "choice", optionId: chosen })}>
          {t("lesson.check")}
        </Button>
      }
    >
      <div className="flex flex-col gap-8">
        <p className="leading-relaxed" data-testid="gap-sentence">
          <Vi size="vi">{before}</Vi>
          <span
            className={`mx-1 inline-grid min-h-11 min-w-24 place-items-center rounded-xl border-2 px-3 align-middle ${
              filled ? "border-ngoc bg-ngoc-sang" : "border-dashed border-phu-sa/40"
            }`}
            aria-label={filled?.text ?? t("exercise.fillGap.empty")}
            data-testid="gap-slot"
          >
            <Vi size="vi">{filled?.text ?? " "}</Vi>
          </span>
          <Vi size="vi">{after}</Vi>
        </p>

        {exercise.translation && <p className="text-phu-sa">{l(exercise.translation)}</p>}

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("exercise.fillGap.options")}>
          {exercise.options.map((option) => {
            const selected = chosen === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-option-id={option.id}
                disabled={locked}
                onClick={() => setChosen(selected ? null : option.id)}
                className={`min-h-14 rounded-2xl border-2 px-5 transition-colors ${selected ? "border-ngoc bg-ngoc-sang" : "border-phu-sa/15 bg-white/70"}`}
              >
                <Vi size="2xl">{option.text}</Vi>
              </button>
            );
          })}
        </div>
      </div>
    </Frame>
  );
}
