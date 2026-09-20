import type { ContentIndex, LessonId } from "@parlo/core";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Icon, ProgressBar } from "../design/index.ts";
import { FavoriteButton } from "../components/FavoriteButton.tsx";
import { l, t } from "../i18n/index.ts";
import type { LibraryData } from "./data.ts";
import { enter, GroupTitle, LibraryHeader } from "./ui.tsx";

/**
 * Les leçons par unité avec leur état (contrat phase8 §2). Une leçon terminée se **rejoue en
 * entraînement** : `/lecon/:id/entrainement` — mêmes exercices, le SRS reçoit les réponses, mais
 * ni XP ni progression recomptées (voir `SessionMode` dans @parlo/core).
 *
 * La hiérarchie dit où aller : la leçon ouverte est `feature`, la leçon faite garde sa barre de
 * score, la leçon à venir s'efface en `quiet`. Aucune pile de cartes indifférenciées (contrat §1).
 */
export function LessonsList({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const nothing = data.completed.size === 0;

  return (
    <Screen top={<LibraryHeader title={t("review.section.lessons")} />}>
      {nothing ? (
        <EmptyState
          data-testid="lessons-empty"
          art="boat"
          title={t("review.lessons.empty.title")}
          body={t("review.lessons.empty.body")}
          action={
            <Link to="/apprendre" className="inline-flex min-h-12 items-center rounded-card bg-ngoc px-5 font-semibold text-nuoc">
              {t("review.lessons.goPath")}
            </Link>
          }
        />
      ) : (
        content.curriculum.units.map((unit, unitIndex) => (
          <section key={unit.id}>
            <GroupTitle icon="book">{l(unit.title)}</GroupTitle>
            <ul className="flex flex-col gap-2">
              {unit.lessons.map((lessonId, index) => (
                <LessonRow key={lessonId} content={content} data={data} lessonId={lessonId} {...(unitIndex === 0 ? enter(index) : {})} />
              ))}
            </ul>
          </section>
        ))
      )}
    </Screen>
  );
}

function LessonRow({ content, data, lessonId, stagger }: { content: ContentIndex; data: LibraryData; lessonId: LessonId; stagger?: number }) {
  const lesson = content.lessons.get(lessonId);
  if (!lesson) return null;
  const done = data.completed.has(lessonId);
  const open = data.open.has(lessonId);
  const row = data.progress.get(lessonId);
  const state = done ? "done" : open ? "open" : "locked";

  return (
    <Card
      as="li"
      tone={open && !done ? "feature" : done ? "plain" : "quiet"}
      className="flex flex-col gap-2"
      data-testid="library-lesson"
      data-lesson={lessonId}
      data-state={state}
      {...(stagger === undefined ? {} : { stagger })}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon name={done ? "check" : open ? "play" : "lock"} size={20} className={`mt-1 ${done || open ? "text-ngoc" : "text-phu-sa/50"}`} />
          <div className="min-w-0">
            <p className="font-medium">{l(lesson.title)}</p>
            {done && row && <p className="text-sm text-phu-sa">{t("review.lessons.score", { n: Math.round(row.bestScore * 100) })}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Chip tone={done ? "ngoc" : open ? "solid" : "neutral"}>
            {t(done ? "review.lessons.state.done" : open ? "review.lessons.state.open" : "review.lessons.state.locked")}
          </Chip>
          {/* Aimer une leçon depuis la bibliothèque (contrat phase18 §2) : seulement celles qu'on a
              faites — on n'aime pas ce qu'on n'a pas encore vu. */}
          {done && <FavoriteButton target={{ lessonId }} size={18} className="-mr-2 size-9" />}
        </div>
      </div>
      {done && row && <ProgressBar value={row.bestScore} size="sm" label={t("review.lessons.score", { n: Math.round(row.bestScore * 100) })} />}
      {done && (
        <Link to={`/lecon/${encodeURIComponent(lessonId)}/entrainement`} className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-ngoc" data-testid="lesson-replay">
          <Icon name="refresh" size={18} />
          {t("review.lessons.replay")}
        </Link>
      )}
      {!done && open && (
        <Link to={`/lecon/${encodeURIComponent(lessonId)}`} className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-ngoc" data-testid="lesson-start">
          <Icon name="play" size={18} />
          {t("review.lessons.start")}
        </Link>
      )}
    </Card>
  );
}
