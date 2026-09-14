import {
  buildPlacementExercise,
  evaluate,
  nextLesson,
  nextPlacementItem,
  type ContentIndex,
  type ExerciseResponse,
  type Lesson,
  type PlacementAnswer,
  type PlacementResult,
  type PlacementSpec,
} from "@parlo/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ExerciseView } from "../components/exercises.tsx";
import { Button, Screen } from "../components/ui.tsx";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { getProfile, savePlacement } from "../learner.ts";

/** Fichiers de placement par pack (données de contenu, chargées à la demande). */
const SPECS: Record<string, () => Promise<{ default: unknown }>> = {
  "vi-south": () => import("../../../../content/vi-south/placement.json"),
};

type Stage = { kind: "intro" } | { kind: "test"; startedAt: number } | { kind: "saving" } | { kind: "result"; result: PlacementResult; entry: Lesson | null };

/** Mini-test de placement, optionnel (spec §4.1.4). */
export default function Placement({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const [spec, setSpec] = useState<PlacementSpec | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  const [answers, setAnswers] = useState<PlacementAnswer[]>([]);
  const [remaining, setRemaining] = useState(0);
  const seed = useRef(`placement:${Date.now()}`);

  useEffect(() => {
    const load = SPECS[content.pack.code];
    if (load) void load().then((m) => setSpec(m.default as PlacementSpec), () => setSpec(null));
  }, [content]);

  const skip = async () => {
    const profile = await getProfile();
    const first = nextLesson(content.curriculum, content.lessons, new Set(), profile.motivation);
    navigate(first ? `/lecon/${first.id}` : "/", { replace: true });
  };

  const finished = useRef(false);
  const finish = async (final: PlacementAnswer[]) => {
    if (!spec || finished.current) return;
    finished.current = true;
    setStage({ kind: "saving" });
    const { result, entry } = await savePlacement(content, spec, final);
    setStage({ kind: "result", result, entry });
  };

  // Minuterie globale : à zéro, le test s'arrête avec les réponses données.
  useEffect(() => {
    if (stage.kind !== "test" || !spec) return;
    const tick = () => {
      const left = Math.max(0, spec.durationSeconds - Math.floor((Date.now() - stage.startedAt) / 1000));
      setRemaining(left);
      if (left === 0) void finish(answers);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [stage, spec, answers]);

  const item = spec && stage.kind === "test" ? nextPlacementItem(spec, answers) : null;
  const exercise = useMemo(() => (item ? buildPlacementExercise(content, item, seed.current, answers.length) : null), [item, content, answers.length]);

  if (!spec) {
    return (
      <Screen action={<Button onClick={() => void skip()}>{t("placement.skip")}</Button>}>
        <p className="my-auto text-center text-phu-sa">{t("placement.unavailable")}</p>
      </Screen>
    );
  }

  if (stage.kind === "intro") {
    return (
      <Screen
        action={
          <div className="flex flex-col gap-2">
            <Button onClick={() => setStage({ kind: "test", startedAt: Date.now() })}>{t("placement.start")}</Button>
            <Button variant="quiet" onClick={() => void skip()}>{t("placement.skip")}</Button>
          </div>
        }
      >
        <div className="flex flex-1 flex-col justify-center gap-4">
          <h1 className="font-serif text-2xl">{t("placement.title")}</h1>
          <p className="text-lg">{t("placement.body", { n: spec.slots.length, s: spec.durationSeconds })}</p>
          <p className="text-sm text-phu-sa">{t("placement.audioNote")}</p>
        </div>
      </Screen>
    );
  }

  if (stage.kind === "result") {
    const { result, entry } = stage;
    return (
      <Screen action={<Button onClick={() => navigate(entry ? `/lecon/${entry.id}` : "/", { replace: true })}>{t("placement.go")}</Button>}>
        <div className="flex flex-1 flex-col justify-center gap-5">
          <h1 className="font-serif text-2xl">{t(`placement.level.${Math.max(0, Math.min(3, result.levelEstimate))}` as MessageKey)}</h1>
          <p className="text-lg text-phu-sa">{t("placement.score", { correct: result.correct, total: result.total })}</p>
          {entry && (
            <p className="text-lg">
              {t("placement.entry")} <span className="font-semibold">{l(entry.title)}</span>
            </p>
          )}
        </div>
      </Screen>
    );
  }

  if (stage.kind === "saving" || !item || !exercise) return <Screen><div /></Screen>;

  const onAnswer = (response: ExerciseResponse) => {
    // Pas de correction pendant le test : on passe directement à l'item suivant.
    const next = [...answers, { itemId: item.id, correct: evaluate(exercise, response).correct }];
    setAnswers(next);
    if (!nextPlacementItem(spec, next)) void finish(next);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]" data-testid="placement">
      <header className="flex items-center justify-between gap-4">
        <p className="text-sm text-phu-sa">{t("placement.progress", { i: answers.length + 1, n: spec.slots.length })}</p>
        <p className="text-sm font-semibold tabular-nums" aria-live="off" aria-label={t("placement.timeLeft", { s: remaining })}>
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
        </p>
        <button type="button" onClick={() => void finish(answers)} className="min-h-11 text-sm font-semibold text-ngoc">
          {t("placement.stop")}
        </button>
      </header>
      <main className="flex flex-1 flex-col pt-6">
        <ExerciseView key={item.id} exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />
      </main>
    </div>
  );
}
