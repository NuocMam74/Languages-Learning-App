import type { ChoiceOption, ContentIndex, Exercise, ExerciseResponse } from "@parlo/core";
import { useState, type ReactNode } from "react";
import { playConcept, playPath, ttsAllowed } from "../audio.ts";
import { mediaUrl } from "../content.ts";
import { GameExercise, SESSION_GAMES } from "../games/GameExercise.tsx";
import { DoiDapExercise } from "../games/DoiDapExercise.tsx";
import { NhoMatExercise } from "../games/NhoMat.tsx";
import { KaraokeExercise } from "../karaoke/KaraokeExercise.tsx";
import { useSession } from "../session-store.ts";
import { l, t, toneLabel, type MessageKey } from "../i18n/index.ts";
import { AudioButton } from "./AudioButton.tsx";
import { Button, Vi } from "./ui.tsx";

/**
 * Un composant par famille d'exercice, piloté uniquement par les données.
 * Chaque vue rend son contenu et sa propre action principale (en bas).
 */

interface ViewProps<T extends Exercise["type"]> {
  exercise: Extract<Exercise, { type: T }>;
  content: ContentIndex;
  onAnswer: (response: ExerciseResponse) => void;
  locked: boolean;
}

export function ExerciseView({ exercise, content, onAnswer, locked }: { exercise: Exercise; content: ContentIndex; onAnswer: (r: ExerciseResponse) => void; locked: boolean }) {
  const common = { content, onAnswer, locked };
  switch (exercise.type) {
    case "culture_card":
      return <CultureCardView exercise={exercise} {...common} />;
    case "listen_pick_image":
    case "listen_pick_text":
    case "tone_identify":
    case "tone_minimal_pair":
    case "spot_the_south":
      return <ChoiceView exercise={exercise} {...common} />;
    case "build_sentence":
      return <BuildSentenceView exercise={exercise} {...common} />;
    case "speak_repeat":
    case "tone_produce":
      return <SpeechView exercise={exercise} {...common} />;
    case "game":
      if (exercise.game === "doi_dap") return <DoiDapExercise exercise={exercise} {...common} />;
      if (exercise.game === "nho_mat") return <NhoMatExercise exercise={exercise} {...common} />;
      if (SESSION_GAMES.has(exercise.game)) return <GameExercise exercise={exercise} {...common} />;
      return <Placeholder message={t("ex.game.soon", { name: t(`game.${exercise.game}` as MessageKey) })} onAnswer={onAnswer} />;
    case "unsupported":
      return <Placeholder message={t("ex.unsupported")} onAnswer={onAnswer} />;
  }
}

function Layout({ prompt, stage, children, action }: { prompt: string; stage?: ReactNode; children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-medium text-phu-sa">{prompt}</h2>
      {stage && <div className="grid min-h-40 place-items-center py-6">{stage}</div>}
      <div className="flex-1">{children}</div>
      <div className="sticky bottom-0 bg-nuoc pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{action}</div>
    </div>
  );
}

// --- Choix -----------------------------------------------------------------

type ChoiceType = "listen_pick_image" | "listen_pick_text" | "tone_identify" | "tone_minimal_pair" | "spot_the_south";

