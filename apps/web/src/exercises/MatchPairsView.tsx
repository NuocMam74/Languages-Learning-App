import type { ChoiceOption, ContentIndex, Exercise, ExerciseResponse, PairMatch } from "@parlo/core";
import { useContext, useState } from "react";
import { playConcept, ttsAllowed } from "../audio.ts";
import { TranscriptsAllowed } from "../components/AudioButton.tsx";
import { Button, Vi } from "../components/ui.tsx";
import { mediaUrl } from "../content.ts";
import { l, t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";
import { Frame } from "./Frame.tsx";

/**
 * `match_pairs` (contrat phase6 §2) : deux colonnes déjà mélangées, on touche une carte à gauche
 * puis sa correspondance à droite (ou l'inverse). Le lien est numéroté sur les deux cartes — pas de
 * trait à dessiner, pas de glisser-déposer : ça marche au pouce et au lecteur d'écran.
 *
 * Une carte « audio » n'a ni texte ni libellé (le moteur ne les fournit pas, sinon la réponse serait
 * écrite dessus) : on joue le concept. En mode silencieux, elle montre le sens quand l'autre colonne
 * est du texte, le mot quand l'autre colonne est une image — jamais la réponse.
 *
 * Tout est validé d'un coup ; le moteur note (tout juste, ou « presque » dès 70 %). La vue affiche
 * en plus, après la réponse, quelles associations étaient bonnes.
 */

interface Props {
  exercise: Extract<Exercise, { type: "match_pairs" }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}

type Side = "left" | "right";

export function MatchPairsView({ exercise, content, onAnswer, locked }: Props) {
  /** Associations proposées, dans l'ordre où elles ont été faites (le numéro affiché). */
  const [pairs, setPairs] = useState<PairMatch[]>([]);
  const [picked, setPicked] = useState<{ side: Side; id: string } | null>(null);
  const [sent, setSent] = useState(false);

  const silent = usePrefs((s) => s.silent);
  const transcripts = useContext(TranscriptsAllowed) && silent;

  const expected = new Map(exercise.answer.map((p) => [p.leftId, p.rightId]));
  const indexOf = (side: Side, id: string) => pairs.findIndex((p) => (side === "left" ? p.leftId : p.rightId) === id);

  const play = (option: ChoiceOption) => {
    const concept = option.conceptId ? content.concepts.get(option.conceptId) : undefined;
    if (concept) void playConcept(content, concept, { allowTts: ttsAllowed(false) });
  };

  const tap = (side: Side, option: ChoiceOption) => {
    if (locked) return;
    if (isAudio(option)) play(option);
    const already = indexOf(side, option.id);
    if (already >= 0) {
      // Défaire : la carte redevient libre et reste choisie, prête pour une autre association.
      setPairs(pairs.filter((_, i) => i !== already));
      setPicked({ side, id: option.id });
      return;
    }
    if (picked && picked.side !== side) {
      const pair = side === "left" ? { leftId: option.id, rightId: picked.id } : { leftId: picked.id, rightId: option.id };
      setPairs([...pairs, pair]);
      setPicked(null);
      return;
    }
    setPicked(picked?.id === option.id ? null : { side, id: option.id });
  };

  const stateOf = (side: Side, id: string): "right" | "wrong" | null => {
    if (!sent) return null;
    const pair = pairs[indexOf(side, id)];
    if (!pair) return null;
    return expected.get(pair.leftId) === pair.rightId ? "right" : "wrong";
  };

  const complete = pairs.length === exercise.left.length;
  const rightCount = pairs.filter((p) => expected.get(p.leftId) === p.rightId).length;

  const column = (side: Side, options: readonly ChoiceOption[]) => (
    <ul className="flex flex-col gap-3">
      {options.map((option) => {
        const n = indexOf(side, option.id);
        const chosen = picked?.side === side && picked.id === option.id;
        const state = stateOf(side, option.id);
        const colors =
          state === "right" ? "border-ngoc bg-ngoc-sang"
          : state === "wrong" ? "border-son-mai bg-son-mai/10"
          : chosen ? "border-nghe bg-nghe/15"
          : n >= 0 ? "border-ngoc bg-ngoc-sang"
          : "border-line-strong bg-surface";
        return (
          <li key={option.id}>
            <button
              type="button"
              disabled={locked}
              aria-pressed={chosen || n >= 0}
              data-option-id={option.id}
              data-pair={n >= 0 ? n + 1 : undefined}
              data-state={state ?? undefined}
              onClick={() => tap(side, option)}
              className={`flex min-h-16 w-full items-center gap-3 rounded-card border-2 px-3 py-3 text-left transition-colors ${colors}`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${n >= 0 ? "bg-ngoc text-nuoc" : "bg-phu-sa/10 text-transparent"}`}
                aria-hidden={n < 0}
              >
                {n >= 0 ? n + 1 : "0"}
              </span>
              <span className="min-w-0 flex-1">{face(option, exercise.mode, content, transcripts)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Frame
      prompt={t("exercise.match.prompt")}
      action={
        <Button disabled={!complete || locked} onClick={() => { setSent(true); onAnswer({ kind: "pairs", pairs }); }}>
          {t("lesson.check")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-phu-sa" aria-live="polite">
          {sent
            ? t("exercise.match.result", { n: rightCount, total: exercise.answer.length })
            : t("exercise.match.progress", { n: pairs.length, total: exercise.left.length })}
        </p>
        <div className="grid grid-cols-2 gap-3" data-testid="match-pairs">
          {column("left", exercise.left)}
          {column("right", exercise.right)}
        </div>
      </div>
    </Frame>
  );
}

/** Carte sans texte ni libellé ni image : c'est une carte d'écoute. */
function isAudio(option: ChoiceOption): boolean {
  return option.text === undefined && option.label === undefined && option.image === undefined;
}

function face(option: ChoiceOption, mode: string, content: ContentIndex, transcripts: boolean) {
  if (option.text !== undefined) return <Vi size="2xl">{option.text}</Vi>;
  if (option.label !== undefined) return <span className="text-lg">{l(option.label)}</span>;
  if (option.image !== undefined) {
    const concept = option.conceptId ? content.concepts.get(option.conceptId) : undefined;
    return <img src={mediaUrl(content, option.image)} alt={l(concept?.gloss)} className="mx-auto max-h-24 rounded-xl object-contain" />;
  }
  const concept = option.conceptId ? content.concepts.get(option.conceptId) : undefined;
  return (
    <span className="flex items-center gap-2">
      <SpeakerIcon />
      {/* Mode silencieux : le sens face à une colonne de texte, le mot face à des images. */}
      {transcripts && concept && (
        <span className="text-base" data-testid="transcript">
          {mode === "audio_image" ? concept.vi : l(concept.gloss)}
        </span>
      )}
      {!transcripts && <span className="sr-only">{t("exercise.match.audioCard")}</span>}
    </span>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7 shrink-0 text-ngoc" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
    </svg>
  );
}
