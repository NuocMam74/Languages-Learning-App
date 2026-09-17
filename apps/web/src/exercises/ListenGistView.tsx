import type { ContentIndex, Exercise, ExerciseResponse } from "@parlo/core";
import { useContext, useEffect, useState } from "react";
import { TranscriptsAllowed } from "../components/AudioButton.tsx";
import { Button, Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";
import { playDialogue, stopDialogue } from "./dialogue-audio.ts";
import { Choice, Frame } from "./Frame.tsx";

/** Deux écoutes avant d'ouvrir les transcriptions : on cherche le sens global, pas le mot à mot. */
const TRANSCRIPT_AFTER = 2;

/**
 * `listen_gist` (contrat phase6 §3) : le dialogue entier, tour par tour, puis une question de
 * compréhension dans la langue d'interface. Les transcriptions restent masquées — elles arrivent
 * après {@link TRANSCRIPT_AFTER} écoutes, ou tout de suite en mode silencieux (où il n'y a pas
 * d'écoute possible), jamais pendant un examen (`TranscriptsAllowed`).
 */

interface Props {
  exercise: Extract<Exercise, { type: "listen_gist" }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}

export function ListenGistView({ exercise, content, onAnswer, locked }: Props) {
  const [listens, setListens] = useState(0);
  const [playing, setPlaying] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const silent = usePrefs((s) => s.silent);
  const allowed = useContext(TranscriptsAllowed);
  const transcripts = allowed && (silent || listens >= TRANSCRIPT_AFTER);
  // Mode silencieux : rien à écouter, la question s'ouvre tout de suite.
  const answerable = silent || listens > 0;

  useEffect(() => stopDialogue, []);

  const listen = () => {
    setPlaying(0);
    void playDialogue(content, exercise.dialogue.turns, (index) => {
      setPlaying(index < 0 ? null : index);
      if (index < 0) setListens((n) => n + 1);
    });
  };

  return (
    <Frame
      prompt={t("exercise.gist.prompt")}
      action={
        answerable ? (
          <Button disabled={selected === null || locked} onClick={() => selected && onAnswer({ kind: "choice", optionId: selected })}>
            {t("lesson.check")}
          </Button>
        ) : (
          <Button disabled={locked} onClick={listen} data-testid="gist-listen">{t("exercise.gist.listen")}</Button>
        )
      }
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3" data-testid="gist-dialogue">
          <h3 className="font-serif text-xl">{l(exercise.dialogue.title)}</h3>
          <ol className="flex flex-col gap-2">
            {exercise.dialogue.turns.map((turn, index) => (
              <li
                key={`${turn.speaker}-${index}`}
                data-turn={index}
                data-playing={playing === index ? "" : undefined}
                className={`rounded-2xl border-l-4 px-3 py-2 transition-colors ${playing === index ? "border-ngoc bg-ngoc-sang" : "border-phu-sa/15"}`}
              >
                <p className="text-sm font-semibold text-phu-sa">{turn.speaker}</p>
                {transcripts ? (
                  <>
                    <Vi size="2xl">{turn.vi}</Vi>
                    <p className="text-phu-sa">{l(turn.translation)}</p>
                  </>
                ) : (
                  <p className="text-phu-sa" aria-hidden>· · ·</p>
                )}
              </li>
            ))}
          </ol>
          {answerable && (
            <button
              type="button"
              onClick={listen}
              disabled={locked}
              className="min-h-11 self-start font-semibold text-ngoc underline-offset-4 hover:underline"
            >
              {t("exercise.gist.again")}
            </button>
          )}
          {!transcripts && allowed && <p className="text-sm text-phu-sa">{t("exercise.gist.transcriptsAfter", { n: TRANSCRIPT_AFTER })}</p>}
        </section>

        {answerable && (
          <section className="flex flex-col gap-3">
            <h3 className="text-lg font-medium">{l(exercise.question.prompt)}</h3>
            <div role="radiogroup" aria-label={l(exercise.question.prompt)} className="flex flex-col gap-3">
              {exercise.options.map((option) => (
                <Choice key={option.id} id={option.id} selected={selected === option.id} disabled={locked} onSelect={() => setSelected(option.id)}>
                  <span className="text-lg">{l(option.label)}</span>
                </Choice>
              ))}
            </div>
          </section>
        )}
      </div>
    </Frame>
  );
}
