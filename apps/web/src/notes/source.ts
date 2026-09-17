import type { ContentIndex, UnitId } from "@parlo/core";
import type { NoteRow } from "../db.ts";
import { l, t } from "../i18n/index.ts";
import { conceptUnits } from "../review/library.ts";

/**
 * De quoi parle une note : le mot, la leçon, la carte culture ou le dialogue d'origine.
 * Sert à l'affichage (page Notes) comme à l'export — « une note exportée cite le mot ou la
 * leçon d'origine » (contrat phase8 §3).
 */

export interface NoteSource {
  /** Titre lisible, complet : « cà phê — café », « Leçon : Se saluer », « Note libre »… (export). */
  title: string;
  /** Précision : unité, type d'élément. */
  detail?: string;
  /** Texte de la langue apprise à composer en serif, quand il y en a un. */
  vi?: string;
  /** À l'écran, ce qui reste à dire une fois `vi` affiché en serif (le sens du mot). */
  subtitle?: string;
}

/** Résout les sources d'un lot de notes en une passe (les index d'unités ne sont construits qu'une fois). */
export function noteSources(content: ContentIndex, notes: readonly NoteRow[]): Map<string, NoteSource> {
  const units = conceptUnits(content);
  const unitOf = new Map<string, UnitId>();
  const unitTitle = new Map<UnitId, string>();
  for (const unit of content.curriculum.units) {
    unitTitle.set(unit.id, l(unit.title));
    for (const lessonId of unit.lessons) unitOf.set(lessonId, unit.id);
  }
  const titleOfUnit = (unit: UnitId | undefined) => (unit ? unitTitle.get(unit) : undefined);

  const out = new Map<string, NoteSource>();
  for (const note of notes) {
    out.set(note.id, resolve(content, note, { units, unitOf, titleOfUnit }));
  }
  return out;
}

interface Index {
  units: ReadonlyMap<string, UnitId>;
  unitOf: ReadonlyMap<string, UnitId>;
  titleOfUnit: (unit: UnitId | undefined) => string | undefined;
}

function resolve(content: ContentIndex, note: NoteRow, index: Index): NoteSource {
  const id = note.targetId;
  switch (note.targetKind) {
    case "concept": {
      const concept = id ? content.concepts.get(id) : undefined;
      if (!concept) return unknown(note);
      const detail = index.titleOfUnit(index.units.get(concept.id));
      return { title: `${concept.vi} — ${l(concept.gloss)}`, vi: concept.vi, subtitle: l(concept.gloss), ...(detail ? { detail } : {}) };
    }
    case "lesson": {
      const lesson = id ? content.lessons.get(id) : undefined;
      if (!lesson) return unknown(note);
      const detail = index.titleOfUnit(index.unitOf.get(lesson.id));
      return { title: t("review.notes.source.lesson", { title: l(lesson.title) }), ...(detail ? { detail } : {}) };
    }
    case "culture": {
      const card = id ? content.culture.get(id) : undefined;
      if (!card) return unknown(note);
      return { title: l(card.title), detail: t("review.notes.kind.culture"), ...(card.vi ? { vi: card.vi } : {}) };
    }
    case "dialogue": {
      const dialogue = id ? content.dialogues.get(id) : undefined;
      if (!dialogue) return unknown(note);
      return { title: l(dialogue.title), detail: t("review.notes.kind.dialogue") };
    }
    case "free":
      return { title: t("review.notes.source.free") };
  }
}

/** Cible absente du contenu chargé (unité pas encore téléchargée, contenu mis à jour) : on reste honnête. */
function unknown(note: NoteRow): NoteSource {
  return { title: note.targetId ?? t("review.notes.source.free"), detail: t("review.notes.source.unknown") };
}
