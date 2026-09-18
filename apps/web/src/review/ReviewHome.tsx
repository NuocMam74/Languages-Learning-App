import type { ContentIndex } from "@parlo/core";
import { useMemo } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon, PageHeader, SectionTitle, type IconName } from "../design/index.ts";
import { l, plural, t, type MessageKey } from "../i18n/index.ts";
import { useNotes } from "../notes/store.ts";
import { useOnline } from "../use-online.ts";
import type { LibraryData } from "./data.ts";
import { byPos, byTheme } from "./library.ts";

/**
 * Accueil de « Réviser » (contrat phase8 §2, §4) : la bibliothèque de tout ce qui a été vu dans la
 * langue active. Chaque rayon annonce ce qu'il contient — on ne clique jamais pour découvrir un vide.
 * Les jeux, défis et examens gardent leurs écrans : on y renvoie, on ne les réinvente pas.
 *
 * Hiérarchie (contrat §1) : cinq rayons identiques ne sont pas une bibliothèque. Quand des mots sont
 * dus, le rayon vocabulaire passe en `feature` — c'est là qu'il faut aller aujourd'hui ; sinon la
 * liste est homogène et **aucune** carte ne se décolle. L'unique moment animé est leur cascade.
 */

type Shelf = { to: string; label: MessageKey; icon: IconName; count: string; testId: string };

export default function ReviewHome({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const online = useOnline();
  const notes = useNotes((s) => s.notes);
  // Les conseils se lisent dès le premier jour : tant qu'il y en a, la bibliothèque n'est pas vide.
  const empty =
    data.concepts.length === 0 && data.grammar.length === 0 && data.completed.size === 0 && notes.length === 0 && content.guides.size === 0;
  const due = data.dueCount > 0;
  // On n'annonce que les rayons **ouverts** : promettre « 12 catégories » puis n'en laisser cliquer
  // que trois serait une fausse promesse.
  const categories = useMemo(() => byPos(content, data.concepts).filter((s) => s.entries.length > 0).length, [content, data.concepts]);
  const themes = useMemo(() => byTheme(content, data.concepts).filter((s) => s.entries.length > 0).length, [content, data.concepts]);

  const shelves: Shelf[] = [
    { to: "/reviser/vocabulaire", label: "review.section.vocabulary", icon: "cards", count: plural("review.count.words", "review.count.words.plural", data.concepts.length), testId: "review-vocabulary" },
    { to: "/reviser/conseils", label: "review.section.tips", icon: "info", count: plural("review.count.tips", "review.count.tips.plural", content.guides.size), testId: "review-tips" },
    { to: "/reviser/categories", label: "review.section.categories", icon: "grammar", count: plural("review.count.categories", "review.count.categories.plural", categories), testId: "review-categories" },
    { to: "/reviser/themes", label: "review.section.themes", icon: "book", count: plural("review.count.themes", "review.count.themes.plural", themes), testId: "review-themes" },
    { to: "/reviser/grammaire", label: "review.section.grammar", icon: "grammar", count: plural("review.count.cards", "review.count.cards.plural", data.grammar.length), testId: "review-grammar" },
    { to: "/reviser/lecons", label: "review.section.lessons", icon: "book", count: plural("review.count.lessons", "review.count.lessons.plural", data.completed.size), testId: "review-lessons" },
    { to: "/reviser/dialogues", label: "review.section.dialogues", icon: "dialogue", count: plural("review.count.dialogues", "review.count.dialogues.plural", data.dialogues.length), testId: "review-dialogues" },
    { to: "/reviser/notes", label: "review.section.notes", icon: "notebook", count: plural("review.count.notes", "review.count.notes.plural", notes.length), testId: "review-notes" },
  ];

  const more: { to: string; label: MessageKey; icon: IconName }[] = [
    { to: "/jeux", label: "review.more.games", icon: "games" },
    // Les missions vivent ici aussi : c'est la page où l'on vient chercher quoi faire (phase9 §3).
    { to: "/missions", label: "review.more.missions", icon: "target" },
    { to: "/defis", label: "review.more.challenges", icon: "trophy" },
    { to: "/examens", label: "review.more.exams", icon: "diploma" },
  ];

  return (
    <Screen>
      <PageHeader title={t("review.title")} subtitle={t("review.intro", { lang: l(content.pack.name) })} />

      {empty ? (
        <EmptyState
          data-testid="review-empty"
          art="boat"
          title={t("review.empty.title")}
          body={t("review.empty.body")}
          action={
            <Link to="/seance" className="inline-flex min-h-12 items-center rounded-card bg-ngoc px-5 font-semibold text-nuoc">
              {t("review.empty.cta")}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {shelves.map((shelf, index) => (
            // Le rayon dû porte le poids de l'écran ; les autres restent posés (contrat §1).
            <Card key={shelf.to} as="li" tone={due && index === 0 ? "feature" : "plain"} stagger={index}>
              <Link to={shelf.to} data-testid={shelf.testId} className="-mx-5 -my-4 flex min-h-16 items-center gap-3 rounded-card px-5 py-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ngoc-sang text-ngoc">
                  <Icon name={shelf.icon} size={22} />
                </span>
                <span className="min-w-0 flex-1 font-medium">{t(shelf.label)}</span>
                <Chip tone={due && index === 0 ? "solid" : "neutral"}>{shelf.count}</Chip>
                <Icon name="chevronRight" size={20} className="text-phu-sa" />
              </Link>
            </Card>
          ))}
        </ul>
      )}

      <SectionTitle tone="banner" icon="lantern" className="mt-7 mb-3">
        {t("review.more.title")}
      </SectionTitle>

      <nav aria-label={t("review.more.title")} className="flex flex-col gap-2.5">
        {due && (
          <Card tone="notice">
            <Link to="/revision" data-testid="review-due" className="-mx-5 -my-4 flex min-h-16 items-center gap-3 rounded-card px-5 py-4 font-medium">
              <Icon name="refresh" size={22} className="text-nghe" />
              <span className="min-w-0 flex-1">{t("review.more.due")}</span>
              <Chip tone="outline">{plural("review.more.dueCount", "review.more.dueCount.plural", data.dueCount)}</Chip>
            </Link>
          </Card>
        )}
        {/* Trois portes de sortie, jamais trois soulignés nus : une grille lisible au pouce. */}
        <ul className="grid grid-cols-3 gap-2.5">
          {more.map((item) => (
            <Card key={item.to} as="li" tone="quiet">
              <Link to={item.to} className="-mx-5 -my-4 flex min-h-24 flex-col items-center justify-center gap-2 rounded-card px-2 py-4 text-center">
                <Icon name={item.icon} size={24} className="text-ngoc" />
                <span className="text-sm leading-snug font-medium">{t(item.label)}</span>
              </Link>
            </Card>
          ))}
        </ul>
      </nav>

      {!online && (
        <Card tone="quiet" className="mt-4 flex items-center gap-2.5">
          <Icon name="offline" size={18} className="text-phu-sa" />
          <p className="text-sm text-phu-sa">{t("review.more.offline")}</p>
        </Card>
      )}
    </Screen>
  );
}
