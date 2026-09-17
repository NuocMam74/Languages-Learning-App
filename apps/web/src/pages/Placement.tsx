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
import { Card, Diploma, EmptyState, Icon, Illustration, ProgressBar, ProgressRing, Skeleton } from "../design/index.ts";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { getProfile, savePlacement } from "../learner.ts";
import { playablePlacementFor } from "../packs/placement.ts";


type Stage = { kind: "intro" } | { kind: "test"; startedAt: number } | { kind: "saving" } | { kind: "result"; result: PlacementResult; entry: Lesson | null };

/**
 * Mini-test de placement, optionnel (spec §4.1.4).
 *
 * Trois moments, un seul objet fort à chaque fois (contrat phase8 §1) : le diplôme à l'invitation,
 * la barre de progression pendant le test, l'anneau du score à l'arrivée. Aucun écran vide : la
 * sauvegarde montre un squelette, l'absence de test un état vide avec son illustration.
 */
export default function Placement({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  // Items jouables seulement (tons sans audio natif retirés) ; moins de 6 → placement passé (contrat phase5 §1).
  const [spec] = useState<PlacementSpec | null>(() => playablePlacementFor(content));
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  const [answers, setAnswers] = useState<PlacementAnswer[]>([]);
  const [remaining, setRemaining] = useState(0);
  const seed = useRef(`placement:${Date.now()}`);

  useEffect(() => {
    if (!spec) void skip();
  }, []);

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
        <div className="flex flex-1 flex-col justify-center">
          <EmptyState art="diploma" title={t("placement.unavailable")} />
        </div>
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
        <div className="flex flex-1 flex-col justify-center gap-5">
          {/* Le diplôme ouvre l'écran : le test se propose, il ne s'impose pas. */}
          <Illustration className="mx-auto max-w-[15rem] motion-safe:parlo-enter">
            <Diploma />
          </Illustration>
          <h1 className="font-serif text-2xl text-balance">{t("placement.title")}</h1>
          <p className="text-lg text-balance">{t("placement.body", { n: spec.slots.length, s: spec.durationSeconds })}</p>
          <Card tone="quiet" className="flex items-start gap-3">
            <Icon name="sound" size={20} className="mt-0.5 shrink-0 text-ngoc" />
            <p className="min-w-0 flex-1 text-sm text-phu-sa">{t("placement.audioNote")}</p>
          </Card>
        </div>
      </Screen>
    );
  }

  if (stage.kind === "result") {
    const { result, entry } = stage;
    return (
      <Screen action={<Button onClick={() => navigate(entry ? `/lecon/${entry.id}` : "/", { replace: true })}>{t("placement.go")}</Button>}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          {/* L'anneau du score est le moment fort : il se remplit une fois, à l'arrivée du résultat. */}
          <ProgressRing value={result.correct} max={Math.max(1, result.total)} size={128} label={t("placement.score", { correct: result.correct, total: result.total })}>
            <span className="font-serif text-2xl tabular-nums">
              {result.correct}/{result.total}
            </span>
          </ProgressRing>
          <h1 className="font-serif text-2xl text-balance">{t(`placement.level.${Math.max(0, Math.min(3, result.levelEstimate))}` as MessageKey)}</h1>
          <p className="text-lg text-phu-sa">{t("placement.score", { correct: result.correct, total: result.total })}</p>
          {entry && (
            <Card tone="feature" className="w-full">
              <p className="text-sm text-phu-sa">{t("placement.entry")}</p>
              <p className="font-serif text-lg">{l(entry.title)}</p>
            </Card>
          )}
        </div>
      </Screen>
    );
  }

  if (stage.kind === "saving" || !item || !exercise) {
    return (
      <Screen>
        {/* Sauvegarde du placement : le squelette tient la place du résultat, jamais un écran blanc. */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4" aria-busy="true">
          <Skeleton className="size-32" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </Screen>
    );
  }

  const onAnswer = (response: ExerciseResponse) => {
    // Pas de correction pendant le test : on passe directement à l'item suivant.
    const next = [...answers, { itemId: item.id, correct: evaluate(exercise, response).correct }];
    setAnswers(next);
    if (!nextPlacementItem(spec, next)) void finish(next);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] md:max-w-[720px]" data-testid="placement">
      <header className="flex flex-col gap-2 pt-1">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-phu-sa">{t("placement.progress", { i: answers.length + 1, n: spec.slots.length })}</p>
          <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums" aria-live="off" aria-label={t("placement.timeLeft", { s: remaining })}>
            <Icon name="clock" size={16} className={remaining <= 10 ? "text-son-mai" : "text-phu-sa"} />
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          </p>
          <button type="button" onClick={() => void finish(answers)} className="min-h-11 px-1 text-sm font-semibold text-ngoc">
            {t("placement.stop")}
          </button>
        </div>
        {/* Une barre plutôt qu'un compteur : on voit ce qu'il reste sans lire. */}
        <ProgressBar
          value={answers.length}
          max={spec.slots.length}
          size="sm"
          tone={remaining <= 10 ? "son-mai" : "ngoc"}
          label={t("placement.progress", { i: answers.length + 1, n: spec.slots.length })}
        />
      </header>
      <main className="flex flex-1 flex-col pt-6">
        <ExerciseView key={item.id} exercise={exercise} content={content} onAnswer={onAnswer} locked={false} />
      </main>
    </div>
  );
}
