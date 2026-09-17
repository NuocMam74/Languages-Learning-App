import { compareAnswer, type ContentIndex, type Exercise, type ExerciseResponse } from "@parlo/core";
import { useState } from "react";
import { playConcept, ttsAllowed } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { Button, Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { VietnameseInput } from "../input/VietnameseInput.tsx";
import { Frame } from "./Frame.tsx";

/**
 * Exercices écrits (contrat phase6 §2) : `listen_transcribe`, `translate_to_vi` (clavier vietnamien)
 * et `translate_to_fr` (champ ordinaire, comparaison relâchée côté moteur).
 *
 * Le moteur note ; la vue se contente d'ajouter le détail que la feuille de correction ne peut pas
 * donner : sur un « presque », la forme attendue **et** celle qui a été tapée (« c'est má, pas mà »),
 * calculées avec la même comparaison que `evaluate` (`Evaluation.match`).
 *
 * Mode silencieux : `listen_transcribe` n'affiche jamais sa transcription (ce serait la réponse) —
 * c'est le sens du mot qui est montré, l'exercice devient « écris le mot qui veut dire… ».
 */

type TextType = "listen_transcribe" | "translate_to_vi" | "translate_to_fr";

interface Props {
  exercise: Extract<Exercise, { type: TextType }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}

export function TextAnswerView({ exercise, content, onAnswer, locked }: Props) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const target = exercise.type !== "translate_to_fr";
  const prompt = t(
    exercise.type === "listen_transcribe" ? "exercise.transcribe.prompt"
    : exercise.type === "translate_to_vi" ? "exercise.translateToVi.prompt"
    : "exercise.translateToFr.prompt",
  );

  const submit = () => {
    if (locked || text.trim() === "") return;
    setSent(text);
    onAnswer({ kind: "text", text });
  };

  // « Presque » : même comparaison que le moteur, avec en plus la forme tapée.
  const near = sent !== null && exercise.type !== "translate_to_fr" ? compareAnswer(sent, exercise.accepted) : null;
  const almost = near?.kind === "tone_only" || near?.kind === "diacritics_only" ? near : null;

  const stage =
    exercise.type === "listen_transcribe" ? (
      <div className="grid place-items-center">
        <AudioButton
          play={(speed) => playConcept(content, exercise.audio, { speed, allowTts: ttsAllowed(false) })}
          transcript={l(exercise.audio.gloss)}
        />
      </div>
    ) : exercise.type === "translate_to_vi" ? (
      <p className="text-center text-xl">{l(exercise.source)}</p>
    ) : (
      <p className="text-center"><Vi size="vi">{exercise.source}</Vi></p>
    );

  return (
    <Frame
      prompt={prompt}
      stage={stage}
      action={<Button disabled={locked || text.trim() === ""} onClick={submit}>{t("lesson.check")}</Button>}
    >
      <div className="flex flex-col gap-4">
        <VietnameseInput
          value={text}
          onChange={setText}
          onSubmit={submit}
          disabled={locked}
          target={target}
          label={t(target ? "exercise.answer.labelVi" : "exercise.answer.label")}
        />
        {almost && (
          <p className="text-lg text-son-mai" role="status" data-testid="near-miss">
            {t("exercise.nearMiss", { expected: almost.expected, given: sent ?? "" })}
          </p>
        )}
      </div>
    </Frame>
  );
}
