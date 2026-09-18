import {
  isDue,
  isMastered,
  stripDiacritics,
  type ConceptId,
  type ContentIndex,
  type DialogueId,
  type LessonId,
  type Localized,
  type PartOfSpeech,
  type SrsCard,
  type UnitId,
} from "@parlo/core";

/**
 * Sélection de « tout ce qui a été vu » (contrat phase8 §2), sans Dexie ni React : des fonctions
 * pures sur l'index de contenu, la progression et les cartes SRS. Les écrans de `src/review/` les
 * appellent ; les tests les vérifient sans navigateur.
 *
 * Deux portes d'entrée dans la bibliothèque, l'une ou l'autre suffit :
 *   - le concept a une carte SRS (leçon faite, placement, révision d'une autre langue du même pack) ;
 *   - le concept appartient à une leçon **terminée**.
 */

/** Rechutes à partir desquelles un mot est « difficile » (contrat phase8 §2). */
export const HARD_LAPSES = 2;

export type LibraryState = "new" | "due" | "hard" | "mastered" | "scheduled";

export const LIBRARY_FILTERS = ["all", "due", "hard", "mastered", "new"] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

export interface SeenConcept {
  conceptId: ConceptId;
  /** Unité d'origine ; `""` si le contenu ne la connaît pas (carte orpheline). */
  unit: UnitId;
  /** Première leçon terminée qui l'introduit ; null s'il n'est connu que par le SRS. */
  lessonId: LessonId | null;
  card: SrsCard | null;
  state: LibraryState;
}

/**
 * État affiché d'un mot. Un seul jeton par mot, du plus actionnable au plus rassurant :
 * jamais travaillé → difficile → à revoir → maîtrisé → planifié.
 */
export function conceptState(card: SrsCard | null | undefined, now: Date): LibraryState {
  if (!card || card.state === "new") return "new";
  if (card.lapses >= HARD_LAPSES) return "hard";
  if (isDue(card, now)) return "due";
  if (isMastered(card)) return "mastered";
  return "scheduled";
}

/**
 * Le mot entre-t-il dans ce filtre ? Les critères se recouvrent volontairement (un mot difficile
 * peut être dû) : filtrer sur `difficile` ne doit pas cacher ce qui est aussi à revoir.
 */
export function matchesFilter(entry: Pick<SeenConcept, "card">, filter: LibraryFilter, now: Date): boolean {
  const card = entry.card;
  switch (filter) {
    case "all":
      return true;
    case "new":
      return !card || card.state === "new";
    case "due":
      return card !== null && isDue(card, now);
    case "hard":
      return card !== null && card.lapses >= HARD_LAPSES;
    case "mastered":
      return card !== null && isMastered(card);
  }
}

/**
 * Forme de recherche : sans accents **ni tons**, sans ponctuation, en minuscules.
 * « cà phê » et « ca phe » se trouvent l'un l'autre ; « ĐÂU » se trouve par « dau ».
 */
export function searchKey(text: string): string {
  return stripDiacritics(text.normalize("NFC"))
    .toLowerCase()
    .replace(/[^\p{L}\p{Nd}]+/gu, " ")
    .trim();
}

/** La requête (déjà saisie librement) apparaît-elle dans l'un des champs ? Requête vide = tout passe. */
export function matchesSearch(query: string, fields: readonly (string | undefined)[]): boolean {
  const needle = searchKey(query);
  if (needle === "") return true;
  return fields.some((field) => field !== undefined && searchKey(field).includes(needle));
}

/** Jours entiers avant l'échéance (0 = aujourd'hui ou déjà dû). */
export function daysUntilDue(card: SrsCard, now: Date): number {
  const ms = Date.parse(card.due) - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** Unité qui porte chaque concept : le découpage la connaît, sinon la première leçon qui le cite. */
export function conceptUnits(content: ContentIndex): ReadonlyMap<ConceptId, UnitId> {
  const map = new Map<ConceptId, UnitId>(content.split?.conceptUnits ?? []);
  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      for (const id of content.lessons.get(lessonId)?.concepts ?? []) if (!map.has(id)) map.set(id, unit.id);
    }
  }
  return map;
}

export interface SeenInput {
  completed: ReadonlySet<LessonId>;
  cards: readonly SrsCard[];
  now: Date;
}

/**
 * Tous les concepts rencontrés, dans l'ordre du cursus (unité, puis leçon, puis ordre d'introduction).
 * Les concepts connus par le seul SRS ferment la marche de leur unité.
 */
