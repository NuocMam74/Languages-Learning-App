import type { Concept, ContentIndex } from "@parlo/core";
import { useState } from "react";
import { Link } from "react-router";
import { playConcept, ttsAllowed, type PlaybackSource } from "../audio.ts";
import { Vi } from "../components/ui.tsx";
import { l, t, toneLabel } from "../i18n/index.ts";
import { forceDue } from "../learner.ts";
import { NoteBlock } from "../notes/NoteBlock.tsx";
import { Chip } from "./ui.tsx";
import { daysUntilDue, type LibraryState, type SeenConcept } from "./library.ts";

/**
 * Fiche d'un mot vu (contrat phase8 §2) : le mot en serif, son sens, son ton, l'audio naturel et
 * lent, un exemple, l'équivalent du Nord, l'état SRS et la note personnelle. Dépliée depuis la
 * liste : on reste sur place, sans perdre sa recherche ni sa position.
 */

const CHIP_TONE: Record<LibraryState, "new" | "due" | "hard" | "mastered" | "neutral"> = {
  new: "new",
  due: "due",
  hard: "hard",
  mastered: "mastered",
  scheduled: "neutral",
};

/** Libellé d'état, avec l'échéance quand elle est connue. */
export function stateLabel(entry: SeenConcept, now: Date): string {
  switch (entry.state) {
    case "new":
      return t("review.vocab.state.new");
    case "hard":
      return t("review.vocab.state.hard");
    case "due":
      return t("review.vocab.due.now");
    case "mastered":
      return t("review.vocab.state.mastered");
    case "scheduled": {
      const days = entry.card ? daysUntilDue(entry.card, now) : 0;
      return days === 0 ? t("review.vocab.due.today") : days === 1 ? t("review.vocab.due.days", { n: 1 }) : t("review.vocab.due.days.plural", { n: days });
    }
  }
}

export function WordRow({ content, entry, concept, open, onToggle, now }: {
  content: ContentIndex;
  entry: SeenConcept;
  concept: Concept;
  open: boolean;
  onToggle: () => void;
  now: Date;
}) {
  return (
    <li className="border-b border-phu-sa/10 last:border-b-0" data-testid="word" data-concept={concept.id} data-state={entry.state}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={t("review.vocab.open", { word: concept.vi })}
        className="flex min-h-14 w-full items-center justify-between gap-3 py-2.5 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <Vi size="2xl">{concept.vi}</Vi>
          <span className="truncate text-phu-sa">{l(concept.gloss)}</span>
        </span>
        <Chip tone={CHIP_TONE[entry.state]}>{stateLabel(entry, now)}</Chip>
      </button>
      {open && <WordDetail content={content} entry={entry} concept={concept} />}
    </li>
  );
}

function WordDetail({ content, entry, concept }: { content: ContentIndex; entry: SeenConcept; concept: Concept }) {
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [forced, setForced] = useState(false);
  const example = concept.examples?.[0];
  // Jamais de synthèse vocale pour un ton (spec §7.4) : sans enregistrement, on le dit.
  const allowTts = ttsAllowed(concept.type === "tone");

  const play = (speed: "natural" | "slow") => {
    void playConcept(content, concept, { speed, allowTts }).then(setSource);
  };

  return (
    <div className="flex flex-col gap-3 pb-4" data-testid="word-detail">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => play("natural")} aria-label={t("audio.play")} data-testid="word-play" className="grid size-12 place-items-center rounded-full bg-ngoc text-nuoc">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
            <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
          </svg>
        </button>
        <button type="button" onClick={() => play("slow")} aria-label={t("audio.slow")} data-testid="word-play-slow" className="grid size-12 place-items-center rounded-full border-2 border-ngoc/30 text-ngoc">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 15c0-4 3-7 7-7s7 3 7 7z" />
            <path d="M18 13.5h1.5a1.5 1.5 0 0 0 0-3H18M6 15l-1 3M16 15l1 3M8 11l3 4 3-4" />
          </svg>
        </button>
        {concept.tone && <span className="text-sm text-phu-sa">{t("review.vocab.tone")} · {toneLabel([concept.tone])}</span>}
      </div>
      {source === "tts" && <p className="text-sm text-phu-sa/80">{t("audio.tts")}</p>}
      {source === "missing" && <p className="text-sm text-son-mai">{t("audio.missing")}</p>}

      {example && (
        <p className="flex flex-col gap-0.5">
          <span className="text-sm text-phu-sa">{t("review.vocab.example")}</span>
          <Vi>{example.vi}</Vi>
          <span className="text-phu-sa">{l({ fr: example.fr, ...(example.en ? { en: example.en } : {}) })}</span>
        </p>
      )}

      {concept.northernEquivalent && (
        <p className="text-sm">
          <span className="text-phu-sa">{t("review.vocab.north")} · </span>
          <span lang="vi" className="font-serif text-lg">{concept.northernEquivalent}</span>
        </p>
      )}

      {concept.note && <p className="border-l-4 border-ngoc-sang pl-3 text-sm">{l(concept.note)}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!forced && entry.state !== "due" && (
          <button
            type="button"
            data-testid="word-force-due"
            onClick={() => void forceDue(concept.id, content.pack.code).then(() => setForced(true))}
            className="min-h-11 rounded-xl border-2 border-ngoc px-4 font-semibold text-ngoc"
          >
            {t("review.vocab.forceDue")}
          </button>
        )}
        {(forced || entry.state === "due") && (
          <>
            {forced && <span role="status" className="text-sm font-medium text-ngoc" data-testid="word-forced">{t("review.vocab.forced")}</span>}
            <Link to="/revision" className="min-h-11 py-2 font-semibold text-ngoc" data-testid="word-go-review">{t("review.vocab.goReview")}</Link>
          </>
        )}
      </div>

      <NoteBlock target={{ kind: "concept", id: concept.id }} testId="word-note" />
    </div>
  );
}
