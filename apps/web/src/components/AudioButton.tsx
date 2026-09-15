import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PlaybackSource } from "../audio.ts";
import { t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";

/**
 * Transcriptions du mode silencieux autorisées ? false pendant un examen (blanc ou certifiant) :
 * elles donneraient la réponse des items d'écoute (contrat phase5 §1).
 */
export const TranscriptsAllowed = createContext(true);

interface Props {
  play: (speed: "natural" | "slow") => Promise<PlaybackSource>;
  /** Joue automatiquement à l'affichage (l'oreille avant l'œil). */
  autoPlay?: boolean;
  large?: boolean;
  withSlow?: boolean;
  /** Texte affiché en mode silencieux, à la place de l'écoute (spec §13). */
  transcript?: string;
}

export function AudioButton({ play, autoPlay = true, large = true, withSlow = true, transcript }: Props) {
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const played = useRef(false);
  const silent = usePrefs((s) => s.silent);
  const transcripts = useContext(TranscriptsAllowed);

  const run = async (speed: "natural" | "slow") => setSource(await play(speed));

  useEffect(() => {
    if (autoPlay && !silent && !played.current) {
      played.current = true;
      void run("natural");
    }
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => void run("natural")}
          aria-label={t("audio.play")}
          className={`grid place-items-center rounded-full bg-ngoc text-nuoc shadow-[0_6px_0_0_rgb(14_94_85/0.35)] active:translate-y-1 active:shadow-none ${large ? "size-24" : "size-14"}`}
        >
          <SpeakerIcon className={large ? "size-10" : "size-6"} />
        </button>
        {withSlow && (
          <button
            type="button"
            onClick={() => void run("slow")}
            aria-label={t("audio.slow")}
            className="grid size-14 place-items-center rounded-full border-2 border-ngoc/30 text-ngoc"
          >
            <TurtleIcon className="size-7" />
          </button>
        )}
      </div>
      {source === "tts" && <p className="text-sm text-phu-sa/70">{t("audio.tts")}</p>}
      {source === "missing" && <p className="text-sm text-son-mai">{t("audio.missing")}</p>}
      {silent && transcripts && transcript && (
        <p className="text-center text-lg" data-testid="transcript">
          <span className="sr-only">{t("settings.silent.transcript")} </span>
          {transcript}
        </p>
      )}
    </div>
  );
}

function SpeakerIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

function TurtleIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 15c0-4 3-7 7-7s7 3 7 7z" />
      <path d="M18 13.5h1.5a1.5 1.5 0 0 0 0-3H18M6 15l-1 3M16 15l1 3M8 11l3 4 3-4" />
    </svg>
  );
}
