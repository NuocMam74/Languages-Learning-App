import type { ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Skeleton } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import NotesPage from "../notes/NotesPage.tsx";
import { useNotes } from "../notes/store.ts";
import { Dialogues } from "./Dialogues.tsx";
import { Grammar } from "./Grammar.tsx";
import { LessonsList } from "./LessonsList.tsx";
import ReviewHome from "./ReviewHome.tsx";
import { Vocabulary } from "./Vocabulary.tsx";
import { loadLibrary, type LibraryData } from "./data.ts";

/**
 * Section « Réviser » (contrat phase8 §2) : `/reviser` et ses rayons `/reviser/<section>`.
 * Une seule lecture locale alimente tous les écrans — ils n'attendent jamais le réseau.
 */
const SECTIONS = ["vocabulaire", "grammaire", "lecons", "dialogues", "notes"] as const;
type Section = (typeof SECTIONS)[number];

const isSection = (value: string | undefined): value is Section => SECTIONS.includes(value as Section);

export default function ReviewPage({ content }: { content: ContentIndex }) {
  const { section } = useParams();
  const [data, setData] = useState<LibraryData | null>(null);
  const loadNotes = useNotes((s) => s.load);

  useEffect(() => {
    let live = true;
    void Promise.all([loadLibrary(content), loadNotes(content.pack.code)]).then(([library]) => live && setData(library));
    return () => {
      live = false;
    };
  }, [content, loadNotes]);

  // Section inconnue dans l'URL : on revient à la bibliothèque plutôt que d'afficher un vide.
  if (section !== undefined && !isSection(section)) return <Navigate to="/reviser" replace />;
  // Lecture d'IndexedDB : on montre la forme de la bibliothèque, jamais un écran vide (contrat §1).
  if (!data)
    return (
      <Screen>
        <div className="flex flex-col gap-3 pt-2" data-testid="review-loading" role="status" aria-label={t("review.loading")}>
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-64" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} rounded="card" className="h-16 w-full" />
          ))}
        </div>
      </Screen>
    );

  switch (section) {
    case "vocabulaire":
      return <Vocabulary content={content} data={data} />;
    case "grammaire":
      return <Grammar content={content} data={data} />;
    case "lecons":
      return <LessonsList content={content} data={data} />;
    case "dialogues":
      return <Dialogues content={content} data={data} />;
    // Les notes vivent dans « Réviser » (contrat phase8 §4) : sous `/reviser/`, l'onglet du bas
    // reste allumé. `/notes` mène à la même page (contrat §3).
    case "notes":
      return <NotesPage content={content} />;
    default:
      return <ReviewHome content={content} data={data} />;
  }
}
