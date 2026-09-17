import type { Concept, ContentIndex, Exercise, ExerciseResponse } from "@parlo/core";
import { useState } from "react";
import { playPath, ttsAllowed } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { KaraokeExercise } from "../karaoke/KaraokeExercise.tsx";
import { useSession } from "../session-store.ts";

/**
 * Oraux libres (contrat phase6 §3) : `speak_answer` (répondre à une question) et `speak_roleplay`
 * (2 à 4 répliques à enchaîner). Le micro, la courbe et la note viennent du karaoké tonal
 * (`src/karaoke`) : ici on pose seulement la situation et on enchaîne les répliques.
 *
 * Sans courbe F0 de référence, le karaoké devient de l'écoute non notée avec « C'est fait » :
 * l'exercice reste jouable et le moteur ne le note pas (`score: null`).
 */

interface Props<T extends "speak_answer" | "speak_roleplay"> {
  exercise: Extract<Exercise, { type: T }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}

export function SpeakAnswerView({ exercise, content, onAnswer, locked }: Props<"speak_answer">) {
  const sessionId = useSession((s) => s.run?.sessionId ?? null);
  // Le concept noté est celui dont la courbe a été retenue par le moteur ; sinon la première forme acceptée.
  const target: Concept | undefined = exercise.accepted.find((c) => c.pitch === exercise.pitchRef) ?? exercise.accepted[0];
  if (!target) return null;

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-2 rounded-2xl bg-white/70 px-4 py-3 text-center" data-testid="speak-question">
        <Vi size="vi">{exercise.prompt}</Vi>
        <p className="text-phu-sa">{l(exercise.translation)}</p>
        <AudioButton
          play={() => playPath(content, exercise.audio ?? undefined, exercise.prompt, ttsAllowed(false))}
          large={false}
          withSlow={false}
          transcript={exercise.prompt}
        />
      </section>
      <KaraokeExercise
        content={content}
        concept={target}
        pitchRef={exercise.pitchRef}
        mode="repeat"
        exerciseType="speak_answer"
        locked={locked}
        sessionId={sessionId}
        prompt={t("exercise.speak.answer")}
        onSubmit={(score) => onAnswer({ kind: "speech", score })}
      />
    </div>
  );
}

export function SpeakRoleplayView({ exercise, content, onAnswer, locked }: Props<"speak_roleplay">) {
  const sessionId = useSession((s) => s.run?.sessionId ?? null);
  const [index, setIndex] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const prompt = exercise.prompts[index];
  if (!prompt) return null;

  const last = index === exercise.prompts.length - 1;
  const submit = (score: number | null) => {
    const all = score === null ? scores : [...scores, score];
    if (!last) {
      setScores(all);
      setIndex(index + 1);
      return;
    }
    // Moyenne des répliques notées ; aucune note possible → exercice non noté.
    onAnswer({ kind: "speech", score: all.length === 0 ? null : Math.round(all.reduce((a, b) => a + b, 0) / all.length) });
  };

  return (
    <div className="flex flex-1 flex-col" data-testid="roleplay" data-step={index + 1} data-total={exercise.prompts.length}>
      <section className="flex flex-col gap-1 rounded-2xl bg-white/70 px-4 py-3">
        <p className="text-sm font-semibold text-ngoc">{t("exercise.speak.roleplayStep", { i: index + 1, n: exercise.prompts.length })}</p>
        <p className="text-lg">{l(exercise.situation)}</p>
        <p className="text-phu-sa">{l(prompt.cue)}</p>
      </section>
      <KaraokeExercise
        key={index}
        content={content}
        concept={prompt.concept}
        pitchRef={prompt.pitchRef}
        mode="repeat"
        exerciseType="speak_roleplay"
        locked={locked}
        sessionId={sessionId}
        prompt={t("exercise.speak.roleplay")}
        {...(last ? {} : { continueLabel: t("exercise.speak.next") })}
        onSubmit={submit}
      />
    </div>
  );
}
