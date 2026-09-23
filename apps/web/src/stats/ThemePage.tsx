import { MARK_MAX, type ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { Card, EmptyState, Icon, PageHeader, ProgressRing, SectionTitle, Skeleton, Stat, staggerStyle, type IconName } from "../design/index.ts";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { DayBars, type ChartPoint } from "./charts.tsx";
import { themeView, type ThemeView } from "./data.ts";

/**
 * Fiche d'un thème (contrat phase26 §7), route `/statistiques/theme/:unitId`, ouverte depuis la
 * note de chaque thème dans l'onglet Parcours.
 *
 * La ligne du thème disait « 13,5/20, fragile ». Restait la question qui suit toujours : **lequel
 * de ses niveaux, et quels mots ?** L'écran y répond dans cet ordre — la note et ce qu'elle couvre,
 * la note de chaque niveau, puis les mots qui ne tiennent pas en mémoire.
 *
 * Un seul objet fort (contrat phase8 §1) : l'anneau de la note. Le reste est posé dessous, discret.
 */
export default function ThemePage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const { unitId = "" } = useParams();
  // `undefined` : lecture en cours ; `null` : ce thème n'existe pas dans ce pack.
  const [view, setView] = useState<ThemeView | null | undefined>(undefined);
  const unit = content.curriculum.units.find((u) => u.id === unitId);

  useEffect(() => {
    let live = true;
    setView(undefined);
    void themeView(content, unitId).then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [content, unitId]);

  const header = (
    <PageHeader
      back="/statistiques/journey"
      backLabel={t("stats.theme.back")}
      title={unit ? l(unit.title) : t("stats.title")}
      subtitle={t("stats.theme.subtitle")}
    />
  );

  if (view === null || !unit) {
    return (
      <Screen top={header}>
        <p className="text-phu-sa" data-testid="theme-missing">{t("stats.theme.missing")}</p>
      </Screen>
    );
  }

  const detail = view?.detail;
  // Pas commencé : ni niveau noté, ni mot en révision. Une invitation, pas une grille de zéros
  // (contrat phase23 §1, phase8 §1).
  const started = detail === undefined || detail.mark.done > 0 || detail.acquired > 0;

  return (
    <Screen top={header}>
      {!started ? (
        <div className="flex flex-1 flex-col justify-center" data-testid="theme-empty">
          <EmptyState
            art="boat"
            title={t("stats.theme.empty.title")}
            body={t("stats.theme.empty.body")}
            action={<Button onClick={() => navigate("/apprendre")}>{t("stats.theme.empty.cta")}</Button>}
          />
        </div>
      ) : (
        <ThemeBody view={view ?? null} />
      )}
    </Screen>
  );
}

function ThemeBody({ view }: { view: ThemeView | null }) {
  const detail = view?.detail;
  const mark = detail?.mark;
  const percent = (ratio: number | null) => (ratio === null ? t("stats.kpi.none") : `${Math.round(ratio * 100)} %`);

  const kpis: { key: string; icon: IconName; label: string; value: string | null; tone?: "ngoc" }[] = [
    { key: "levels", icon: "book", label: t("stats.theme.kpi.levels"), value: mark ? `${mark.done}/${mark.total}` : null },
    { key: "words", icon: "cards", label: t("stats.theme.kpi.words"), value: detail ? `${detail.acquired}/${detail.concepts}` : null },
    { key: "retention", icon: "target", tone: "ngoc", label: t("stats.theme.kpi.retention"), value: detail ? percent(detail.retention) : null },
  ];

  // Un niveau pas encore fait garde sa colonne, sans barre : ce n'est pas un 0/20.
  const levels: ChartPoint[] = (detail?.levels ?? []).map((level) => ({
    day: level.lessonId,
    value: level.mark ?? 0,
    placeholder: level.mark === null,
    label:
      level.mark === null
        ? t("stats.theme.marks.levelNone", { title: l(level.title) })
        : t("stats.theme.marks.level", { title: l(level.title), mark: level.mark }),
  }));
  const done = mark?.done ?? 0;

  return (
    <>
      {/* L'anneau de la note : l'objet fort de l'écran. Son niveau est écrit, jamais porté par la
          seule couleur. */}
      <Card tone="feature" as="section" className="mb-4 flex items-center gap-5" data-testid="theme-mark">
        <ProgressRing value={mark?.mark ?? 0} max={MARK_MAX} size={96} label={t("stats.theme.kpi.mark")}>
          <span className="flex flex-col leading-none">
            <span className="font-serif text-2xl tabular-nums">{mark?.mark ?? "—"}</span>
            <span className="text-sm text-phu-sa tabular-nums">/{MARK_MAX}</span>
          </span>
        </ProgressRing>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-medium">{t("stats.theme.kpi.mark")}</p>
          <p className="min-h-[1.3125rem] text-sm text-phu-sa">
            {mark?.level ? t(`profile.marks.level.${mark.level}` as MessageKey) : ""}
          </p>
        </div>
      </Card>

      <Card tone="raised" className="mb-4 grid grid-cols-3 gap-x-4" data-testid="theme-kpis">
        {kpis.map((kpi) => (
          <Stat
            key={kpi.key}
            data-kpi={kpi.key}
            icon={kpi.icon}
            {...(kpi.tone ? { tone: kpi.tone } : {})}
            value={kpi.value ?? <Skeleton className="inline-block h-4 w-10 align-middle" />}
            label={kpi.label}
          />
        ))}
      </Card>

      <Card as="section" className="mb-4 flex flex-col gap-2">
        <DayBars
          title={t("stats.theme.marks")}
          unitLabel={t("stats.theme.marks.unit")}
          points={levels}
          max={MARK_MAX}
          height={112}
          hint={t("stats.theme.marks.hint")}
          summary={t(done > 1 ? "stats.theme.marks.summary" : "stats.theme.marks.summary.one", { n: done, total: mark?.total ?? 0 })}
        />
      </Card>

      <Card as="section" className="flex flex-col gap-3" data-testid="theme-resisting">
        <SectionTitle tone="strong" icon="refresh">{t("stats.theme.resisting")}</SectionTitle>
        {view === null ? (
          <Skeleton className="h-12 w-full" rounded="card" />
        ) : view.resisting.length === 0 ? (
          <p className="text-phu-sa">{t("stats.theme.resisting.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {view.resisting.map((word, i) => (
              <li
                key={word.conceptId}
                data-testid="theme-resisting-word"
                data-concept={word.conceptId}
                style={staggerStyle(i)}
                className="flex items-baseline justify-between gap-3 py-2.5 motion-safe:parlo-enter"
              >
                <span className="min-w-0">
                  <span lang="vi" className="font-serif text-lg">{word.vi}</span>
                  <span className="text-phu-sa"> — {l(word.gloss)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm text-son-mai tabular-nums">
                  <Icon name="refresh" size={14} />
                  {word.lapses > 1 ? t("stats.theme.resisting.lapses", { n: word.lapses }) : t("stats.theme.resisting.lapsesOne")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-phu-sa">{t("stats.theme.resisting.hint")}</p>
        <p className="text-sm text-phu-sa">{t("stats.theme.retention.hint")}</p>
      </Card>
    </>
  );
}
