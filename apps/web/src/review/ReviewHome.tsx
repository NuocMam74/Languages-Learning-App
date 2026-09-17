import type { ContentIndex } from "@parlo/core";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { l, plural, t, type MessageKey } from "../i18n/index.ts";
import { useNotes } from "../notes/store.ts";
import { useOnline } from "../use-online.ts";
import type { LibraryData } from "./data.ts";
import { EmptyState } from "./ui.tsx";

/**
 * Accueil de « Réviser » (contrat phase8 §2, §4) : la bibliothèque de tout ce qui a été vu dans la
 * langue active. Chaque rayon annonce ce qu'il contient — on ne clique jamais pour découvrir un vide.
 * Les jeux, défis et examens gardent leurs écrans : on y renvoie, on ne les réinvente pas.
 */
export default function ReviewHome({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const online = useOnline();
  const notes = useNotes((s) => s.notes);
  const empty = data.concepts.length === 0 && data.grammar.length === 0 && data.completed.size === 0 && notes.length === 0;

  const sections: { to: string; label: MessageKey; count: string; testId: string }[] = [
    { to: "/reviser/vocabulaire", label: "review.section.vocabulary", count: plural("review.count.words", "review.count.words.plural", data.concepts.length), testId: "review-vocabulary" },
    { to: "/reviser/grammaire", label: "review.section.grammar", count: plural("review.count.cards", "review.count.cards.plural", data.grammar.length), testId: "review-grammar" },
    { to: "/reviser/lecons", label: "review.section.lessons", count: plural("review.count.lessons", "review.count.lessons.plural", data.completed.size), testId: "review-lessons" },
    { to: "/reviser/dialogues", label: "review.section.dialogues", count: plural("review.count.dialogues", "review.count.dialogues.plural", data.dialogues.length), testId: "review-dialogues" },
    { to: "/reviser/notes", label: "review.section.notes", count: plural("review.count.notes", "review.count.notes.plural", notes.length), testId: "review-notes" },
  ];

  return (
    <Screen>
      <header className="pt-2 pb-4">
        <h1 className="font-serif text-2xl">{t("review.title")}</h1>
        <p className="text-phu-sa">{t("review.intro", { lang: l(content.pack.name) })}</p>
      </header>

      {empty ? (
        <EmptyState
          testId="review-empty"
          title={t("review.empty.title")}
          body={t("review.empty.body")}
          action={<Link to="/seance" className="min-h-11 py-2 font-semibold text-ngoc">{t("review.empty.cta")}</Link>}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {sections.map((section) => (
            <li key={section.to}>
              <Link
                to={section.to}
                data-testid={section.testId}
                className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-phu-sa/10 bg-white/70 px-4 py-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{t(section.label)}</span>
                  <span className="text-sm text-phu-sa">{section.count}</span>
                </span>
                <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-phu-sa" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M9 5l7 7-7 7" /></svg>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-7 mb-2 text-sm font-semibold text-phu-sa">{t("review.more.title")}</h2>
      <nav className="flex flex-col border-y border-phu-sa/10" aria-label={t("review.more.title")}>
        {data.dueCount > 0 && (
          <Link to="/revision" className="flex min-h-12 items-center justify-between gap-3 py-2 font-medium text-ngoc" data-testid="review-due">
            <span>{t("review.more.due")}</span>
            <span className="text-sm">{plural("review.more.dueCount", "review.more.dueCount.plural", data.dueCount)}</span>
          </Link>
        )}
        <Link to="/jeux" className="flex min-h-12 items-center border-t border-phu-sa/10 py-2 first:border-t-0">{t("review.more.games")}</Link>
        <Link to="/defis" className="flex min-h-12 items-center border-t border-phu-sa/10 py-2">{t("review.more.challenges")}</Link>
        <Link to="/examens" className="flex min-h-12 items-center border-t border-phu-sa/10 py-2">{t("review.more.exams")}</Link>
      </nav>

      {!online && <p className="mt-4 rounded-xl bg-phu-sa/5 px-4 py-2 text-sm text-phu-sa">{t("review.more.offline")}</p>}
    </Screen>
  );
}
