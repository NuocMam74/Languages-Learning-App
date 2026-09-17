import type { ContentIndex, UnitId } from "@parlo/core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { l, plural, t, type MessageKey } from "../i18n/index.ts";
import type { LibraryData } from "./data.ts";
import { LIBRARY_FILTERS, matchesFilter, matchesSearch, seenUnits, type LibraryFilter } from "./library.ts";
import { EmptyState, Field, GroupTitle, LibraryHeader, SELECT_CLASS } from "./ui.tsx";
import { WordRow } from "./WordCard.tsx";

/**
 * Vocabulaire : tous les concepts rencontrés dans la langue active (contrat phase8 §2).
 * Filtres unité et état, recherche insensible aux accents **et aux tons** (`searchKey`), fiche
 * dépliable. Tout vient d'IndexedDB : la liste marche hors ligne pour les unités téléchargées.
 */

const FILTER_LABEL: Record<LibraryFilter, MessageKey> = {
  all: "review.vocab.state.all",
  due: "review.vocab.state.due",
  hard: "review.vocab.state.hard",
  mastered: "review.vocab.state.mastered",
  new: "review.vocab.state.new",
};

export function Vocabulary({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState<UnitId | "">("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const units = useMemo(() => seenUnits(content, data.concepts), [content, data.concepts]);
  const unitTitles = useMemo(() => new Map(content.curriculum.units.map((u) => [u.id, l(u.title)])), [content]);

  const shown = useMemo(
    () =>
      data.concepts.filter((entry) => {
        if (unit !== "" && entry.unit !== unit) return false;
        if (!matchesFilter(entry, filter, data.now)) return false;
        const concept = content.concepts.get(entry.conceptId);
        return concept ? matchesSearch(query, [concept.vi, l(concept.gloss), concept.northernEquivalent]) : false;
      }),
    [content, data.concepts, data.now, query, unit, filter],
  );

  const groups = useMemo(() => {
    const byUnit = new Map<UnitId, typeof shown>();
    for (const entry of shown) {
      const list = byUnit.get(entry.unit);
      if (list) list.push(entry);
      else byUnit.set(entry.unit, [entry]);
    }
    return [...byUnit.entries()];
  }, [shown]);

  return (
    <Screen top={<LibraryHeader title={t("review.section.vocabulary")} />}>
      {data.concepts.length === 0 ? (
        <EmptyState
          testId="vocab-empty"
          title={t("review.vocab.empty.title")}
          body={t("review.vocab.empty.body")}
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
              data-testid="vocab-search"
              // 16 px au moins : iOS ne zoome pas à la mise au point.
              className="min-h-12 w-full rounded-xl border-2 border-phu-sa/15 bg-white/80 px-4 text-base text-muc"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <span>{t("review.vocab.search.hint")}</span>
          </label>

          <div className="mt-3 flex flex-wrap gap-3">
            <Field label={t("review.vocab.filter.unit")} id="vocab-unit">
              <select id="vocab-unit" value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="vocab-unit" className={SELECT_CLASS}>
                <option value="">{t("review.vocab.unit.all")}</option>
                {units.map((id) => (
                  <option key={id} value={id}>{unitTitles.get(id) ?? id}</option>
                ))}
              </select>
            </Field>
            <Field label={t("review.vocab.filter.state")} id="vocab-state">
              <select id="vocab-state" value={filter} onChange={(e) => setFilter(e.target.value as LibraryFilter)} data-testid="vocab-state" className={SELECT_CLASS}>
                {LIBRARY_FILTERS.map((value) => (
                  <option key={value} value={value}>{t(FILTER_LABEL[value])}</option>
                ))}
              </select>
            </Field>
          </div>

          <p className="mt-3 text-sm text-phu-sa" data-testid="vocab-count">{plural("review.count.words", "review.count.words.plural", shown.length)}</p>

          {shown.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                testId="vocab-no-match"
                title={t("review.vocab.noMatch.title")}
                body={t("review.vocab.noMatch.body")}
                action={
                  <button
                    type="button"
                    className="min-h-11 font-semibold text-ngoc"
                    onClick={() => {
                      setQuery("");
                      setUnit("");
                      setFilter("all");
                    }}
                  >
                    {t("review.vocab.clear")}
                  </button>
                }
              />
            </div>
          ) : (
            groups.map(([unitId, entries]) => (
              <section key={unitId || "orphan"}>
                <GroupTitle>{unitTitles.get(unitId) ?? t("review.vocab.unit.all")}</GroupTitle>
                <ul className="flex flex-col">
                  {entries.map((entry) => {
                    const concept = content.concepts.get(entry.conceptId);
                    if (!concept) return null;
                    return (
                      <WordRow
                        key={entry.conceptId}
                        content={content}
                        entry={entry}
                        concept={concept}
                        now={data.now}
                        open={open === entry.conceptId}
                        onToggle={() => setOpen(open === entry.conceptId ? null : entry.conceptId)}
                      />
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </Screen>
  );
}
