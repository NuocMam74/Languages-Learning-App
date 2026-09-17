import type { ContentIndex, UnitId } from "@parlo/core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Screen, Vi } from "../components/ui.tsx";
import { Card, Chip, EmptyState, type ChipTone, type IconName } from "../design/index.ts";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { NoteBlock } from "../notes/NoteBlock.tsx";
import type { LibraryData } from "./data.ts";
import { matchesSearch, type GrammarEntry, type GrammarKind } from "./library.ts";
import { enter, GroupTitle, LibraryHeader, SEARCH_CLASS } from "./ui.tsx";

/**
 * Grammaire et culture (contrat phase8 §2) : les explications du contenu (champs `explain`, notes
 * de concept, cartes culture) des leçons terminées, regroupées par unité et lisibles hors séance.
 * Chaque carte accepte une note personnelle.
 *
 * Les cartes culture passent en `notice` : ce sont les respirations de la section, et une pile de
 * cartes identiques n'a pas de hiérarchie (contrat §1).
 */

const KIND_LABEL: Record<GrammarKind, MessageKey> = {
  explain: "review.grammar.kind.explain",
  note: "review.grammar.kind.note",
  culture: "review.grammar.kind.culture",
};

const KIND_ICON: Record<GrammarKind, IconName> = { explain: "grammar", note: "pencil", culture: "lantern" };
const KIND_CHIP: Record<GrammarKind, ChipTone> = { explain: "neutral", note: "ngoc", culture: "outline" };

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
          data-testid="grammar-empty"
          art="boat"
          title={t("review.grammar.empty.title")}
          body={t("review.grammar.empty.body")}
          action={
            <Link to="/seance" className="inline-flex min-h-12 items-center rounded-card bg-ngoc px-5 font-semibold text-nuoc">
              {t("review.empty.cta")}
            </Link>
          }
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
              className={SEARCH_CLASS}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>

          {groups.length === 0 ? (
            <div className="mt-3">
              <EmptyState data-testid="grammar-no-match" art="page" title={t("review.vocab.noMatch.title")} body={t("review.vocab.noMatch.body")} />
            </div>
          ) : (
            groups.map(([unitId, entries]) => (
              <section key={unitId}>
                <GroupTitle icon="grammar">{unitTitles.get(unitId) ?? unitId}</GroupTitle>
                <ul className="flex flex-col gap-3">
                  {entries.map((entry, index) => (
                    <GrammarCard key={entry.id} content={content} entry={entry} index={index} />
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

function GrammarCard({ content, entry, index }: { content: ContentIndex; entry: GrammarEntry; index: number }) {
  const lesson = entry.lessonId ? content.lessons.get(entry.lessonId) : undefined;
  return (
    <Card
      as="li"
      tone={entry.kind === "culture" ? "notice" : "plain"}
      className="flex flex-col gap-2"
      data-testid="grammar-card"
      data-kind={entry.kind}
      {...enter(index)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={KIND_CHIP[entry.kind]} icon={KIND_ICON[entry.kind]}>{t(KIND_LABEL[entry.kind])}</Chip>
        {entry.title && entry.kind === "culture" && <span className="font-semibold">{l(entry.title)}</span>}
      </div>
      {entry.vi && <Vi>{entry.vi}</Vi>}
      <p className="whitespace-pre-line">{l(entry.body)}</p>
      {lesson && entry.kind !== "note" && <p className="text-sm text-phu-sa">{t("review.grammar.fromLesson", { title: l(lesson.title) })}</p>}
      <NoteBlock target={{ kind: entry.target.kind, id: entry.target.id }} testId="grammar-note" />
    </Card>
  );
}
