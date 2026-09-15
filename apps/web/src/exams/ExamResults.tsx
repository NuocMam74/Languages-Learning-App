import { EXAM_SKILLS, type ContentIndex, type ExamFile, type ExamScores, type LessonId } from "@parlo/core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { l, t, type MessageKey } from "../i18n/index.ts";

interface Props {
  content: ContentIndex;
  exam: ExamFile;
  mock: boolean;
  passed: boolean;
  global: number;
  scores: Partial<ExamScores>;
  lessons: readonly LessonId[];
  action: ReactNode;
  children?: ReactNode;
}

const pct = (v: number) => Math.round(v * 100);

/** Résultats par compétence + lacunes (leçons à revoir). */
export function ExamResults({ content, exam, mock, passed, global, scores, lessons, action, children }: Props) {
  const verdict = passed ? t(mock ? "exams.result.mockPassed" : "exams.result.passed") : t("exams.result.failed");
  return (
    <Screen action={action}>
      <div className="flex flex-1 flex-col gap-7 pt-6" data-testid="exam-results" data-passed={passed}>
        <div>
          <p className="text-phu-sa">{mock ? t("exams.mock") : t("exams.real")} · {l(exam.certificate)}</p>
          <h1 className="font-serif text-2xl">{verdict}</h1>
        </div>
        <p className={`font-serif text-vi-xl motion-safe:animate-[rise_600ms_ease-out] ${passed ? "text-ngoc" : "text-muc"}`}>
          {t("exams.result.global", { n: pct(global) })}
        </p>

        <ul className="flex flex-col gap-4" aria-label={t("cert.verify.scores")}>
          {EXAM_SKILLS.map((skill) => {
            const value = scores[skill];
            const label = t(`exams.skill.${skill}` as MessageKey);
            return (
              <li key={skill} className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <span>{label}</span>
                  <span className="font-semibold tabular-nums">{value === null || value === undefined ? t("exams.result.notGraded") : `${pct(value)} %`}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-phu-sa/10" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? 0 : pct(value)}>
                  <div className={`h-full rounded-full ${value != null && value < 0.5 ? "bg-son-mai" : "bg-ngoc"}`} style={{ width: `${value == null ? 0 : pct(value)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-phu-sa">{t("exams.result.threshold", { n: pct(exam.passThreshold) })}</p>

        {children}

        <section>
          <h2 className="mb-2 font-semibold">{t("exams.result.gaps")}</h2>
          {lessons.length === 0 ? (
            <p className="text-phu-sa">{t("exams.result.noGaps")}</p>
          ) : (
            <ul className="flex flex-col border-y border-phu-sa/10">
              {lessons.map((id) => {
                const lesson = content.lessons.get(id);
                return lesson ? (
                  <li key={id} className="border-t border-phu-sa/10 first:border-t-0">
                    <Link to={`/lecon/${id}`} className="flex min-h-12 flex-col justify-center py-2">
                      <span className="font-medium text-ngoc">{l(lesson.title)}</span>
                      <span className="text-sm text-phu-sa">{l(lesson.goal)}</span>
                    </Link>
                  </li>
                ) : null;
              })}
            </ul>
          )}
        </section>
      </div>
    </Screen>
  );
}
