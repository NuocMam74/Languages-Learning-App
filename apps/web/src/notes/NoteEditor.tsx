import { useState } from "react";
import { Icon } from "../design/index.ts";
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
    <div className="flex flex-col gap-3 rounded-card border border-line-strong bg-surface p-3" data-testid={testId}>
      <VietnameseInput value={text} onChange={(value) => setText(value.slice(0, MAX_NOTE_LENGTH))} onSubmit={submit} label={t("review.notes.label")} target />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          disabled={clean === ""}
          onClick={submit}
          data-testid="note-save"
          className="inline-flex min-h-11 items-center gap-2 rounded-field bg-ngoc px-4 font-semibold text-nuoc transition-[background-color,transform] motion-safe:active:scale-[.98] disabled:bg-phu-sa/20 disabled:text-phu-sa/60"
        >
          <Icon name="check" size={18} />
          {t("review.notes.save")}
        </button>
        <button type="button" onClick={onCancel} data-testid="note-cancel" className="inline-flex min-h-11 items-center px-2 font-semibold text-ngoc">
          {t("common.cancel")}
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} data-testid="note-delete" className="inline-flex min-h-11 items-center gap-1.5 px-2 font-semibold text-son-mai">
            <Icon name="trash" size={16} />
            {t("review.notes.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
