import type { ContentIndex } from "@parlo/core";
import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { Vi } from "../components/ui.tsx";
import { Card, Icon, SectionTitle } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import { noteSources } from "./source.ts";
import { useNotes } from "./store.ts";

/**
 * Les notes prises pendant la séance, rassemblées au bilan (contrat phase22 §2).
 *
 * Une note écrite au milieu d'un exercice se range sur le mot ou la leçon concernés, et sans cet
 * écran elle disparaîtrait de la vue jusqu'à ce qu'on rouvre la page Notes. On les remet donc
 * toutes ensemble à la fin, chacune avec ce dont elle parle — c'est là qu'elles se relisent, et
 * c'est là qu'on se souvient qu'on les a écrites.
 *
 * « Prises en chemin » se lit simplement : écrites **depuis le début de la séance**. Pas de
 * nouveau champ en base, pas de lien note ↔ séance à maintenir ; une note modifiée pendant la
 * séance mais écrite la veille reste là où elle est.
 */
export function SessionNotesRecap({ content, since }: { content: ContentIndex; since: string }) {
  const notes = useNotes((s) => s.notes);
  const load = useNotes((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(() => notes.filter((note) => note.createdAt >= since), [notes, since]);
  const sources = useMemo(() => noteSources(content, mine), [content, mine]);

  if (mine.length === 0) return null;

  return (
    <section data-testid="recap-notes" data-count={mine.length}>
      <SectionTitle icon="pencil" className="mb-3">{t("notes.session.recap.title")}</SectionTitle>
      <Card tone="plain" className="flex flex-col gap-3 py-3">
        <p className="text-sm text-phu-sa">
          {t(mine.length > 1 ? "notes.session.recap.count.plural" : "notes.session.recap.count", { n: mine.length })}
        </p>
        <ul className="flex flex-col gap-3">
          {mine.map((note) => {
            const source = sources.get(note.id);
            return (
              <li key={note.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0" data-testid="recap-note">
                {/* Ce dont parle la note d'abord : relue à froid, « ça monte » ne veut rien dire sans son mot. */}
                {source && (
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-phu-sa">
                    {source.vi ? <Vi size="2xl">{source.vi}</Vi> : null}
                    <span>{source.vi ? (source.subtitle ?? "") : source.title}</span>
                  </p>
                )}
                <p className="break-words" data-testid="recap-note-text">{note.text}</p>
              </li>
            );
          })}
        </ul>
        <Link to="/notes" className="inline-flex min-h-11 items-center gap-1.5 self-start font-semibold text-ngoc">
          <Icon name="chevronRight" size={18} />
          {t("notes.session.recap.all")}
        </Link>
      </Card>
    </section>
  );
}
