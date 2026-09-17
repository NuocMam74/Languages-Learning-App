import type { ContentIndex, Dialogue } from "@parlo/core";
import { Link } from "react-router";
import { playPath, ttsAllowed } from "../audio.ts";
import { Screen, Vi } from "../components/ui.tsx";
import { Card, EmptyState, IconButton, SectionTitle } from "../design/index.ts";
import { l, t } from "../i18n/index.ts";
import { NoteBlock } from "../notes/NoteBlock.tsx";
import type { LibraryData } from "./data.ts";
import { enter, LibraryHeader } from "./ui.tsx";

/**
 * Les dialogues rencontrés en leçon, relus réplique par réplique (contrat phase8 §2).
 * Chaque réplique s'écoute ; la traduction est toujours visible — sans audio natif, le dialogue
 * reste lisible (spec §13 : rien ne dépend d'un son).
 *
 * Chaque réplique est posée sur une surface creuse et marquée d'un filet jade : on suit la
 * conversation à l'œil, sans avoir à lire les noms des locuteurs.
 */
export function Dialogues({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const dialogues = data.dialogues.flatMap((id) => content.dialogues.get(id) ?? []);

  return (
    <Screen top={<LibraryHeader title={t("review.section.dialogues")} />}>
      {dialogues.length === 0 ? (
        <EmptyState
          data-testid="dialogues-empty"
          art="boat"
          title={t("review.dialogues.empty.title")}
          body={t("review.dialogues.empty.body")}
          action={
            <Link to="/seance" className="inline-flex min-h-12 items-center rounded-card bg-ngoc px-5 font-semibold text-nuoc">
              {t("review.empty.cta")}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {dialogues.map((dialogue, index) => (
            <DialogueCard key={dialogue.id} content={content} dialogue={dialogue} index={index} />
          ))}
        </ul>
      )}
    </Screen>
  );
}

function DialogueCard({ content, dialogue, index }: { content: ContentIndex; dialogue: Dialogue; index: number }) {
  return (
    <Card as="li" tone="plain" className="flex flex-col gap-3" data-testid="dialogue-card" data-dialogue={dialogue.id} {...enter(index)}>
      <SectionTitle tone="strong" icon="dialogue">{l(dialogue.title)}</SectionTitle>
      <ol className="flex flex-col gap-2">
        {dialogue.turns.map((turn, turnIndex) => (
          <li
            key={`${dialogue.id}:${turnIndex}`}
            className="flex items-start justify-between gap-3 rounded-field border-l-2 border-ngoc/30 bg-surface-2 py-2 pr-2 pl-3"
          >
            <div className="min-w-0">
              <p className="text-sm text-phu-sa">{turn.speaker}</p>
              <Vi>{turn.vi}</Vi>
              <p className="text-phu-sa">{l(turn.translation)}</p>
            </div>
            <IconButton
              icon="sound"
              size={20}
              tone="ngoc"
              label={`${t("review.dialogues.listen")} — ${turn.speaker}`}
              data-testid="dialogue-play"
              onClick={() => void playPath(content, turn.audio, turn.vi, ttsAllowed(false))}
              className="border-2 border-ngoc/25 bg-surface"
            />
          </li>
        ))}
      </ol>
      <NoteBlock target={{ kind: "dialogue", id: dialogue.id }} testId="dialogue-note" />
    </Card>
  );
}
