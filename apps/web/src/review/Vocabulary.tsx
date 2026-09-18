import { isDue, type ContentIndex, type PartOfSpeech, type UnitId } from "@parlo/core";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon } from "../design/index.ts";
import { l, plural, t, type MessageKey } from "../i18n/index.ts";
import { forceDue } from "../learner.ts";
import type { LibraryData } from "./data.ts";
import { POS_LABEL } from "./Index.tsx";
import { LIBRARY_FILTERS, matchesFilter, matchesSearch, POS_ORDER, seenUnits, type LibraryFilter, type SeenConcept } from "./library.ts";
import { enter, Field, GroupTitle, LibraryHeader, SEARCH_CLASS, SELECT_CLASS } from "./ui.tsx";
import { WordRow } from "./WordCard.tsx";

/**
 * Vocabulaire : tous les concepts rencontrés dans la langue active (contrat phase8 §2).
 * Filtres unité et état, recherche insensible aux accents **et aux tons** (`searchKey`), fiche
 * dépliable. Tout vient d'IndexedDB : la liste marche hors ligne pour les unités téléchargées.
 *
 * Mise en page : une unité = **une** surface qui porte ses mots, pas une pile de cartes identiques
 * (contrat §1). Le mot vietnamien y est l'objet visuel ; l'état SRS n'est qu'un jeton à sa droite.
 */

const FILTER_LABEL: Record<LibraryFilter, MessageKey> = {
  all: "review.vocab.state.all",
  due: "review.vocab.state.due",
  hard: "review.vocab.state.hard",
  mastered: "review.vocab.state.mastered",
  new: "review.vocab.state.new",
};

