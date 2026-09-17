import { uuidv7 } from "@parlo/core";
import { create } from "zustand";
import { db, type NoteRow, type NoteTargetKind } from "../db.ts";
import { activePackCode } from "../packs/active.ts";

/**
 * Notes personnelles (contrat phase8 §3), **locales et propres à une langue** : jamais d'événement,
 * jamais d'outbox, jamais d'envoi au serveur (minimisation, spec §14). Elles font partie de
 * l'export local RGPD (`exportLocalData`) et de l'export dédié de la page Notes.
 */

/** Une note plus longue qu'un paragraphe n'est plus une note : on borne sans jamais tronquer en silence. */
export const MAX_NOTE_LENGTH = 2000;

export interface NoteTarget {
  kind: NoteTargetKind;
  /** null pour une note libre. */
  id: string | null;
}

export const FREE_TARGET: NoteTarget = { kind: "free", id: null };

/** Clé de regroupement d'une cible (une note libre n'en partage aucune). */
export function targetKey(target: NoteTarget): string {
  return `${target.kind}:${target.id ?? ""}`;
}

export const noteTarget = (note: NoteRow): NoteTarget => ({ kind: note.targetKind, id: note.targetId });

/** Notes d'un pack, de la plus récemment modifiée à la plus ancienne. */
export async function readNotes(pack: string = activePackCode()): Promise<NoteRow[]> {
  const rows = await db().notes.where("packCode").equals(pack).toArray();
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
}

export async function writeNote(
  input: { id?: string; target: NoteTarget; text: string },
  pack: string = activePackCode(),
  now: Date = new Date(),
): Promise<NoteRow | null> {
  const text = input.text.trim().slice(0, MAX_NOTE_LENGTH);
  const at = now.toISOString();
  // Vider une note existante, c'est la supprimer ; une note vide ne se crée pas.
  if (text === "") {
    if (input.id) await db().notes.delete(input.id);
    return null;
  }
  const existing = input.id ? await db().notes.get(input.id) : undefined;
  const row: NoteRow = {
    id: existing?.id ?? input.id ?? uuidv7(now),
    packCode: existing?.packCode ?? pack,
    targetKind: input.target.kind,
    targetId: input.target.id,
    text,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  await db().notes.put(row);
  return row;
}

export async function removeNote(id: string): Promise<void> {
  await db().notes.delete(id);
}

/** Notes groupées par cible : une seule lecture pour toute une liste de mots. */
export function groupByTarget(notes: readonly NoteRow[]): Map<string, NoteRow[]> {
  const out = new Map<string, NoteRow[]>();
  for (const note of notes) {
    const key = targetKey(noteTarget(note));
    const list = out.get(key);
    if (list) list.push(note);
    else out.set(key, [note]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// État partagé des écrans

interface NotesState {
  pack: string | null;
  notes: NoteRow[];
  loading: boolean;
  /** Charge les notes du pack (une fois), ou les recharge si le pack a changé. */
  load: (pack?: string, force?: boolean) => Promise<void>;
  save: (input: { id?: string; target: NoteTarget; text: string }) => Promise<NoteRow | null>;
  remove: (id: string) => Promise<void>;
}

export const useNotes = create<NotesState>((set, get) => ({
  pack: null,
  notes: [],
  loading: false,

  async load(pack = activePackCode(), force = false) {
    if (!force && get().pack === pack) return;
    set({ loading: true });
    const notes = await readNotes(pack);
    set({ pack, notes, loading: false });
  },

  async save(input) {
    const pack = get().pack ?? activePackCode();
    const row = await writeNote(input, pack);
    set({ pack, notes: await readNotes(pack) });
    return row;
  },

  async remove(id) {
    const pack = get().pack ?? activePackCode();
    await removeNote(id);
    set({ pack, notes: await readNotes(pack) });
  },
}));
