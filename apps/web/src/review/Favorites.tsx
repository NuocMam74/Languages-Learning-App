import type { ContentIndex } from "@parlo/core";
import { useMemo } from "react";
import { Link } from "react-router";
import { FavoriteButton } from "../components/FavoriteButton.tsx";
import { Screen, Vi } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon, SectionTitle } from "../design/index.ts";
import { FORMAT_TITLE } from "../exercises/format-names.ts";
import { likedSteps, useFavorites, viewFavorites, type FavoriteView } from "../favorites.ts";
import { l, plural, t } from "../i18n/index.ts";
import { enter, LibraryHeader } from "./ui.tsx";

/**
 * Mes favoris (contrat phase18 §3) : ce qu'on a aimé, et un chemin court pour y revenir.
 *
 * C'est le seul rayon de la bibliothèque dont **l'apprenant** décide du contenu : rien n'y arrive
 * tout seul, et rien n'en part sans un geste. Les leçons d'un côté, les exercices de l'autre —
 * parce qu'on ne les rejoue pas de la même façon.
 *
 * Les exercices sont groupés **par leçon**, dans l'ordre du cursus, et se rejouent ensemble : une
 * séance d'entraînement restreinte à ces étapes-là. C'est ce qui fait la différence entre « je
 * retrouve mon exercice » et « je refais toute la leçon pour tomber dessus ».
 */

export function Favorites({ content }: { content: ContentIndex }) {
  const rows = useFavorites((s) => s.rows);
  const views = useMemo(() => viewFavorites(content, rows), [content, rows]);

  const lessons = views.filter((v) => v.row.kind === "lesson");
  const steps = views.filter((v) => v.row.kind === "step");

  // Exercices groupés par leçon, dans l'ordre du cursus — celui dans lequel on les rejouera.
  const order = useMemo(() => {
    const rank = new Map<string, number>();
    let i = 0;
    for (const unit of content.curriculum.units) for (const id of unit.lessons) rank.set(id, i++);
    return rank;
  }, [content]);

  const byLesson = useMemo(() => {
    const groups = new Map<string, FavoriteView[]>();
    for (const view of steps) {
      const found = groups.get(view.row.lessonId);
      if (found) found.push(view);
      else groups.set(view.row.lessonId, [view]);
    }
    for (const list of groups.values()) list.sort((a, b) => (a.row.stepIndex ?? 0) - (b.row.stepIndex ?? 0));
    return [...groups.entries()].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
  }, [steps, order]);

  if (views.length === 0) {
    return (
      <Screen top={<LibraryHeader title={t("favorites.title")} subtitle={t("favorites.intro")} />}>
        <EmptyState
          data-testid="favorites-empty"
          art="notebook"
          title={t("favorites.empty.title")}
          body={t("favorites.empty.body")}
          action={
            <Link to="/apprendre" className="inline-flex min-h-12 items-center rounded-card bg-ngoc px-5 font-semibold text-nuoc">
              {t("favorites.empty.cta")}
            </Link>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen top={<LibraryHeader title={t("favorites.title")} subtitle={t("favorites.intro")} />}>
      {lessons.length > 0 && (
        <section data-testid="favorites-lessons">
          <SectionTitle icon="book" className="mb-3">{t("favorites.section.lessons")}</SectionTitle>
          <ul className="flex flex-col gap-2.5">
            {lessons.map((view, index) => (
              <Card key={view.row.id} as="li" className="flex items-center gap-3" data-testid="favorite-lesson" {...enter(index)}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{view.lessonTitle ? l(view.lessonTitle) : view.row.lessonId}</p>
                  {view.unitTitle && <p className="text-sm text-phu-sa">{l(view.unitTitle)}</p>}
                  <Link
                    to={`/lecon/${view.row.lessonId}/entrainement`}
                    className="mt-1 inline-flex min-h-11 items-center gap-1.5 font-medium text-ngoc"
                  >
                    <Icon name="refresh" size={16} />
                    {t("favorites.replay")}
                  </Link>
                </div>
                <FavoriteButton target={{ lessonId: view.row.lessonId }} />
              </Card>
            ))}
          </ul>
        </section>
      )}

      {byLesson.length > 0 && (
        <section className={lessons.length > 0 ? "mt-7" : ""} data-testid="favorites-steps">
          <SectionTitle icon="cards" className="mb-3">{t("favorites.section.steps")}</SectionTitle>
          <ul className="flex flex-col gap-2.5">
            {byLesson.map(([lessonId, group], index) => {
              const wanted = likedSteps(rows, lessonId);
              const lessonTitle = group[0]?.lessonTitle;
              return (
                <Card key={lessonId} as="li" className="flex flex-col gap-2" data-testid="favorite-group" data-lesson={lessonId} {...enter(index)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 font-medium">{lessonTitle ? l(lessonTitle) : lessonId}</p>
                    <Chip tone="neutral">{plural("favorites.replaySteps.count", "favorites.replaySteps.count.plural", group.length)}</Chip>
                  </div>

                  <ul className="flex flex-col gap-1.5">
                    {group.map((view) => (
                      <li key={view.row.id} className="flex items-center gap-2" data-testid="favorite-step">
                        <span className="min-w-0 flex-1">
                          {view.preview ? (
                            <Vi size="lg" className="break-words">{view.preview}</Vi>
                          ) : (
                            <span className="text-sm text-phu-sa">{t("favorites.gone")}</span>
                          )}
                          {view.step && <span className="block text-sm text-phu-sa">{t(FORMAT_TITLE[view.step.type])}</span>}
                        </span>
                        <FavoriteButton target={{ lessonId, stepIndex: view.row.stepIndex }} size={18} />
                      </li>
                    ))}
                  </ul>

                  {/* Rejouer **seulement** ces exercices : une séance d'entraînement restreinte à
                      leurs étapes (contrat phase18 §3). Rien n'est recompté, c'est du plaisir. */}
                  <Link
                    to={`/lecon/${lessonId}/entrainement?etapes=${wanted.join(",")}`}
                    data-testid="favorite-replay-steps"
                    className="inline-flex min-h-11 items-center gap-1.5 font-medium text-ngoc"
                  >
                    <Icon name="refresh" size={16} />
                    {t("favorites.replaySteps")}
                  </Link>
                </Card>
              );
            })}
          </ul>
        </section>
      )}
    </Screen>
  );
}
