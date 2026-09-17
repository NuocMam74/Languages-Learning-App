import type { ContentIndex, Dialogue } from "@parlo/core";
import { Link } from "react-router";
import { playPath, ttsAllowed } from "../audio.ts";
import { Screen, Vi } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import { NoteBlock } from "../notes/NoteBlock.tsx";
import type { LibraryData } from "./data.ts";
import { EmptyState, LibraryHeader } from "./ui.tsx";

/**
 * Les dialogues rencontrés en leçon, relus réplique par réplique (contrat phase8 §2).
 * Chaque réplique s'écoute ; la traduction est toujours visible — sans audio natif, le dialogue
 * reste lisible (spec §13 : rien ne dépend d'un son).
 */
export function Dialogues({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const dialogues = data.dialogues.flatMap((id) => content.dialogues.get(id) ?? []);

  return (
    <Screen top={<LibraryHeader title={t("review.section.dialogues")} />}>
      {dialogues.length === 0 ? (
        <EmptyState
          testId="dialogues-empty"
          title={t("review.dialogues.empty.title")}
          body={t("review.dialogues.empty.body")}
          action={<Link to="/seance" className="min-h-11 py-2 font-semibold text-ngoc">{t("review.empty.cta")}</Link>}
        />
      ) : (
        <ul className="flex flex-col gap-5">
          {dialogues.map((dialogue) => (
            <DialogueCard key={dialogue.id} content={content} dialogue={dialogue} />
          ))}
        </ul>
      )}
    </Screen>
  );
}

function DialogueCard({ content, dialogue }: { content: ContentIndex; dialogue: Dialogue }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-phu-sa/10 bg-white/70 px-4 py-3" data-testid="dialogue-card" data-dialogue={dialogue.id}>
      <h2 className="font-semibold">{l(dialogue.title)}</h2>
      <ol className="flex flex-col gap-3">
        {dialogue.turns.map((turn, index) => (
          <li key={`${dialogue.id}:${index}`} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-phu-sa">{turn.speaker}</p>
              <Vi>{turn.vi}</Vi>
              <p className="text-phu-sa">{l(turn.translation)}</p>
            </div>
            <button
              type="button"
              aria-label={`${t("review.dialogues.listen")} — ${turn.speaker}`}
              data-testid="dialogue-play"
              onClick={() => void playPath(content, turn.audio, turn.vi, ttsAllowed(false))}
              className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-ngoc/30 text-ngoc"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
                <path d="M15.5 9a4 4 0 0 1 0 6" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
      <NoteBlock target={{ kind: "dialogue", id: dialogue.id }} testId="dialogue-note" />
    </li>
  );
}
