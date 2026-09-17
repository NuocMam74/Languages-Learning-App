import { useEffect, useState } from "react";
import { Icon } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import { NoteEditor } from "./NoteEditor.tsx";
import { useNotes, type NoteTarget } from "./store.ts";

/**
 * Bloc « ma note » attaché à un élément : fiche d'un mot, carte grammaire ou culture, dialogue,
 * fin de leçon (contrat phase8 §3). Même composant partout — écrire une note se fait toujours
 * du même geste, et les notes restent locales.
 */
export function NoteBlock({ target, testId = "note-block" }: { target: NoteTarget; testId?: string }) {
  const notes = useNotes((s) => s.notes);
  const load = useNotes((s) => s.load);
  const save = useNotes((s) => s.save);
  const remove = useNotes((s) => s.remove);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = notes.filter((note) => note.targetKind === target.kind && note.targetId === target.id);

  return (
    <div className="flex flex-col gap-2" data-testid={testId} data-count={mine.length}>
      {mine.map((note) =>
        editing === note.id ? (
          <NoteEditor
            key={note.id}
            initial={note.text}
            onSave={(text) => void save({ id: note.id, target, text }).then(() => setEditing(null))}
            onCancel={() => setEditing(null)}
            onDelete={() => void remove(note.id).then(() => setEditing(null))}
          />
        ) : (
          <div key={note.id} className="flex items-start justify-between gap-3 rounded-field border-l-4 border-nghe bg-surface-nghe px-3 py-2" data-testid="note-item">
            <p className="min-w-0 break-words" data-testid="note-text">{note.text}</p>
            <button type="button" onClick={() => setEditing(note.id)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-semibold text-ngoc" data-testid="note-edit">
              <Icon name="pencil" size={16} />
              {t("review.notes.edit")}
            </button>
          </div>
        ),
      )}

      {editing === "new" ? (
        <NoteEditor onSave={(text) => void save({ target, text }).then(() => setEditing(null))} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" onClick={() => setEditing("new")} className="inline-flex min-h-11 items-center gap-1.5 self-start text-left font-semibold text-ngoc" data-testid="note-add">
          <Icon name="plus" size={18} />
          {t("review.notes.add")}
        </button>
      )}
    </div>
  );
}

/** Note personnelle sur la leçon qu'on vient de terminer (bilan de séance). */
export function LessonNoteBlock({ lessonId }: { lessonId: string }) {
  return <NoteBlock target={{ kind: "lesson", id: lessonId }} testId="lesson-note" />;
}
