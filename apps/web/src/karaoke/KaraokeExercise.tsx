import { SPEAK_PASS_SCORE, type Concept, type ContentIndex, type Tone } from "@parlo/core";
import { contourFromFrames, gradeTake, toneHint, withSingleSyllable, type PitchReference, type SpeechGrade } from "@parlo/core/pitch";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playConcept, ttsAllowed } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { Button, Vi } from "../components/ui.tsx";
import { getLocale, l, t } from "../i18n/index.ts";
import { recordPronunciation } from "../learner.ts";
import { KaraokePlot, type AlignedResult } from "./KaraokePlot.tsx";
import { loadReference, syllableLabels, type LoadedReference } from "./reference.ts";
import { micPermission, usePitchCapture, type Take } from "./use-pitch-capture.ts";

/**
 * Karaoké tonal (SPEC §5.6.2, §8.3) : speak_repeat, tone_produce et le jeu seul.
 * Écoute → « Parler » (explication avant la première demande de micro) → tracé en direct → note,
 * courbes alignées, indications ciblées → « Réessayer » ou « Continuer » (le meilleur essai compte).
 * Sans référence, sans micro ou micro refusé : l'exercice devient de l'écoute, non noté.
 */

export type KaraokeMode = "repeat" | "tone";

interface Props {
  content: ContentIndex;
  concept: Concept;
  pitchRef: string | null;
  mode: KaraokeMode;
  /** Ton attendu (tone_produce). */
  tone?: Tone;
  locked?: boolean;
  sessionId: string | null;
  /** Score retenu (meilleur essai), ou null si l'exercice n'a pas pu être noté. */
  onSubmit: (score: number | null) => void;
  prompt?: string;
  continueLabel?: string;
  /** Contenu supplémentaire sous le mot (jeu : record). */
  extra?: ReactNode;
}

interface Analysis {
  grade: SpeechGrade;
  aligned: AlignedResult | null;
}

