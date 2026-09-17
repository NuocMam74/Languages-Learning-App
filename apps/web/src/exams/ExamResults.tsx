import { EXAM_SKILLS, type ContentIndex, type ExamFile, type ExamScores, type LessonId } from "@parlo/core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, CountUp, EmptyState, Icon, ProgressBar, ProgressRing, SectionTitle } from "../design/index.ts";
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
  const threshold = t("exams.result.threshold", { n: pct(exam.passThreshold) });

  // Le chiffre monte, l'unité reste posée : on découpe le message traduit (« {n} % », « {n}% »)
  // autour de son nombre pour animer le score sans casser la chaîne affichée.
  const score = pct(global);
  const formatted = t("exams.result.global", { n: score });
  const cut = formatted.indexOf(String(score));
  const head = cut < 0 ? "" : formatted.slice(0, cut);
  const tail = cut < 0 ? "" : formatted.slice(cut + String(score).length);

  return (
    <Screen action={action}>
      <div className="flex flex-1 flex-col gap-6 pt-2" data-testid="exam-results" data-passed={passed}>
        {/* Le score est l'objet de l'écran : un seul anneau, une seule montée de chiffre. */}
        <Card tone={passed ? "feature" : "raised"} className="flex flex-col items-center gap-3 text-center">
          <p className="text-phu-sa">{mock ? t("exams.mock") : t("exams.real")} · {l(exam.certificate)}</p>
          <h1 className="font-serif text-2xl">{verdict}</h1>
          <ProgressRing value={global} size={168} label={t("exams.result.globalLabel")} tone={passed ? "ngoc" : "nghe"}>
            <span className={`font-serif text-vi leading-none ${passed ? "text-ngoc" : "text-muc"}`}>
              {head}
              <CountUp to={score} />
              {tail}
            </span>
          </ProgressRing>
        </Card>

        <section className="flex flex-col gap-3">
          <SectionTitle id="exam-scores" tone="strong" icon="chart">{t("cert.verify.scores")}</SectionTitle>
          <Card>
            <ul className="flex flex-col gap-4" aria-labelledby="exam-scores">
              {EXAM_SKILLS.map((skill) => {
                const value = scores[skill];
                const label = t(`exams.skill.${skill}` as MessageKey);
                const graded = value !== null && value !== undefined;
                return (
                  <li key={skill} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>{label}</span>
                      <span className={`font-semibold tabular-nums ${graded ? "" : "text-phu-sa"}`}>
                        {graded ? `${pct(value)} %` : t("exams.result.notGraded")}
                      </span>
                    </div>
                    <ProgressBar
                      value={graded ? pct(value) : 0}
                      max={100}
                      size="sm"
                      label={label}
                      tone={graded && value < 0.5 ? "son-mai" : "ngoc"}
                    />
                  </li>
                );
              })}
            </ul>
          </Card>
          {/* Barre franchie : le seuil se lit comme une récompense, pas comme une note de bas de page. */}
          {passed ? (
            <Card tone="notice" className="flex items-start gap-3">
              <Icon name="trophy" className="mt-0.5 shrink-0 text-muc" />
              <p className="min-w-0 flex-1 text-sm">{threshold}</p>
            </Card>
          ) : (
            <p className="text-sm text-phu-sa">{threshold}</p>
          )}
        </section>

        {children}

        <section className="flex flex-col gap-3">
          <SectionTitle tone="strong" icon="book">{t("exams.result.gaps")}</SectionTitle>
          {lessons.length === 0 ? (
            <EmptyState art="boat" compact title={t("exams.result.noGaps")} />
          ) : (
            <ul className="flex flex-col gap-2">
              {lessons.map((id, i) => {
                const lesson = content.lessons.get(id);
                return lesson ? (
                  <Card key={id} as="li" tone="quiet" stagger={i}>
                    <Link to={`/lecon/${id}`} className="flex min-h-11 items-center gap-3">
                      <Icon name="book" size={20} className="shrink-0 text-ngoc" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium text-ngoc">{l(lesson.title)}</span>
                        <span className="text-sm text-phu-sa">{l(lesson.goal)}</span>
                      </span>
                      <Icon name="chevronRight" size={18} className="shrink-0 text-phu-sa/50" />
                    </Link>
                  </Card>
                ) : null;
              })}
            </ul>
          )}
        </section>
      </div>
    </Screen>
  );
}