export function Vocabulary({ content, data }: { content: ContentIndex; data: LibraryData }) {
  // Les index (`/reviser/categories`, `/reviser/themes`) ouvrent cette liste déjà filtrée. L'URL
  // porte donc le filtre : elle se partage, et le retour du navigateur ramène au bon rayon.
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const unit = (params.get("unite") ?? "") as UnitId | "";
  const pos = (params.get("categorie") ?? "") as PartOfSpeech | "";
  const filter = (LIBRARY_FILTERS.find((f) => f === params.get("etat")) ?? "all") as LibraryFilter;
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const units = useMemo(() => seenUnits(content, data.concepts), [content, data.concepts]);
  // Seules les catégories effectivement présentes : un menu déroulant ne propose pas du vide.
  const categories = useMemo(() => {
    const present = new Set(data.concepts.map((e) => content.concepts.get(e.conceptId)?.pos).filter(Boolean));
    return POS_ORDER.filter((value) => present.has(value));
  }, [content, data.concepts]);
  const unitTitles = useMemo(() => new Map(content.curriculum.units.map((u) => [u.id, l(u.title)])), [content]);

  const shown = useMemo(
    () =>
      data.concepts.filter((entry) => {
        if (unit !== "" && entry.unit !== unit) return false;
        if (!matchesFilter(entry, filter, data.now)) return false;
        const concept = content.concepts.get(entry.conceptId);
        if (!concept) return false;
        if (pos !== "" && concept.pos !== pos) return false;
        return matchesSearch(query, [concept.vi, l(concept.gloss), concept.northernEquivalent]);
      }),
    [content, data.concepts, data.now, query, unit, pos, filter],
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
          data-testid="vocab-empty"
          art="boat"
          title={t("review.vocab.empty.title")}
          body={t("review.vocab.empty.body")}
          action={
            <Link to="/seance" className="inline-flex min-h-12 items-center rounded-card bg-ngoc px-5 font-semibold text-nuoc">
              {t("review.empty.cta")}
            </Link>
          }
        />
      ) : (
        <>
          <Card tone="quiet" className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-phu-sa">
              {t("review.vocab.search")}
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="vocab-search"
                className={SEARCH_CLASS}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <span>{t("review.vocab.search.hint")}</span>
            </label>

            <div className="flex flex-wrap gap-3">
              <Field label={t("review.vocab.filter.unit")} id="vocab-unit">
                <select id="vocab-unit" value={unit} onChange={(e) => setParam("unite", e.target.value)} data-testid="vocab-unit" className={SELECT_CLASS}>
                  <option value="">{t("review.vocab.unit.all")}</option>
                  {units.map((id) => (
                    <option key={id} value={id}>{unitTitles.get(id) ?? id}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("review.vocab.filter.pos")} id="vocab-pos">
                <select id="vocab-pos" value={pos} onChange={(e) => setParam("categorie", e.target.value)} data-testid="vocab-pos" className={SELECT_CLASS}>
                  <option value="">{t("review.vocab.pos.all")}</option>
                  {categories.map((value) => (
                    <option key={value} value={value}>{t(POS_LABEL[value])}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("review.vocab.filter.state")} id="vocab-state">
                <select id="vocab-state" value={filter} onChange={(e) => setParam("etat", e.target.value)} data-testid="vocab-state" className={SELECT_CLASS}>
                  {LIBRARY_FILTERS.map((value) => (
                    <option key={value} value={value}>{t(FILTER_LABEL[value])}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone="neutral" icon="cards" data-testid="vocab-count">
              {plural("review.count.words", "review.count.words.plural", shown.length)}
            </Chip>
            <ReviewThese content={content} entries={shown} />
          </div>

          {shown.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                data-testid="vocab-no-match"
                art="page"
                title={t("review.vocab.noMatch.title")}
                body={t("review.vocab.noMatch.body")}
                action={
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center rounded-card border-2 border-ngoc px-5 font-semibold text-ngoc"
                    onClick={() => {
                      setQuery("");
                      setParams(new URLSearchParams(), { replace: true });
                    }}
                  >
                    {t("review.vocab.clear")}
                  </button>
                }
              />
            </div>
          ) : (
            groups.map(([unitId, entries], index) => (
              <section key={unitId || "orphan"}>
                <GroupTitle icon="book">{unitTitles.get(unitId) ?? t("review.vocab.unit.all")}</GroupTitle>
                <Card tone="plain" {...enter(index)}>
                  <ul className="flex flex-col divide-y divide-line">
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
                </Card>
              </section>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

/**
 * Reprendre en bloc les mots affichés (contrat phase13 §2).
 *
 * Le « revoir maintenant » existait déjà, mais mot par mot : reprendre trente mots difficiles
 * demandait trente gestes. Ici, un seul — puis la séance de révision les sert.
 *
 * Deux garde-fous :
 *  - on ne force que les mots **pas déjà dus** : les autres sont déjà dans la file ;
 *  - on plafonne à BULK_FORCE_MAX, sinon une liste de 400 mots noierait la séance du jour et
 *    l'apprenant se retrouverait devant une file impossible (l'inverse du but).
 */
const BULK_FORCE_MAX = 20;

function ReviewThese({ content, entries }: { content: ContentIndex; entries: readonly SeenConcept[] }) {
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const now = new Date();
  // Déjà dû = déjà dans la file : le forcer ne changerait rien.
  const candidates = entries.filter((entry) => entry.card === null || !isDue(entry.card, now)).slice(0, BULK_FORCE_MAX);
  if (candidates.length === 0 && done === 0) return null;

  if (done > 0) {
    return (
      <Link to="/revision" className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc" data-testid="vocab-bulk-go">
        <Icon name="refresh" size={16} />
        {t("review.vocab.forceDue.go", { n: done })}
      </Link>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      data-testid="vocab-bulk"
      onClick={() => {
        setBusy(true);
        void Promise.all(candidates.map((entry) => forceDue(entry.conceptId, content.pack.code)))
          .then(() => setDone(candidates.length))
          .finally(() => setBusy(false));
      }}
      className="flex min-h-11 items-center gap-1.5 rounded-chip border border-line-strong px-3 text-sm font-semibold text-ngoc transition-transform disabled:opacity-60 motion-safe:active:scale-[.98]"
    >
      <Icon name="refresh" size={15} />
      {t("review.vocab.forceDue.all", { n: candidates.length })}
    </button>
  );
}
