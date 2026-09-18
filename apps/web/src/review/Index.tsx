import type { ContentIndex, PartOfSpeech, UnitId } from "@parlo/core";
import { useMemo } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon, ProgressBar, type IconName } from "../design/index.ts";
import { l, plural, t, type MessageKey } from "../i18n/index.ts";
import type { LibraryData } from "./data.ts";
import { byPos, byTheme, type IndexShelf } from "./library.ts";
import { enter, LibraryHeader } from "./ui.tsx";

/**
 * Les deux index de la bibliothèque (contrat phase14 §2) : **par catégorie grammaticale** et
 * **par thème**. Ce sont les menus d'étude autonome — on y vient pour réviser « tous les verbes »
 * ou « tout le vocabulaire du marché », sans passer par une séance.
 *
 * Chaque rayon annonce deux nombres : ce qu'on a déjà vu, et ce qui reste à découvrir. Le second
 * donne la taille réelle du domaine — sans jamais montrer les mots eux-mêmes : la bibliothèque ne
 * divulgâche pas le cursus (contrat phase8 §2). Un rayon sans rien de vu n'est donc pas cliquable.
 *
 * Un clic ouvre le vocabulaire déjà filtré : l'index choisit, la liste montre.
 */

export const POS_LABEL: Record<PartOfSpeech, MessageKey> = {
  noun: "review.pos.noun",
  verb: "review.pos.verb",
  adjective: "review.pos.adjective",
  adverb: "review.pos.adverb",
  pronoun: "review.pos.pronoun",
  classifier: "review.pos.classifier",
  numeral: "review.pos.numeral",
  preposition: "review.pos.preposition",
  conjunction: "review.pos.conjunction",
  particle: "review.pos.particle",
  question: "review.pos.question",
  phrase: "review.pos.phrase",
};

const POS_ICON: Record<PartOfSpeech, IconName> = {
  noun: "cards",
  verb: "boat",
  adjective: "lantern",
  adverb: "clock",
  pronoun: "user",
  // Les classificateurs se comptent en bols et en tasses (tô, chén, ly) : l'icône le dit mieux qu'un mot.
  classifier: "bowl",
  numeral: "chart",
  preposition: "globe",
  conjunction: "grammar",
  particle: "sound",
  question: "info",
  phrase: "dialogue",
};
export function Categories({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const shelves = useMemo(() => byPos(content, data.concepts), [content, data.concepts]);
  return (
    <IndexScreen
      title={t("review.section.categories")}
      subtitle={t("review.categories.intro")}
      testId="categories"
      shelves={shelves}
      name={(key) => t(POS_LABEL[key])}
      icon={(key) => POS_ICON[key]}
      href={(key) => `/reviser/vocabulaire?categorie=${key}`}
    />
  );
}

export function Themes({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const shelves = useMemo(() => byTheme(content, data.concepts), [content, data.concepts]);
  const titles = useMemo(() => new Map(content.curriculum.units.map((u) => [u.id, l(u.title)])), [content]);
  return (
    <IndexScreen
      title={t("review.section.themes")}
      subtitle={t("review.themes.intro")}
      testId="themes"
      shelves={shelves}
      name={(key) => titles.get(key) ?? t("review.themes.other")}
      icon={() => "book"}
      href={(key) => `/reviser/vocabulaire?unite=${encodeURIComponent(key)}`}
    />
  );
}

function IndexScreen<K extends PartOfSpeech | UnitId>({ title, subtitle, testId, shelves, name, icon, href }: {
  title: string;
  subtitle: string;
  testId: string;
  shelves: readonly IndexShelf<K>[];
  name: (key: K) => string;
  icon: (key: K) => IconName;
  href: (key: K) => string;
}) {
  const nothing = shelves.every((shelf) => shelf.entries.length === 0);
  return (
    <Screen top={<LibraryHeader title={title} subtitle={subtitle} />}>
      {shelves.length === 0 ? (
        <EmptyState art="page" title={t("review.index.empty.title")} body={t("review.index.empty.body")} data-testid={`${testId}-empty`} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid={testId}>
          {shelves.map((shelf, index) => (
            <Shelf key={shelf.key} shelf={shelf} name={name(shelf.key)} icon={icon(shelf.key)} href={href(shelf.key)} index={index} />
          ))}
        </ul>
      )}
      {nothing && shelves.length > 0 && (
        <Card tone="quiet" className="mt-4 flex items-center gap-2.5">
          <Icon name="lock" size={18} className="text-phu-sa" />
          <p className="text-sm text-phu-sa">{t("review.index.locked")}</p>
        </Card>
      )}
    </Screen>
  );
}

function Shelf<K extends string>({ shelf, name, icon, href, index }: {
  shelf: IndexShelf<K>;
  name: string;
  icon: IconName;
  href: string;
  index: number;
}) {
  const seen = shelf.entries.length;
  const total = seen + shelf.toCome;
  // Rien de vu dans ce rayon : on en montre la taille, pas la porte — il n'y aurait rien derrière.
  const open = seen > 0;

  const body = (
    <>
      <span className={`grid size-11 shrink-0 place-items-center rounded-full ${open ? "bg-ngoc-sang text-ngoc" : "bg-surface-2 text-phu-sa"}`}>
        <Icon name={open ? icon : "lock"} size={22} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{name}</span>
        <ProgressBar value={seen} max={Math.max(1, total)} size="sm" tone="ngoc" label={t("review.index.progress", { seen, total })} />
        <span className="text-sm text-phu-sa tabular-nums">{t("review.index.progress", { seen, total })}</span>
      </span>
      {open ? (
        <Icon name="chevronRight" size={20} className="text-phu-sa" />
      ) : (
        <Chip tone="neutral">{plural("review.index.toCome", "review.index.toCome.plural", shelf.toCome)}</Chip>
      )}
    </>
  );

  return (
    <Card as="li" tone={open ? "plain" : "quiet"} {...enter(index)} data-testid="index-shelf" data-key={shelf.key} data-open={open}>
      {open ? (
        <Link to={href} className="-mx-5 -my-4 flex min-h-16 items-center gap-3 rounded-card px-5 py-4">
          {body}
        </Link>
      ) : (
        <div className="-mx-5 -my-4 flex min-h-16 items-center gap-3 px-5 py-4">{body}</div>
      )}
    </Card>
  );
}
