import { isDue, type ContentIndex, type DialogueId, type LessonId, type SrsCard } from "@parlo/core";
import { db, type LessonProgressRow } from "../db.ts";
import { openLessons, packCards, progressState } from "../learner.ts";
import { grammarEntries, seenConcepts, seenDialogues, type GrammarEntry, type SeenConcept } from "./library.ts";

/**
 * Tout ce que la bibliothèque « Réviser » a besoin de lire, en une passe (contrat phase8 §2).
 * Lecture locale seulement : ce qui est dans IndexedDB suffit, donc tout marche hors ligne pour
 * les unités téléchargées. Les unités absentes n'apportent rien — elles ne cassent rien.
 */
export interface LibraryData {
  completed: ReadonlySet<LessonId>;
  passed: ReadonlySet<LessonId>;
  open: ReadonlySet<LessonId>;
  cards: SrsCard[];
  /** Meilleur score et tentatives par leçon terminée. */
  progress: ReadonlyMap<LessonId, LessonProgressRow>;
  concepts: SeenConcept[];
  grammar: GrammarEntry[];
  dialogues: DialogueId[];
  dueCount: number;
  /** Instant de référence : tous les états SRS affichés sont cohérents entre eux. */
  now: Date;
}

export async function loadLibrary(content: ContentIndex, now = new Date()): Promise<LibraryData> {
  const pack = content.pack.code;
  const [state, cards, rows] = await Promise.all([
    progressState(content),
    packCards(pack),
    db().lessonProgress.where("packCode").equals(pack).toArray(),
  ]);
  return {
    completed: state.completed,
    passed: state.passed,
    open: openLessons(content, state),
    cards,
    progress: new Map(rows.map((row) => [row.lessonId, row])),
    concepts: seenConcepts(content, { completed: state.completed, cards, now }),
    grammar: grammarEntries(content, state.completed),
    dialogues: seenDialogues(content, state.completed),
    dueCount: cards.filter((card) => isDue(card, now)).length,
    now,
  };
}