function ChoiceView({ exercise, content, onAnswer, locked }: ViewProps<ChoiceType>) {
  const [selected, setSelected] = useState<string | null>(null);

  let prompt = t("ex.listen");
  let stage: ReactNode = null;
  const isTone = exercise.type === "tone_identify" || exercise.type === "tone_minimal_pair";

  switch (exercise.type) {
    case "listen_pick_image":
      prompt = t("ex.listenPickImage");
      stage = <AudioButton play={(speed) => playConcept(content, exercise.audio, { speed, allowTts: ttsAllowed(false) })} transcript={exercise.audio.vi} />;
      break;
    case "listen_pick_text": {
      // Mode silencieux : options en vietnamien → on montre le sens ; options de sens → on montre le mot.
      const byMeaning = exercise.options.some((o) => o.label !== undefined);
      stage = <AudioButton play={(speed) => playConcept(content, exercise.audio, { speed, allowTts: ttsAllowed(false) })} transcript={byMeaning ? exercise.audio.vi : l(exercise.audio.gloss)} />;
      break;
    }
    case "tone_identify":
      prompt = t("ex.toneIdentify");
      stage = <AudioButton play={(speed) => playConcept(content, exercise.audio, { speed, allowTts: ttsAllowed(true) })} transcript={exercise.audio.vi} />;
      break;
    case "tone_minimal_pair": {
      prompt = t("ex.toneMinimalPair");
      const audio = exercise.audio;
      stage = audio
        ? <AudioButton play={(speed) => playConcept(content, audio, { speed, allowTts: ttsAllowed(true) })} transcript={audio.vi} />
        : <AudioButton play={() => playPath(content, undefined, exercise.target, ttsAllowed(true))} withSlow={false} transcript={exercise.target} />;
      break;
    }
    case "spot_the_south":
      prompt = t("ex.spotTheSouth", { gloss: l(exercise.entry.gloss) });
      break;
  }

  const images = exercise.type === "listen_pick_image";
  return (
    <Layout
      prompt={prompt}
      stage={stage}
      action={
        <Button disabled={selected === null || locked} onClick={() => selected && onAnswer({ kind: "choice", optionId: selected })}>
          {t("lesson.check")}
        </Button>
      }
    >
      <div role="radiogroup" className={images ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3"}>
        {exercise.options.map((option) => (
          <OptionButton
            key={option.id}
            option={option}
            content={content}
            image={images}
            tone={isTone && exercise.type === "tone_identify"}
            selected={selected === option.id}
            disabled={locked}
            onSelect={() => setSelected(option.id)}
          />
        ))}
      </div>
    </Layout>
  );
}

function OptionButton({ option, content, image, tone, selected, disabled, onSelect }: {
  option: ChoiceOption;
  content: ContentIndex;
  image: boolean;
  tone: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-16 items-center justify-center rounded-2xl border-2 px-4 py-3 text-left transition-colors ${
        selected ? "border-ngoc bg-ngoc-sang" : "border-phu-sa/15 bg-white/70"
      } ${image ? "aspect-square flex-col" : ""}`}
    >
      {image && option.image && !imageFailed ? (
        <img src={mediaUrl(content, option.image)} alt={option.text ?? ""} onError={() => setImageFailed(true)} className="max-h-full rounded-xl object-contain" />
      ) : tone && option.tones ? (
        <span className="text-lg">{toneLabel(option.tones)}</span>
      ) : option.label ? (
        <span className="text-lg">{l(option.label)}</span>
      ) : (
        <Vi size="2xl">{option.text}</Vi>
      )}
    </button>
  );
}

// --- Carte culture ------------------------------------------------------------

function CultureCardView({ exercise, content, onAnswer, locked }: ViewProps<"culture_card">) {
  const [asking, setAsking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { card } = exercise;

  if (!asking) {
    return (
      <Layout prompt={l(card.title)} action={<Button onClick={() => setAsking(true)}>{t("lesson.continue")}</Button>}>
        <article className="flex flex-col gap-6 pt-4">
          {card.vi && (
            <div className="flex flex-col items-start gap-4 border-l-4 border-nghe pl-4">
              <Vi>{card.vi}</Vi>
              <AudioButton play={() => playPath(content, card.audio, card.vi ?? "", ttsAllowed(false))} large={false} withSlow={false} />
            </div>
          )}
          <p className="text-lg">{l(card.body)}</p>
        </article>
      </Layout>
    );
  }

  return (
    <Layout
      prompt={l(card.question.prompt)}
      action={
        <Button disabled={selected === null || locked} onClick={() => selected && onAnswer({ kind: "choice", optionId: selected })}>
          {t("lesson.check")}
        </Button>
      }
    >
      <div role="radiogroup" className="flex flex-col gap-3 pt-4">
        {exercise.options.map((option) => (
          <OptionButton key={option.id} option={option} content={content} image={false} tone={false} selected={selected === option.id} disabled={locked} onSelect={() => setSelected(option.id)} />
        ))}
      </div>
    </Layout>
  );
}

// --- Construire la phrase -----------------------------------------------------

function BuildSentenceView({ exercise, content, onAnswer, locked }: ViewProps<"build_sentence">) {
  const [picked, setPicked] = useState<string[]>([]);
  const byId = new Map(exercise.tokens.map((tok) => [tok.id, tok]));
  const audio = exercise.audio;

  return (
    <Layout
      prompt={t("ex.buildSentence")}
      action={
        <Button disabled={picked.length === 0 || locked} onClick={() => onAnswer({ kind: "tokens", optionIds: picked })}>
          {t("lesson.check")}
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          {audio && <AudioButton play={(speed) => playConcept(content, audio, { speed, allowTts: ttsAllowed(false) })} autoPlay={false} large={false} withSlow={false} />}
          <p className="text-lg">{l(exercise.translation)}</p>
        </div>

        <div className="flex min-h-20 flex-wrap content-start gap-2 border-b-2 border-phu-sa/20 pb-3" aria-live="polite">
          {picked.map((id, i) => (
            <button key={id} type="button" disabled={locked} onClick={() => setPicked(picked.filter((_, k) => k !== i))} className="rounded-xl bg-ngoc px-4 py-2 text-nuoc">
              <Vi size="2xl">{byId.get(id)?.text}</Vi>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {exercise.tokens.map((tok) => {
            const used = picked.includes(tok.id);
            return (
              <button
                key={tok.id}
                type="button"
                disabled={used || locked}
                onClick={() => setPicked([...picked, tok.id])}
                className={`rounded-xl border-2 px-4 py-2 ${used ? "border-dashed border-phu-sa/20 text-transparent" : "border-phu-sa/20 bg-white/70"}`}
              >
                <Vi size="2xl">{tok.text}</Vi>
              </button>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}

// --- Répéter --------------------------------------------------------------------

function SpeechView({ exercise, content, onAnswer, locked }: ViewProps<"speak_repeat" | "tone_produce">) {
  // Karaoké tonal (spec §8.3) : sans courbe de référence ou sans micro, l'exercice reste de l'écoute non notée.
  const sessionId = useSession((s) => s.run?.sessionId ?? null);
  const tone = exercise.type === "tone_produce";
  return (
    <KaraokeExercise
      content={content}
      concept={exercise.concept}
      pitchRef={exercise.pitchRef}
      mode={tone ? "tone" : "repeat"}
      {...(tone ? { tone: exercise.tone } : {})}
      locked={locked}
      sessionId={sessionId}
      onSubmit={(score) => onAnswer({ kind: "speech", score })}
    />
  );
}
function Placeholder({ message, onAnswer }: { message: string; onAnswer: (r: ExerciseResponse) => void }) {
  return (
    <Layout prompt="" action={<Button onClick={() => onAnswer({ kind: "skip" })}>{t("lesson.continue")}</Button>}>
      <p className="grid h-full place-items-center text-center text-lg text-phu-sa">{message}</p>
    </Layout>
  );
}
