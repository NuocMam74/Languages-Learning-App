import type { ContentIndex, Guide } from "@parlo/core";
import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { Screen, Vi } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon, SectionTitle, type ChipTone, type IconName } from "../design/index.ts";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { matchesSearch } from "./library.ts";
import { enter, GroupTitle, LibraryHeader, SEARCH_CLASS } from "./ui.tsx";

/**
 * Conseils pratiques (contrat phase15 §2) : le rayon qu'on ouvre en dehors des séances, quand on a
 * une question et pas une leçon à faire — comment construire une phrase, quoi dire au marché, à qui
 * on dit anh plutôt que chị.
 *
 * Deux écrans seulement : la liste (cherchable, groupée par nature) et la fiche. Pas de progression,
 * pas de verrou, pas d'exercice : une fiche se consulte, et c'est tout. C'est la seule partie de
 * l'app qui ne demande rien en échange, et c'est volontaire — on y vient pressé.
 *
 * Le contenu vient du pack (`content/<pack>/guides/`), livré dans core.json : les fiches sont donc
 * lisibles hors ligne dès l'installation, sans attendre le téléchargement d'une unité.
 */

type Kind = Guide["kind"];

const KIND_LABEL: Record<Kind, MessageKey> = {
  grammar: "review.tips.kind.grammar",
  situation: "review.tips.kind.situation",
  usage: "review.tips.kind.usage",
};

const KIND_ICON: Record<Kind, IconName> = { grammar: "grammar", situation: "dialogue", usage: "lantern" };
const KIND_CHIP: Record<Kind, ChipTone> = { grammar: "neutral", situation: "ngoc", usage: "outline" };

/** Ordre des rayons : d'abord construire une phrase, puis s'en servir quelque part. */
const KIND_ORDER: readonly Kind[] = ["grammar", "situation", "usage"];

export function Tips({ content }: { content: ContentIndex }) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => [...content.guides.values()], [content]);

  const groups = useMemo(() => {
    const byKind = new Map<Kind, Guide[]>();
    for (const guide of all) {
      // La recherche porte aussi sur le corps et les exemples : on cherche « combien » ou « taxi »,
      // pas le titre exact d'une fiche.
      const haystack = [
        l(guide.title),
        l(guide.summary),
        ...guide.sections.flatMap((s) => [l(s.heading), l(s.body), ...(s.examples ?? []).flatMap((e) => [e.vi, e.fr])]),
      ];
      if (!matchesSearch(query, haystack)) continue;
      const list = byKind.get(guide.kind);
      if (list) list.push(guide);
      else byKind.set(guide.kind, [guide]);
    }
    // Le contenu porte son ordre de lecture : dans « construire ses phrases », l'ordre des mots
    // vient avant les classificateurs. Sans `order`, on retomberait sur l'alphabet des fichiers.
    const LAST = Number.MAX_SAFE_INTEGER;
    for (const list of byKind.values()) {
      list.sort((a, b) => (a.order ?? LAST) - (b.order ?? LAST) || l(a.title).localeCompare(l(b.title)));
    }
    return KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => [kind, byKind.get(kind)!] as const);
  }, [all, query]);

  return (
    <Screen top={<LibraryHeader title={t("review.section.tips")} subtitle={t("review.tips.intro")} />}>
      {all.length === 0 ? (
        <EmptyState data-testid="tips-empty" art="page" title={t("review.tips.none.title")} body={t("review.tips.none.body")} />
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm text-phu-sa">
            {t("review.tips.search")}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="tips-search"
              className={SEARCH_CLASS}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>

          {groups.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                data-testid="tips-no-match"
                art="page"
                title={t("review.tips.noMatch.title")}
                body={t("review.tips.noMatch.body")}
                action={
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center rounded-card border-2 border-ngoc px-5 font-semibold text-ngoc"
                    onClick={() => setQuery("")}
                  >
                    {t("review.vocab.clear")}
                  </button>
                }
              />
            </div>
          ) : (
            groups.map(([kind, guides]) => (
              <section key={kind}>
                <GroupTitle icon={KIND_ICON[kind]}>{t(KIND_LABEL[kind])}</GroupTitle>
                <ul className="flex flex-col gap-2.5" data-testid="tips-group" data-kind={kind}>
                  {guides.map((guide, index) => (
                    <Card key={guide.id} as="li" tone="plain" {...enter(index)} data-testid="tip" data-guide={guide.id}>
                      <Link to={`/reviser/conseils/${guide.id}`} className="-mx-5 -my-4 flex min-h-16 items-center gap-3 rounded-card px-5 py-4">
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="font-medium">{l(guide.title)}</span>
                          <span className="text-sm text-phu-sa">{l(guide.summary)}</span>
                        </span>
                        <Icon name="chevronRight" size={20} className="shrink-0 text-phu-sa" />
                      </Link>
                    </Card>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

/** Une fiche, en entier. */
export function TipPage({ content }: { content: ContentIndex }) {
  const { guideId = "" } = useParams();
  const guide = content.guides.get(guideId);
  // Fiche inconnue (lien périmé, pack changé) : on revient à la liste plutôt que d'afficher un vide.
  if (!guide) return <Navigate to="/reviser/conseils" replace />;

  return (
    <Screen
      top={<LibraryHeader title={l(guide.title)} to="/reviser/conseils" label={t("review.section.tips")} subtitle={l(guide.summary)} />}
    >
      <Chip tone={KIND_CHIP[guide.kind]} icon={KIND_ICON[guide.kind]} className="self-start">
        {t(KIND_LABEL[guide.kind])}
      </Chip>

      <div className="flex flex-col gap-6 pt-4" data-testid="tip-body">
        {guide.sections.map((section, index) => (
          <section key={index} data-testid="tip-section">
            <SectionTitle className="mb-2">{l(section.heading)}</SectionTitle>
            {/* Pas de `text-balance` ici : il est fait pour les titres, et sur un paragraphe il
                choisit des coupures inattendues — la ligne peut commencer par le deux-points. */}
            <p>{l(section.body)}</p>
            {section.examples && section.examples.length > 0 && (
              <Card tone="quiet" className="mt-3">
                <ul className="flex flex-col divide-y divide-line">
                  {section.examples.map((example, i) => (
                    <li key={i} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0" data-testid="tip-example">
                      <Vi size="lg">{example.vi}</Vi>
                      <span className="text-sm text-phu-sa">{example.fr}</span>
                      {example.note && <span className="pt-1 text-sm text-phu-sa italic">{l(example.note)}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        ))}

        {guide.pitfalls && guide.pitfalls.length > 0 && (
          <section data-testid="tip-pitfalls">
            <SectionTitle icon="alert" className="mb-2">
              {t("review.tips.pitfalls")}
            </SectionTitle>
            <Card tone="notice">
              <ul className="flex flex-col gap-2">
                {guide.pitfalls.map((pitfall, i) => (
                  <li key={i} className="flex gap-2">
                    <Icon name="alert" size={16} className="mt-1 shrink-0 text-nghe" />
                    <span>{l(pitfall)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>
    </Screen>
  );
}
