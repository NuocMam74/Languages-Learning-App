import type { NoteRow } from "../db.ts";

/**
 * Export des notes (contrat phase8 §3) : Markdown lisible et JSON réutilisable, **hors ligne**
 * (tout est déjà sur l'appareil). Une note exportée cite toujours sa source — un mot, une leçon,
 * une carte culture, un dialogue — sinon elle est illisible six mois plus tard.
 *
 * Fonctions pures : les libellés arrivent déjà traduits (les tests vérifient la forme du fichier).
 */

export interface NoteExportItem {
  note: NoteRow;
  /** Source, déjà localisée : « cà phê — café », « Leçon : Se saluer », « Note libre »… */
  title: string;
  /** Précision facultative : unité, type d'élément. */
  detail?: string;
}

export interface NoteExportHead {
  /** « Mes notes — Vietnamien du Sud » */
  title: string;
  /** « Exporté le 17/09/2026 » */
  exportedAt: string;
  /** « Modifiée le {date} » déjà formaté, par note (même ordre que `items`). */
  updatedLabels: readonly string[];
}

/**
 * Markdown : un titre, une ligne de date, puis une section par note.
 * Chaque section porte la source en titre de niveau 2, la précision en italique, puis le texte.
 */
export function notesMarkdown(items: readonly NoteExportItem[], head: NoteExportHead): string {
  const lines: string[] = [`# ${head.title}`, "", head.exportedAt, ""];
  items.forEach((item, index) => {
    lines.push(`## ${item.title}`, "");
    if (item.detail) lines.push(`*${item.detail}*`, "");
    // Une note peut contenir des sauts de ligne : ils sont conservés tels quels.
    lines.push(item.note.text, "");
    const updated = head.updatedLabels[index];
    if (updated) lines.push(`*${updated}*`, "");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

export interface NotesJson {
  app: "parlo";
  kind: "notes";
  exportedAt: string;
  packCode: string;
  notes: {
    id: string;
    targetKind: NoteRow["targetKind"];
    targetId: string | null;
    source: { title: string; detail?: string };
    text: string;
    createdAt: string;
    updatedAt: string;
  }[];
}

export function notesJson(items: readonly NoteExportItem[], meta: { packCode: string; exportedAt: string }): NotesJson {
  return {
    app: "parlo",
    kind: "notes",
    exportedAt: meta.exportedAt,
    packCode: meta.packCode,
    notes: items.map(({ note, title, detail }) => ({
      id: note.id,
      targetKind: note.targetKind,
      targetId: note.targetId,
      source: { title, ...(detail ? { detail } : {}) },
      text: note.text,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
  };
}

/** Nom de fichier proposé : `parlo-notes-2026-09-17.md`. */
export function exportFilename(exportedAt: string, extension: "md" | "json"): string {
  return `parlo-notes-${exportedAt.slice(0, 10)}.${extension}`;
}

/** Enregistre un texte sur l'appareil (aucun réseau : les notes ne sortent jamais d'ici). */
export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