export function KaraokeExercise({ content, concept, pitchRef, mode, tone, locked = false, sessionId, onSubmit, prompt, continueLabel, extra }: Props) {
  const [loaded, setLoaded] = useState<LoadedReference | null | undefined>(undefined);
  const [explain, setExplain] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const labels = useMemo(() => syllableLabels(concept.vi), [concept.vi]);

  useEffect(() => {
    let alive = true;
    setLoaded(undefined);
    void loadReference(content, concept, pitchRef).then((r) => alive && setLoaded(r));
    return () => {
      alive = false;
    };
  }, [content, concept, pitchRef]);

  const reference: PitchReference | null = useMemo(() => {
    if (!loaded) return null;
    const expected = tone ?? concept.tone;
    return mode === "tone" && expected ? withSingleSyllable(loaded.reference, expected) : loaded.reference;
  }, [loaded, mode, tone, concept.tone]);

  const analyze = (take: Take): Analysis => {
    if (!reference || !take.heardSpeech) return { grade: { score: null, raw: 0, hints: [], toneOk: false }, aligned: null };
    // Note sur la partie voisée ; une prise partielle (début ou fin de phrase perdus) est refusée, pas notée.
    const contour = contourFromFrames(take.frames);
    const { grade, result } = gradeTake(contour, reference, mode, SPEAK_PASS_SCORE);
    return { grade, aligned: result?.voiced ? { userSt: contour.st, path: result.path, offset: result.offset } : null };
  };

  const mic = usePitchCapture(analyze);
  const grade = mic.state === "done" ? (mic.result?.grade ?? null) : null;

  // Chaque prise notée : meilleur score + événement (le score seul).
  const counted = useRef<Analysis | null>(null);
  useEffect(() => {
    const r = mic.result;
    if (mic.state !== "done" || !r || counted.current === r || r.grade.score === null) return;
    counted.current = r;
    setAttempts((n) => n + 1);
    setBest((b) => Math.max(b ?? 0, r.grade.score ?? 0));
    void recordPronunciation({ sessionId, conceptId: concept.id, score: r.grade.score, exerciseType: mode === "tone" ? "tone_produce" : "speak_repeat" }).catch(() => undefined);
  }, [mic.state, mic.result, sessionId, concept.id, mode]);

  const speak = async () => {
    if (!explain && (await micPermission()) !== "granted") {
      setExplain(true);
      return;
    }
    setExplain(false);
    void mic.start();
  };

  const allowTts = ttsAllowed(mode === "tone" || pitchRef !== null);
  const stage = (
    <div className="flex flex-col items-center gap-3 text-center">
      <AudioButton play={(speed) => playConcept(content, concept, { speed, allowTts })} large={false} />
      <Vi size={reference ? "vi" : "vi-xl"}>{concept.vi}</Vi>
      <p className="text-phu-sa">{l(concept.gloss)}</p>
      {extra}
    </div>
  );
  const heading = prompt ?? (mode === "tone" ? t("karaoke.toneProduce") : t("ex.speakRepeat"));
  const listenOnly = (message: string | null, details = false) => (
    <Frame heading={heading} stage={stage} action={<Button disabled={locked} onClick={() => onSubmit(null)}>{t("karaoke.done")}</Button>}>
      {message && <p className="mt-6 text-center text-phu-sa" role="status">{message}</p>}
      {details && (
        <details className="mt-4 text-sm text-phu-sa">
          <summary className="min-h-11 cursor-pointer content-center font-semibold text-ngoc">{t("karaoke.howToEnable")}</summary>
          <p>{t("karaoke.howToEnable.body")}</p>
        </details>
      )}
    </Frame>
  );

  // Pas de courbe (ou en chargement) : écoute non notée, comme avant le karaoké.
  if (loaded === undefined) return listenOnly(null);
  if (!reference) return listenOnly(t("karaoke.noReference"));
  if (mic.state === "denied") return listenOnly(t("karaoke.denied"), true);
  if (mic.state === "unsupported") return listenOnly(t("karaoke.unsupported"));

  if (explain) {
    return (
      <Frame
        heading={t("karaoke.permission.title")}
        action={
          <div className="flex flex-col gap-2">
            <Button disabled={locked} onClick={() => void speak()}>{t("karaoke.permission.allow")}</Button>
            <Button variant="quiet" disabled={locked} onClick={() => onSubmit(null)}>{t("karaoke.permission.later")}</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5 pt-4" data-testid="karaoke-permission">
          <MicIcon className="size-16 text-ngoc" />
          <p className="text-lg">{t("karaoke.permission.body")}</p>
          <p className="border-l-4 border-nghe pl-4 text-lg font-medium">{t("karaoke.permission.privacy")}</p>
        </div>
      </Frame>
    );
  }

  const busy = mic.state === "requesting" || mic.state === "processing";
  // Le meilleur essai compte (l'effet qui met `best` à jour passe après ce rendu).
  const bestNow = grade?.score != null ? Math.max(best ?? 0, grade.score) : best;
  const done = mic.state === "done";
  const capturePhase = mic.capture.current?.phase;
  const status =
    mic.state === "requesting" ? t("karaoke.requesting")
    : mic.state === "recording" ? t(capturePhase === "speaking" ? "karaoke.speaking" : "karaoke.listening")
    : mic.state === "processing" ? t("karaoke.processing")
    : done && grade?.partial ? t("karaoke.partial")
    : done && grade?.score === null ? t("karaoke.notHeard")
    : "";

  const action = done && grade?.score != null
    ? (
      <div className="flex flex-col gap-2">
        <Button disabled={locked} onClick={() => onSubmit(bestNow)}>{continueLabel ?? t("karaoke.continue")}</Button>
        <Button variant="quiet" disabled={locked} onClick={() => void speak()}>{t("karaoke.retry")}</Button>
      </div>
    )
    : mic.state === "recording"
      ? <Button onClick={mic.stop}><span className="inline-flex items-center gap-2"><StopIcon className="size-5" />{t("karaoke.stop")}</span></Button>
      : (
        <div className="flex flex-col gap-2">
          <Button disabled={locked || busy} onClick={() => void speak()}>
            <span className="inline-flex items-center gap-2"><MicIcon className="size-6" />{done ? t("karaoke.retry") : t("karaoke.speak")}</span>
          </Button>
          {attempts === 0 && !busy && <Button variant="quiet" disabled={locked} onClick={() => onSubmit(null)}>{t("karaoke.cantSpeak")}</Button>}
          {attempts > 0 && !busy && <Button variant="quiet" disabled={locked} onClick={() => onSubmit(bestNow)}>{continueLabel ?? t("karaoke.continue")}</Button>}
        </div>
      );

  return (
    <Frame heading={heading} stage={stage} action={action}>
      <div className="flex flex-col gap-4 pt-4" data-testid="karaoke" data-state={mic.state} data-takes={mic.takes} data-take={done ? (grade?.partial ? "partial" : grade?.score == null ? "not-heard" : "scored") : undefined}>
        <KaraokePlot
          reference={reference}
          labels={labels}
          capture={mic.capture}
          recording={mic.state === "recording"}
          aligned={done ? (mic.result?.aligned ?? null) : null}
        />
        {loaded?.source === "derived" && <p className="text-sm text-phu-sa/70">{t("karaoke.derived")}</p>}
        <p className="min-h-6 text-center text-phu-sa" aria-live="polite">{status}</p>
        {done && grade?.score != null && (
          <ScoreResult
            key={attempts}
            grade={grade}
            mode={mode}
            labels={labels}
            best={best}
            attempts={attempts}
          />
        )}
      </div>
    </Frame>
  );
}

function ScoreResult({ grade, mode, labels, best, attempts }: { grade: SpeechGrade; mode: KaraokeMode; labels: readonly string[]; best: number | null; attempts: number }) {
  const score = grade.score ?? 0;
  const shown = useCountUp(score);
  const locale = getLocale();
  const hints = grade.hints.map((h) => toneHint(h.issue, h.tone, labels[h.index] ?? labels.join(" "), locale));
  const good = score >= SPEAK_PASS_SCORE;
  return (
    <section className="flex flex-col items-center gap-2 text-center" aria-live="polite">
      <p className="text-sm text-phu-sa">{t("karaoke.scoreLabel")}</p>
      {/* Le seul mouvement orchestré de l'écran : la note qui monte. */}
      <p
        data-testid="karaoke-score"
        data-score={score}
        data-coverage={grade.coverage?.toFixed(2)}
        aria-label={t("karaoke.score", { n: score })}
        className={`text-vi-xl font-semibold tabular-nums motion-safe:animate-[rise_500ms_ease-out] ${good ? "text-ngoc" : "text-son-mai"}`}
      >
        {shown}
      </p>
      {hints.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {hints.map((hint) => <li key={hint} className="text-lg">{hint}</li>)}
        </ul>
      ) : (
        good && <p className="text-lg">{mode === "tone" ? t("karaoke.toneOk") : t("karaoke.great")}</p>
      )}
      {attempts > 1 && best !== null && <p className="text-sm text-phu-sa">{t("karaoke.best", { n: best, count: attempts })}</p>}
    </section>
  );
}

/** 0 → valeur en ~700 ms (ease-out) ; immédiat si mouvement réduit. */
function useCountUp(target: number): number {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / 700);
      setValue(Math.round(target * (1 - (1 - u) ** 3)));
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return value;
}

/** Même arbre pour tous les états : le bouton d'écoute n'est pas remonté (pas de double lecture automatique). */
function Frame({ heading, stage = null, children, action }: { heading: string; stage?: ReactNode; children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-medium text-phu-sa">{heading}</h2>
      <div className="pt-4">{stage}</div>
      <div className="flex-1">{children}</div>
      <div className="sticky bottom-0 bg-nuoc pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{action}</div>
    </div>
  );
}

function MicIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

function StopIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}
