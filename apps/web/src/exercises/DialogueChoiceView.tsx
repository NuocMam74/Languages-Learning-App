import type { ContentIndex, DialogueReplyView, DialogueTurnView, Exercise, ExerciseResponse } from "@parlo/core";
import { useEffect, useState } from "react";
import { Button, Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { playDialogue, stopDialogue } from "./dialogue-audio.ts";
import { Choice, Frame } from "./Frame.tsx";

/**
 * `dialogue_choice` (contrat phase6 §3) : une vraie conversation. Le personnage parle, on choisit sa
 * réponse parmi 2 ou 3, le dialogue avance en suivant `reply.next` (absent = fin). Le retour du tour
 * (`feedback`) s'affiche sur le champ quand le contenu en donne un — c'est là qu'on apprend le
 * registre — et la fin récapitule les réponses attendues.
 *
 * La vue accumule les identifiants choisis ; le moteur note (tout juste, « presque » dès 70 % des
 * tours joués ; aucun `best` déclaré = exploration non notée).
 */

interface Props {
  exercise: Extract<Exercise, { type: "dialogue_choice" }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}

interface Step {
  turn: DialogueTurnView;
  reply: DialogueReplyView;
}

export function DialogueChoiceView({ exercise, content, onAnswer, locked }: Props) {
  const [turnId, setTurnId] = useState(exercise.startId);
  const [path, setPath] = useState<Step[]>([]);
  /** Réponse touchée dont le retour est affiché : le tour n'avance qu'après lecture. */
  const [pending, setPending] = useState<DialogueReplyView | null>(null);
  const [done, setDone] = useState(false);

  const turn = exercise.turns.find((x) => x.id === turnId) ?? null;
  // Les tours d'un dialogue à embranchements ne nomment pas leur locuteur : c'est la persona du pack
  // (Cô Mai) qui parle, sinon un libellé neutre.
  const speaker = content.pack.tutor?.name ?? t("exercise.dialogue.character");

  useEffect(() => stopDialogue, []);
  useEffect(() => {
    if (!turn || done) return;
    void playDialogue(content, [turn], () => undefined);
  }, [content, turn, done]);

  const advance = (reply: DialogueReplyView) => {
    setPending(null);
    const next = reply.next ? exercise.turns.find((x) => x.id === reply.next) : undefined;
    if (next) setTurnId(next.id);
    else setDone(true);
  };

  const pick = (reply: DialogueReplyView) => {
    if (!turn || locked) return;
    setPath([...path, { turn, reply }]);
    if (reply.feedback) setPending(reply);
    else advance(reply);
  };

  if (done || !turn) {
    const best = new Set(exercise.bestReplyIds);
    const graded = best.size > 0;
    return (
      <Frame
        prompt={t("exercise.dialogue.summary")}
        action={<Button disabled={locked} onClick={() => onAnswer({ kind: "path", turnIds: path.map((s) => s.reply.id) })}>{t("lesson.check")}</Button>}
      >
        <ol className="flex flex-col gap-4" data-testid="dialogue-summary">
          {path.map((step, i) => {
            const wanted = step.turn.replies.find((r) => best.has(r.id));
            const ok = best.has(step.reply.id);
            return (
              <li key={`${step.turn.id}-${i}`} className={`flex flex-col gap-1 border-l-4 pl-3 ${!graded ? "border-phu-sa/20" : ok ? "border-ngoc" : "border-nghe"}`}>
                <p className="text-sm text-phu-sa">{speaker}</p>
                <Vi size="2xl">{step.turn.vi}</Vi>
                <p className="text-phu-sa">{l(step.turn.translation)}</p>
                <p className="mt-1" data-state={graded ? (ok ? "right" : "wrong") : undefined}>
                  <span className="text-sm text-phu-sa">{t("exercise.dialogue.youSaid")} </span>
                  {replyText(step.reply)}
                </p>
                {graded && !ok && wanted && (
                  <p className="text-sm">
                    <span className="text-phu-sa">{t("exercise.dialogue.better")} </span>
                    {replyText(wanted)}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </Frame>
    );
  }

  return (
    <Frame
      prompt={exercise.situation ? l(exercise.situation) : t("exercise.dialogue.prompt")}
      stage={
        <div className="flex flex-col gap-2 rounded-card bg-surface px-4 py-3" data-testid="dialogue-turn" data-turn={turn.id}>
          <p className="text-sm font-semibold text-phu-sa">{speaker}</p>
          <button type="button" className="text-left" onClick={() => void playDialogue(content, [turn], () => undefined)}>
            <Vi size="vi">{turn.vi}</Vi>
          </button>
          <p className="text-phu-sa">{l(turn.translation)}</p>
        </div>
      }
      action={
        pending ? (
          <Button disabled={locked} onClick={() => advance(pending)}>{t("lesson.continue")}</Button>
        ) : (
          <p className="pb-2 text-center text-sm text-phu-sa">{t("exercise.dialogue.yourTurn")}</p>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={t("exercise.dialogue.yourTurn")} className="flex flex-col gap-3">
          {turn.replies.map((reply) => (
            <Choice
              key={reply.id}
              id={reply.id}
              selected={pending?.id === reply.id}
              disabled={locked || pending !== null}
              onSelect={() => pick(reply)}
            >
              <span className="flex flex-col gap-1">
                {reply.vi && <Vi size="2xl">{reply.vi}</Vi>}
                {reply.label && <span className={reply.vi ? "text-sm text-phu-sa" : "text-lg"}>{l(reply.label)}</span>}
              </span>
            </Choice>
          ))}
        </div>
        {pending?.feedback && (
          <p className="rounded-card bg-nghe/15 px-4 py-3" role="status" data-testid="dialogue-feedback">
            {l(pending.feedback)}
          </p>
        )}
      </div>
    </Frame>
  );
}

function replyText(reply: DialogueReplyView) {
  return reply.vi ? <Vi size="2xl">{reply.vi}</Vi> : <span className="text-lg">{l(reply.label)}</span>;
}
