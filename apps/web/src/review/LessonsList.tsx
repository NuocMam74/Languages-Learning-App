import type { ContentIndex, LessonId } from "@parlo/core";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { l, t } from "../i18n/index.ts";
import type { LibraryData } from "./data.ts";
import { Chip, EmptyState, GroupTitle, LibraryHeader } from "./ui.tsx";

/**
 * Les leçons par unité avec leur état (contrat phase8 §2). Une leçon terminée se **rejoue en
 * entraînement** : `/lecon/:id/entrainement` — mêmes exercices, le SRS reçoit les réponses, mais
 * ni XP ni progression recomptées (voir `SessionMode` dans @parlo/core).
 */
export function LessonsList({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const nothing = data.completed.size === 0;

  return (
    <Screen top={<LibraryHeader title={t("review.section.lessons")} />}>
      {nothing ? (
        <EmptyState
          testId="lessons-empty"
          title={t("review.lessons.empty.title")}
          body={t("review.lessons.empty.body")}
          action={<Link to="/apprendre" className="min-h-11 py-2 font-semibold text-ngoc">{t("review.lessons.goPath")}</Link>}
        />
      ) : (
        content.curriculum.units.map((unit) => (
          <section key={unit.id}>
            <GroupTitle>{l(unit.title)}</GroupTitle>
            <ul className="flex flex-col gap-2">
              {unit.lessons.map((lessonId) => (
                <LessonRow key={lessonId} content={content} data={data} lessonId={lessonId} />
              ))}
            </ul>
          </section>
        ))
      )}
    </Screen>
  );
}

function LessonRow({ content, data, lessonId }: { content: ContentIndex; data: LibraryData; lessonId: LessonId }) {
  const lesson = content.lessons.get(lessonId);
  if (!lesson) return null;
  const done = data.completed.has(lessonId);
  const open = data.open.has(lessonId);
  const row = data.progress.get(lessonId);
  const state = done ? "done" : open ? "open" : "locked";

  return (
    <li
      className="flex flex-col gap-2 rounded-2xl border border-phu-sa/10 bg-white/70 px-4 py-3"
      data-testid="library-lesson"
      data-lesson={lessonId}
      data-state={state}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{l(lesson.title)}</p>
          {done && row && <p className="text-sm text-phu-sa">{t("review.lessons.score", { n: Math.round(row.bestScore * 100) })}</p>}
        </div>
        <Chip tone={done ? "mastered" : open ? "due" : "neutral"}>
          {t(done ? "review.lessons.state.done" : open ? "review.lessons.state.open" : "review.lessons.state.locked")}
        </Chip>
      </div>
      {done && (
        <Link to={`/lecon/${encodeURIComponent(lessonId)}/entrainement`} className="min-h-11 self-start py-2 font-semibold text-ngoc" data-testid="lesson-replay">
          {t("review.lessons.replay")}
        </Link>
      )}
      {!done && open && (
        <Link to={`/lecon/${encodeURIComponent(lessonId)}`} className="min-h-11 self-start py-2 font-semibold text-ngoc" data-testid="lesson-start">
          {t("review.lessons.start")}
        </Link>
      )}
    </li>
  );
}
