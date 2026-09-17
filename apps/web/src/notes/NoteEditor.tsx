import { useState } from "react";
import { t } from "../i18n/index.ts";
import { VietnameseInput } from "../input/VietnameseInput.tsx";
import { MAX_NOTE_LENGTH } from "./store.ts";

/**
 * Saisie d'une note (contrat phase8 §3) : champ confortable (≥ 16 px, `text-lg` = 19 px) avec le
 * clavier vietnamien Telex/VNI et sa barre de diacritiques — on écrit une note *sur* un mot, donc
 * on doit pouvoir écrire ce mot. Entrée valide, comme le bouton du bas.
 */
export function NoteEditor({
  initial = "",
  onSave,
  onCancel,
  onDelete,
  testId = "note-editor",
}: {
  initial?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
  testId?: string;
}) {
  const [text, setText] = useState(initial);
  const clean = text.trim();
  const submit = () => {
    if (clean === "") return;
    onSave(clean.slice(0, MAX_NOTE_LENGTH));
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-phu-sa/15 bg-white/70 p-3" data-testid={testId}>
      <VietnameseInput value={text} onChange={(value) => setText(value.slice(0, MAX_NOTE_LENGTH))} onSubmit={submit} label={t("review.notes.label")} target />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" disabled={clean === ""} onClick={submit} data-testid="note-save" className="min-h-11 rounded-xl bg-ngoc px-4 font-semibold text-nuoc disabled:bg-phu-sa/20 disabled:text-phu-sa/60">
          {t("review.notes.save")}
        </button>
        <button type="button" onClick={onCancel} data-testid="note-cancel" className="min-h-11 font-semibold text-ngoc">
          {t("common.cancel")}
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} data-testid="note-delete" className="min-h-11 font-semibold text-son-mai">
            {t("review.notes.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
