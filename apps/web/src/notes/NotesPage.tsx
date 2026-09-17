import type { ContentIndex } from "@parlo/core";
import { useEffect, useMemo, useState } from "react";
import { Screen, Vi } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon } from "../design/index.ts";
import type { NoteRow } from "../db.ts";
import { getLocale, l, plural, t } from "../i18n/index.ts";
import { matchesSearch } from "../review/library.ts";
import { LibraryHeader, SEARCH_CLASS } from "../review/ui.tsx";
import { downloadText, exportFilename, notesJson, notesMarkdown, type NoteExportItem } from "./export.ts";
import { NoteEditor } from "./NoteEditor.tsx";
import { noteSources, type NoteSource } from "./source.ts";
import { useNotes, type NoteTarget } from "./store.ts";

/**
 * Page `/notes` (contrat phase8 §3), dans « Réviser » : liste par date ou par élément, recherche,
 * édition, suppression, export Markdown et JSON, « copier ». Tout est local — aucune note ne part
 * au serveur (minimisation, spec §14) : les exports se fabriquent sur l'appareil.
 */

type Sort = "date" | "target";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" });

export default function NotesPage({ content }: { content: ContentIndex }) {
  const notes = useNotes((s) => s.notes);
  const load = useNotes((s) => s.load);
  const save = useNotes((s) => s.save);
  const remove = useNotes((s) => s.remove);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("date");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  useEffect(() => {
    void load(content.pack.code);
  }, [load, content.pack.code]);

  const sources = useMemo(() => noteSources(content, notes), [content, notes]);
  const sourceOf = (note: NoteRow): NoteSource => sources.get(note.id) ?? { title: note.targetId ?? "" };

  const shown = useMemo(() => {
    const kept = notes.filter((note) => matchesSearch(query, [note.text, sourceOf(note).title]));
    if (sort === "date") return kept;
    // Par élément : les notes d'une même source se suivent, sources triées par titre.
    return [...kept].sort((a, b) => sourceOf(a).title.localeCompare(sourceOf(b).title, getLocale()) || b.updatedAt.localeCompare(a.updatedAt));
  }, [notes, query, sort, sources]);

  const items: NoteExportItem[] = notes.map((note) => {
    const source = sourceOf(note);
    return { note, title: source.title, ...(source.detail ? { detail: source.detail } : {}) };
  });
  const exportedAt = new Date().toISOString();
  const markdown = () =>
    notesMarkdown(items, {
      title: t("review.notes.exportTitle", { pack: l(content.pack.name) }),
      exportedAt: t("review.notes.exportDate", { date: formatDate(exportedAt) }),
      updatedLabels: items.map((item) => t("review.notes.updated", { date: formatDate(item.note.updatedAt) })),
    });

  const copy = () => {
    void navigator.clipboard
      ?.writeText(markdown())
      .then(() => setCopied("ok"))
      .catch(() => setCopied("failed"));
  };

  return (
    <Screen top={<LibraryHeader title={t("review.notes.title")} />}>
      <p className="text-sm text-phu-sa">{t("review.notes.intro")}</p>

      {notes.length > 0 && (
        <Card tone="quiet" className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-phu-sa">
            {t("review.notes.search")}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="notes-search"
              className={SEARCH_CLASS}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("review.notes.sort")}>
            {(["date", "target"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={sort === value}
                onClick={() => setSort(value)}
                data-testid={`notes-sort-${value}`}
                className={`inline-flex min-h-11 items-center gap-2 rounded-chip px-4 transition-colors ${
                  sort === value ? "bg-ngoc text-nuoc font-semibold" : "border border-line-strong bg-surface text-phu-sa"
                }`}
              >
                <Icon name={value === "date" ? "calendar" : "cards"} size={16} />
                {t(value === "date" ? "review.notes.sort.date" : "review.notes.sort.target")}
              </button>
            ))}
          </div>

          <Chip tone="neutral" icon="notebook" className="self-start" data-testid="notes-count">
            {plural("review.count.notes", "review.count.notes.plural", shown.length)}
          </Chip>
        </Card>
      )}

      {notes.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            data-testid="notes-empty"
            art="notebook"
            title={t("review.notes.empty.title")}
            body={t("review.notes.empty.body")}
            action={
              editing === "new" ? undefined : (
                <button
                  type="button"
                  onClick={() => setEditing("new")}
                  className="inline-flex min-h-12 items-center gap-2 rounded-card bg-ngoc px-5 font-semibold text-nuoc"
                  data-testid="notes-new"
                >
                  <Icon name="plus" size={18} />
                  {t("review.notes.addFree")}
                </button>
              )
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState data-testid="notes-no-match" art="page" title={t("review.notes.noMatch.title")} body={t("review.notes.noMatch.body")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {shown.map((note) => {
            const source = sourceOf(note);
            const target: NoteTarget = { kind: note.targetKind, id: note.targetId };
            return (
              <Card as="li" tone="plain" className="flex flex-col gap-2" key={note.id} data-testid="note" data-kind={note.targetKind}>
                {/* Le mot en serif, son sens dessous : on ne répète pas « mot — sens » en double. */}
                <div className="flex flex-col gap-0.5" data-testid="note-source">
                  {source.vi ? (
                    <>
                      <Vi>{source.vi}</Vi>
                      {source.subtitle && <p className="text-phu-sa">{source.subtitle}</p>}
                    </>
                  ) : (
                    <p className="font-medium">{source.title}</p>
                  )}
                  {source.detail && <p className="text-sm text-phu-sa">{source.detail}</p>}
                </div>
                {editing === note.id ? (
                  <NoteEditor
                    initial={note.text}
                    onSave={(text) => void save({ id: note.id, target, text }).then(() => setEditing(null))}
                    onCancel={() => setEditing(null)}
                    onDelete={() => void remove(note.id).then(() => setEditing(null))}
                  />
                ) : (
                  <>
                    <p className="rounded-field border-l-4 border-nghe bg-surface-nghe px-3 py-2 break-words" data-testid="note-text">{note.text}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-phu-sa">{t("review.notes.updated", { date: formatDate(note.updatedAt) })}</span>
                      <span className="flex gap-3">
                        <button type="button" onClick={() => setEditing(note.id)} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-ngoc" data-testid="note-edit">
                          <Icon name="pencil" size={16} />
                          {t("review.notes.edit")}
                        </button>
                        <button type="button" onClick={() => void remove(note.id)} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-son-mai" data-testid="note-delete-direct">
                          <Icon name="trash" size={16} />
                          {t("review.notes.delete")}
                        </button>
                      </span>
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </ul>
      )}

      {editing === "new" && (
        <div className="mt-4">
          <NoteEditor onSave={(text) => void save({ target: { kind: "free", id: null }, text }).then(() => setEditing(null))} onCancel={() => setEditing(null)} />
        </div>
      )}

      {notes.length > 0 && editing !== "new" && (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="mt-5 inline-flex min-h-12 items-center gap-2 self-start rounded-card border-2 border-ngoc px-5 font-semibold text-ngoc"
          data-testid="notes-new"
        >
          <Icon name="plus" size={18} />
          {t("review.notes.addFree")}
        </button>
      )}

      {/* Sortie des notes : trois gestes de même poids, séparés du contenu par un simple filet. */}
      {notes.length > 0 && (
        <section className="mt-7 flex flex-col gap-3 border-t border-line pt-5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadText(exportFilename(exportedAt, "md"), markdown(), "text/markdown")}
              className="inline-flex min-h-11 items-center gap-2 rounded-chip border border-line-strong bg-surface px-4 font-semibold text-ngoc"
              data-testid="notes-export-md"
            >
              <Icon name="download" size={18} />
              {t("review.notes.export.md")}
            </button>
            <button
              type="button"
              onClick={() => downloadText(exportFilename(exportedAt, "json"), `${JSON.stringify(notesJson(items, { packCode: content.pack.code, exportedAt }), null, 2)}\n`, "application/json")}
              className="inline-flex min-h-11 items-center gap-2 rounded-chip border border-line-strong bg-surface px-4 font-semibold text-ngoc"
              data-testid="notes-export-json"
            >
              <Icon name="download" size={18} />
              {t("review.notes.export.json")}
            </button>
            <button
              type="button"
              onClick={copy}
              className="inline-flex min-h-11 items-center gap-2 rounded-chip border border-line-strong bg-surface px-4 font-semibold text-ngoc"
              data-testid="notes-copy"
            >
              <Icon name="copy" size={18} />
              {t("review.notes.copy")}
            </button>
          </div>
          {copied && (
            <p role="status" className={`flex items-center gap-1.5 text-sm ${copied === "ok" ? "text-ngoc" : "text-son-mai"}`} data-testid="notes-copied">
              <Icon name={copied === "ok" ? "check" : "alert"} size={16} />
              {t(copied === "ok" ? "review.notes.copied" : "review.notes.copyFailed")}
            </p>
          )}
        </section>
      )}
    </Screen>
  );
}
