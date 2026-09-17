import type { ContentIndex } from "@parlo/core";
import { useEffect, useMemo, useState } from "react";
import { Screen, Vi } from "../components/ui.tsx";
import type { NoteRow } from "../db.ts";
import { getLocale, l, plural, t } from "../i18n/index.ts";
import { matchesSearch } from "../review/library.ts";
import { EmptyState, LibraryHeader } from "../review/ui.tsx";
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
        <>
          <label className="mt-4 flex flex-col gap-1 text-sm text-phu-sa">
            {t("review.notes.search")}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="notes-search"
              className="min-h-12 w-full rounded-xl border-2 border-phu-sa/15 bg-white/80 px-4 text-base text-muc"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("review.notes.sort")}>
            {(["date", "target"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={sort === value}
                onClick={() => setSort(value)}
                data-testid={`notes-sort-${value}`}
                className={`min-h-11 rounded-xl border-2 px-4 ${sort === value ? "border-ngoc bg-ngoc-sang font-semibold" : "border-phu-sa/15 bg-white/70"}`}
              >
                {t(value === "date" ? "review.notes.sort.date" : "review.notes.sort.target")}
              </button>
            ))}
          </div>

          <p className="mt-3 text-sm text-phu-sa" data-testid="notes-count">{plural("review.count.notes", "review.count.notes.plural", shown.length)}</p>
        </>
      )}

      {notes.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            testId="notes-empty"
            title={t("review.notes.empty.title")}
            body={t("review.notes.empty.body")}
            action={
              editing === "new" ? undefined : (
                <button type="button" onClick={() => setEditing("new")} className="min-h-11 font-semibold text-ngoc" data-testid="notes-new">
                  {t("review.notes.addFree")}
                </button>
              )
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState testId="notes-no-match" title={t("review.notes.noMatch.title")} body={t("review.notes.noMatch.body")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {shown.map((note) => {
            const source = sourceOf(note);
            const target: NoteTarget = { kind: note.targetKind, id: note.targetId };
            return (
              <li key={note.id} className="flex flex-col gap-2 rounded-2xl border border-phu-sa/10 bg-white/70 px-4 py-3" data-testid="note" data-kind={note.targetKind}>
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
                    <p className="break-words" data-testid="note-text">{note.text}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-phu-sa">{t("review.notes.updated", { date: formatDate(note.updatedAt) })}</span>
                      <span className="flex gap-4">
                        <button type="button" onClick={() => setEditing(note.id)} className="min-h-11 font-semibold text-ngoc" data-testid="note-edit">{t("review.notes.edit")}</button>
                        <button type="button" onClick={() => void remove(note.id)} className="min-h-11 font-semibold text-son-mai" data-testid="note-delete-direct">{t("review.notes.delete")}</button>
                      </span>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing === "new" && (
        <div className="mt-4">
          <NoteEditor onSave={(text) => void save({ target: { kind: "free", id: null }, text }).then(() => setEditing(null))} onCancel={() => setEditing(null)} />
        </div>
      )}

      {notes.length > 0 && (
        <section className="mt-7 flex flex-col gap-3 border-t border-phu-sa/10 pt-5">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <button type="button" onClick={() => downloadText(exportFilename(exportedAt, "md"), markdown(), "text/markdown")} className="min-h-11 font-semibold text-ngoc" data-testid="notes-export-md">
              {t("review.notes.export.md")}
            </button>
            <button
              type="button"
              onClick={() => downloadText(exportFilename(exportedAt, "json"), `${JSON.stringify(notesJson(items, { packCode: content.pack.code, exportedAt }), null, 2)}\n`, "application/json")}
              className="min-h-11 font-semibold text-ngoc"
              data-testid="notes-export-json"
            >
              {t("review.notes.export.json")}
            </button>
            <button type="button" onClick={copy} className="min-h-11 font-semibold text-ngoc" data-testid="notes-copy">{t("review.notes.copy")}</button>
          </div>
          {copied && (
            <p role="status" className={`text-sm ${copied === "ok" ? "text-ngoc" : "text-son-mai"}`} data-testid="notes-copied">
              {t(copied === "ok" ? "review.notes.copied" : "review.notes.copyFailed")}
            </p>
          )}
        </section>
      )}

      {notes.length > 0 && editing !== "new" && (
        <button type="button" onClick={() => setEditing("new")} className="mt-5 min-h-11 self-start font-semibold text-ngoc" data-testid="notes-new">
          {t("review.notes.addFree")}
        </button>
      )}
    </Screen>
  );
}
