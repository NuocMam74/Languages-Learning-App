import {
  buaComSources,
  generateBuaComRounds,
  pickXeOmRoutes,
  type Concept,
  type ContentIndex,
  type Exercise,
  type ExerciseResponse,
  type GameId,
  type GameResult,
} from "@parlo/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button } from "../components/ui.tsx";
import { t } from "../i18n/index.ts";
import { BuaCom } from "./BuaCom.tsx";
import { CaPhe } from "./CaPhe.tsx";
import { ChoNoi } from "./ChoNoi.tsx";
import { LoTo } from "./LoTo.tsx";
import { GameEmpty, GameLayout, GameLoading } from "./GameShell.tsx";
import { useXeOmData } from "./xe-om-data.ts";
import { XeOm } from "./XeOm.tsx";

/** Mini-jeux jouables en séance (les autres restent « bientôt »). */
export const SESSION_GAMES: ReadonlySet<GameId> = new Set<GameId>(["cho_noi", "xe_om", "bua_com", "lo_to", "ca_phe"]);

/** Taille d'une partie en bloc 4 (1–2 min, spec §4.3). */
const SESSION_XE_OM_ROUTES = 2;
const SESSION_BUA_COM_ROUNDS = 4;

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
  const resultActions = (result: GameResult) => (
    <Button
      disabled={locked}
      onClick={() => onAnswer(result.total > 0 ? { kind: "game", correct: result.correct, total: result.total } : { kind: "skip" })}
    >
      {t("games.continue")}
    </Button>
  );

  switch (exercise.game) {
    case "xe_om":
      return <XeOmExercise content={content} concepts={concepts} seed={seed} onSkip={skip} resultActions={resultActions} />;
    case "bua_com":
      return <BuaComExercise content={content} conceptIds={exercise.conceptIds} seed={seed} onSkip={skip} resultActions={resultActions} />;
    case "lo_to":
      return <LoTo content={content} concepts={concepts} seed={seed} onSkip={skip} resultActions={resultActions} />;
    case "ca_phe":
      return <CaPhe content={content} concepts={concepts} seed={seed} onSkip={skip} resultActions={resultActions} />;
    default:
      return <ChoNoi content={content} concepts={concepts} seed={seed} onSkip={skip} resultActions={resultActions} />;
  }
}

interface ExerciseGameProps {
  content: ContentIndex;
  seed: string;
  onSkip: () => void;
  resultActions: (result: GameResult) => ReactNode;
}

function XeOmExercise({ content, concepts, seed, onSkip, resultActions }: ExerciseGameProps & { concepts: readonly Concept[] }) {
  const data = useXeOmData(content);
  const pickRoutes = useCallback(
    (attempt: number) => (data ? pickXeOmRoutes(data, `${seed}:${attempt}`, { count: SESSION_XE_OM_ROUTES, pool: concepts }) : []),
    [data, seed, concepts],
  );
  if (data === undefined) {
    return (
      <GameLayout testId="xe-om">
        <GameLoading />
      </GameLayout>
    );
  }
  // Même état vide que hors séance (illustration + phrase) : un seul dessin pour un seul cas.
  if (data === null) return <GameEmpty testId="xe-om" message={t("games.xeOm.empty")} onSkip={onSkip} />;
  return <XeOm content={content} data={data} pickRoutes={pickRoutes} onSkip={onSkip} resultActions={resultActions} />;
}

function BuaComExercise({ content, conceptIds, seed, onSkip, resultActions }: ExerciseGameProps & { conceptIds: readonly string[] }) {
  const sources = useMemo(() => buaComSources(content, conceptIds), [content, conceptIds]);
  const makeRounds = useCallback(
    (attempt: number) => generateBuaComRounds(sources, `${seed}:${attempt}`, { rounds: SESSION_BUA_COM_ROUNDS }),
    [sources, seed],
  );
  return <BuaCom content={content} makeRounds={makeRounds} onSkip={onSkip} resultActions={resultActions} />;
}
