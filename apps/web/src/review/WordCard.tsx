import type { Concept, ContentIndex } from "@parlo/core";
import { useState } from "react";
import { Link } from "react-router";
import { playConcept, ttsAllowed, type PlaybackSource } from "../audio.ts";
import { Vi } from "../components/ui.tsx";
import { Chip, Icon, IconButton, type ChipTone } from "../design/index.ts";
import { l, t, toneLabel } from "../i18n/index.ts";
import { forceDue } from "../learner.ts";
import { NoteBlock } from "../notes/NoteBlock.tsx";
import { daysUntilDue, type LibraryState, type SeenConcept } from "./library.ts";

/**
 * Fiche d'un mot vu (contrat phase8 §2) : le mot en serif, son sens, son ton, l'audio naturel et
 * lent, un exemple, l'équivalent du Nord, l'état SRS et la note personnelle. Dépliée depuis la
 * liste : on reste sur place, sans perdre sa recherche ni sa position.
 */

/**
 * Un ton de jeton par état, du plus actionnable au plus rassurant : ce qui réclame un geste
 * aujourd'hui est plein (`solid`), ce qui est acquis est jade tenu, ce qui coince est laque.
 */
const CHIP_TONE: Record<LibraryState, ChipTone> = {
  new: "nghe",
  due: "solid",
  hard: "son-mai",
  mastered: "ngoc",
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
    <li data-testid="word" data-concept={concept.id} data-state={entry.state}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={t("review.vocab.open", { word: concept.vi })}
        className="flex min-h-14 w-full items-center gap-3 py-3 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <Vi size="2xl">{concept.vi}</Vi>
          <span className="truncate text-phu-sa">{l(concept.gloss)}</span>
        </span>
        <Chip tone={CHIP_TONE[entry.state]}>{stateLabel(entry, now)}</Chip>
        {/* Simple affordance : la flèche pivote, rien ne se déplace autour (aucun recalcul de page). */}
        <Icon name="chevronDown" size={20} className={`text-phu-sa motion-safe:transition-transform motion-safe:duration-200 ${open ? "rotate-180" : ""}`} />
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
      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon="sound" label={t("audio.play")} tone="solid" onClick={() => play("natural")} data-testid="word-play" />
        <IconButton icon="slow" label={t("audio.slow")} tone="ngoc" onClick={() => play("slow")} data-testid="word-play-slow" className="border-2 border-ngoc/25" />
        {concept.tone && <span className="text-sm text-phu-sa">{t("review.vocab.tone")} · {toneLabel([concept.tone])}</span>}
      </div>
      {source === "tts" && <p className="text-sm text-phu-sa/80">{t("audio.tts")}</p>}
      {source === "missing" && <p className="text-sm text-son-mai">{t("audio.missing")}</p>}

      {example && (
        <p className="flex flex-col gap-0.5 rounded-field bg-surface-2 px-3 py-2">
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

      {concept.note && <p className="rounded-field border-l-4 border-ngoc-sang bg-surface-2 px-3 py-2 text-sm">{l(concept.note)}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!forced && entry.state !== "due" && (
          <button
            type="button"
            data-testid="word-force-due"
            onClick={() => void forceDue(concept.id, content.pack.code).then(() => setForced(true))}
            className="inline-flex min-h-11 items-center gap-2 rounded-field border-2 border-ngoc px-4 font-semibold text-ngoc"
          >
            <Icon name="refresh" size={18} />
            {t("review.vocab.forceDue")}
          </button>
        )}
        {(forced || entry.state === "due") && (
          <>
            {forced && (
              <span role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-ngoc" data-testid="word-forced">
                <Icon name="check" size={16} />
                {t("review.vocab.forced")}
              </span>
            )}
            <Link to="/revision" className="inline-flex min-h-11 items-center gap-2 font-semibold text-ngoc" data-testid="word-go-review">
              <Icon name="play" size={18} />
              {t("review.vocab.goReview")}
            </Link>
          </>
        )}
      </div>

      <NoteBlock target={{ kind: "concept", id: concept.id }} testId="word-note" />
    </div>
  );
}