export function seenConcepts(content: ContentIndex, { completed, cards, now }: SeenInput): SeenConcept[] {
  const cardOf = new Map(cards.map((c) => [c.conceptId, c]));
  const units = conceptUnits(content);
  const out = new Map<ConceptId, SeenConcept>();

  const add = (conceptId: ConceptId, unit: UnitId, lessonId: LessonId | null) => {
    if (out.has(conceptId) || !content.concepts.has(conceptId)) return;
    const card = cardOf.get(conceptId) ?? null;
    out.set(conceptId, { conceptId, unit, lessonId, card, state: conceptState(card, now) });
  };

  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      if (!completed.has(lessonId)) continue;
      const lesson = content.lessons.get(lessonId);
      if (!lesson) continue;
      for (const id of [...lesson.review.srsIntroduce, ...lesson.concepts]) add(id, unit.id, lessonId);
    }
  }
  for (const card of cards) add(card.conceptId, units.get(card.conceptId) ?? "", null);

  // Tri final : ordre des unités du cursus, puis ordre d'insertion (cursus, puis cartes orphelines).
  const order = new Map(content.curriculum.units.map((u, i) => [u.id, i]));
  const rank = (unit: UnitId) => order.get(unit) ?? Number.MAX_SAFE_INTEGER;
  return [...out.values()]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry.unit) - rank(b.entry.unit) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Unités représentées dans une liste de concepts vus, dans l'ordre du cursus. */
export function seenUnits(content: ContentIndex, entries: readonly SeenConcept[]): UnitId[] {
  const present = new Set(entries.map((e) => e.unit));
  return content.curriculum.units.filter((u) => present.has(u.id)).map((u) => u.id);
}

// ---------------------------------------------------------------------------
// Grammaire et culture

export type GrammarKind = "explain" | "note" | "culture";

export interface GrammarEntry {
  /** Stable d'un rendu à l'autre : sert de clé React et de cible de note. */
  id: string;
  kind: GrammarKind;
  unit: UnitId;
  lessonId: LessonId | null;
  /** Mot ou expression concerné (langue cible). */
  vi?: string;
  /** Titre localisable (carte culture). */
  title?: Localized;
  body: Localized;
  /** Élément auquel une note personnelle se rattache. */
  target: { kind: "lesson" | "concept" | "culture"; id: string };
}

/**
 * Les explications du contenu, lisibles hors séance : `explain` des étapes jouées, notes de concept,
 * cartes culture — pour les leçons **terminées** seulement (la bibliothèque ne divulgâche rien).
 * Une unité non chargée n'a pas d'étapes : elle n'apporte simplement rien (hors ligne compris).
 */
export function grammarEntries(content: ContentIndex, completed: ReadonlySet<LessonId>): GrammarEntry[] {
  const out: GrammarEntry[] = [];
  const seenBody = new Set<string>();
  const push = (entry: GrammarEntry) => {
    const key = `${entry.kind}:${entry.vi ?? ""}:${entry.body.fr}`;
    if (entry.body.fr.trim() === "" || seenBody.has(key)) return;
    seenBody.add(key);
    out.push(entry);
  };

  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      if (!completed.has(lessonId)) continue;
      const lesson = content.lessons.get(lessonId);
      if (!lesson) continue;

      lesson.steps.forEach((step, index) => {
        if (step.type === "culture_card") {
          const card = content.culture.get(step.ref);
          if (card) {
            push({
              id: `culture:${card.id}`, kind: "culture", unit: unit.id, lessonId,
              ...(card.vi ? { vi: card.vi } : {}), title: card.title, body: card.body,
              target: { kind: "culture", id: card.id },
            });
          }
          return;
        }
        const explain = "explain" in step ? step.explain : undefined;
        if (explain) {
          push({
            id: `explain:${lessonId}:${index}`, kind: "explain", unit: unit.id, lessonId,
            title: lesson.title, body: explain, target: { kind: "lesson", id: lessonId },
          });
        }
      });

      for (const conceptId of lesson.concepts) {
        const concept = content.concepts.get(conceptId);
        if (!concept?.note) continue;
        push({
          id: `note:${conceptId}`, kind: "note", unit: unit.id, lessonId,
          vi: concept.vi, body: concept.note, target: { kind: "concept", id: conceptId },
        });
      }
    }
  }
  return out;
}

