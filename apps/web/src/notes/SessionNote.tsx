import type { Exercise, LessonId } from "@parlo/core";
import { useEffect, useState } from "react";
import { Icon } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import { NoteBlock } from "./NoteBlock.tsx";
import { FREE_TARGET, targetKey, useNotes, type NoteTarget } from "./store.ts";

/**
 * Prendre une note **pendant** la séance (contrat phase22 §2).
 *
 * Les notes existaient déjà, mais seulement là où l'on ne travaille pas : la fiche d'un mot, le
 * bilan d'une leçon, la page Notes. Or le moment où l'on a quelque chose à noter, c'est l'exercice
 * lui-même — « ah, mả et mã sonnent pareil » se pense là, entre deux questions, et se perd si
 * l'écran ne propose rien.
 *
 * La note se range sur **le mot travaillé** quand l'exercice n'en porte qu'un : elle réapparaît
 * alors sur sa fiche, dans la bibliothèque, et pas seulement dans une liste de fin de séance.
 * Sinon (une phrase à assembler, un appariement, une carte culture) elle se range sur la leçon.
 */
export function noteTargetOf(exercise: Exercise | null, lessonId: LessonId | null): NoteTarget {
  if (exercise && exercise.conceptIds.length === 1) return { kind: "concept", id: exercise.conceptIds[0] as string };
  if (lessonId) return { kind: "lesson", id: lessonId };
  return FREE_TARGET;
}

export function SessionNoteButton({ target, open, onToggle }: { target: NoteTarget; open: boolean; onToggle: () => void }) {
  const notes = useNotes((s) => s.notes);
  const load = useNotes((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  const key = targetKey(target);
  const count = notes.filter((note) => targetKey({ kind: note.targetKind, id: note.targetId }) === key).length;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={t(count > 0 ? "notes.session.openWith" : "notes.session.open", { n: count })}
      data-testid="session-note-button"
      data-count={count}
      className={`relative inline-flex size-11 items-center justify-center rounded-full transition-colors ${open ? "bg-surface-nghe text-ngoc" : "text-phu-sa hover:text-ngoc"}`}
    >
      <Icon name="pencil" size={20} />
      {/* Une pastille, pas un chiffre : on veut savoir qu'il y a déjà quelque chose, pas combien. */}
      {count > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-ngoc" aria-hidden />}
    </button>
  );
}

/** Le bloc de saisie, ouvert sous l'en-tête : il pousse l'exercice, il ne le recouvre pas. */
export function SessionNotePanel({ target }: { target: NoteTarget }) {
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-card border border-line-strong bg-surface-2 p-3" data-testid="session-note-panel">
      <p className="text-sm text-phu-sa">{t("notes.session.hint")}</p>
      <NoteBlock target={target} testId="session-note-block" />
    </div>
  );
}

/** Ouverture du panneau, refermée à chaque changement d'exercice : une note par question, pas un cahier ouvert. */
export function useSessionNote(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [key]);
  return [open, () => setOpen((v) => !v)];
}
