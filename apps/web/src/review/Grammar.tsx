import type { ContentIndex, UnitId } from "@parlo/core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Screen, Vi } from "../components/ui.tsx";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { NoteBlock } from "../notes/NoteBlock.tsx";
import type { LibraryData } from "./data.ts";
import { matchesSearch, type GrammarEntry, type GrammarKind } from "./library.ts";
import { Chip, EmptyState, GroupTitle, LibraryHeader } from "./ui.tsx";

/**
 * Grammaire et culture (contrat phase8 §2) : les explications du contenu (champs `explain`, notes
 * de concept, cartes culture) des leçons terminées, regroupées par unité et lisibles hors séance.
 * Chaque carte accepte une note personnelle.
 */

const KIND_LABEL: Record<GrammarKind, MessageKey> = {
  explain: "review.grammar.kind.explain",
  note: "review.grammar.kind.note",
  culture: "review.grammar.kind.culture",
};

export function Grammar({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const [query, setQuery] = useState("");
  const unitTitles = useMemo(() => new Map(content.curriculum.units.map((u) => [u.id, l(u.title)])), [content]);

  const groups = useMemo(() => {
    const byUnit = new Map<UnitId, GrammarEntry[]>();
    for (const entry of data.grammar) {
      if (!matchesSearch(query, [l(entry.body), entry.vi, entry.title ? l(entry.title) : undefined])) continue;
      const list = byUnit.get(entry.unit);
      if (list) list.push(entry);
      else byUnit.set(entry.unit, [entry]);
    }
    return [...byUnit.entries()];
  }, [data.grammar, query]);

  return (
    <Screen top={<LibraryHeader title={t("review.section.grammar")} />}>
      {data.grammar.length === 0 ? (
        <EmptyState
          testId="grammar-empty"
          title={t("review.grammar.empty.title")}
          body={t("review.grammar.empty.body")}
          action={<Link to="/seance" className="min-h-11 py-2 font-semibold text-ngoc">{t("review.empty.cta")}</Link>}
        />
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm text-phu-sa">
            {t("review.vocab.search")}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="grammar-search"
              className="min-h-12 w-full rounded-xl border-2 border-phu-sa/15 bg-white/80 px-4 text-base text-muc"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>

          {groups.length === 0 ? (
            <div className="mt-3">
              <EmptyState testId="grammar-no-match" title={t("review.vocab.noMatch.title")} body={t("review.vocab.noMatch.body")} />
            </div>
          ) : (
            groups.map(([unitId, entries]) => (
              <section key={unitId}>
                <GroupTitle>{unitTitles.get(unitId) ?? unitId}</GroupTitle>
                <ul className="flex flex-col gap-3">
                  {entries.map((entry) => (
                    <GrammarCard key={entry.id} content={content} entry={entry} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

function GrammarCard({ content, entry }: { content: ContentIndex; entry: GrammarEntry }) {
  const lesson = entry.lessonId ? content.lessons.get(entry.lessonId) : undefined;
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-phu-sa/10 bg-white/70 px-4 py-3" data-testid="grammar-card" data-kind={entry.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{t(KIND_LABEL[entry.kind])}</Chip>
        {entry.title && entry.kind === "culture" && <span className="font-semibold">{l(entry.title)}</span>}
      </div>
      {entry.vi && <Vi>{entry.vi}</Vi>}
      <p className="whitespace-pre-line">{l(entry.body)}</p>
      {lesson && entry.kind !== "note" && <p className="text-sm text-phu-sa">{t("review.grammar.fromLesson", { title: l(lesson.title) })}</p>}
      <NoteBlock target={{ kind: entry.target.kind, id: entry.target.id }} testId="grammar-note" />
    </li>
  );
}