/** Dialogues rencontrés : ceux que cite une étape `listen_gist` d'une leçon terminée. */
export function seenDialogues(content: ContentIndex, completed: ReadonlySet<LessonId>): DialogueId[] {
  const out: DialogueId[] = [];
  for (const unit of content.curriculum.units) {
    for (const lessonId of unit.lessons) {
      if (!completed.has(lessonId)) continue;
      for (const step of content.lessons.get(lessonId)?.steps ?? []) {
        if (step.type === "listen_gist" && content.dialogues.has(step.dialogue) && !out.includes(step.dialogue)) out.push(step.dialogue);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Index : par catégorie grammaticale, par thème

/**
 * Ordre d'affichage des catégories (contrat phase14 §1). Il suit l'utilité pour un francophone qui
 * révise : d'abord ce qui porte le sens (noms, verbes, adjectifs), puis ce qui structure la phrase,
 * enfin les classes propres au vietnamien — classificateurs et particules finales, qu'on ne trouve
 * dans aucun manuel de français et qu'il faut pouvoir réviser en bloc.
 */
export const POS_ORDER: readonly PartOfSpeech[] = [
  "noun", "verb", "adjective", "adverb", "pronoun", "numeral",
  "classifier", "particle", "question", "preposition", "conjunction", "phrase",
];

/** Rayon de l'index : une catégorie ou un thème, avec ce qui a été vu et ce qui reste à venir. */
export interface IndexShelf<K extends string> {
  key: K;
  /** Concepts déjà rencontrés, dans l'ordre du cursus. */
  entries: SeenConcept[];
  /** Concepts du pack qui n'ont pas encore été vus : annoncés en nombre, jamais divulgués. */
  toCome: number;
}

/**
 * Regroupe les mots vus par catégorie grammaticale, et compte ceux qui restent à découvrir.
 *
 * Le compte « à venir » porte sur **tout** le pack, pas seulement sur ce qui a été vu : c'est ce qui
 * fait de l'écran un index plutôt qu'une simple liste. Mais on n'en montre que le nombre — la règle
 * de la bibliothèque (ne rien divulgâcher, contrat phase8 §2) tient toujours.
 */
export function byPos(content: ContentIndex, entries: readonly SeenConcept[]): IndexShelf<PartOfSpeech>[] {
  const seen = new Map<PartOfSpeech, SeenConcept[]>();
  const seenIds = new Set<ConceptId>();
  for (const entry of entries) {
    const pos = content.concepts.get(entry.conceptId)?.pos;
    if (!pos) continue;
    seenIds.add(entry.conceptId);
    const list = seen.get(pos);
    if (list) list.push(entry);
    else seen.set(pos, [entry]);
  }

  const total = new Map<PartOfSpeech, number>();
  for (const concept of content.concepts.values()) {
    if (!concept.pos || seenIds.has(concept.id)) continue;
    total.set(concept.pos, (total.get(concept.pos) ?? 0) + 1);
  }

  return POS_ORDER.map((key) => ({ key, entries: seen.get(key) ?? [], toCome: total.get(key) ?? 0 })).filter(
    (shelf) => shelf.entries.length > 0 || shelf.toCome > 0,
  );
}

/**
 * Le même index, par thème : une unité du cursus = un thème. Les unités qu'on n'a pas encore
 * ouvertes y figurent avec leur nombre de mots, pour que l'index montre le chemin entier.
 */
export function byTheme(content: ContentIndex, entries: readonly SeenConcept[]): IndexShelf<UnitId>[] {
  const seen = new Map<UnitId, SeenConcept[]>();
  const seenIds = new Set<ConceptId>();
  for (const entry of entries) {
    seenIds.add(entry.conceptId);
    const list = seen.get(entry.unit);
    if (list) list.push(entry);
    else seen.set(entry.unit, [entry]);
  }

  const units = conceptUnits(content);
  const total = new Map<UnitId, number>();
  for (const [conceptId, unit] of units) {
    if (seenIds.has(conceptId) || !content.concepts.has(conceptId)) continue;
    total.set(unit, (total.get(unit) ?? 0) + 1);
  }

  return content.curriculum.units
    .map((unit) => ({ key: unit.id, entries: seen.get(unit.id) ?? [], toCome: total.get(unit.id) ?? 0 }))
    .filter((shelf) => shelf.entries.length > 0 || shelf.toCome > 0);
}
