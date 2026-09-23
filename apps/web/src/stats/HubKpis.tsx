import { Link } from "react-router";
import { Card, Icon, Stat } from "../design/index.ts";
import { getLocale, plural, t } from "../i18n/index.ts";
import { DayBars, type ChartPoint } from "./charts.tsx";
import type { HubKpisView } from "./hub-kpis.ts";

/**
 * Les chiffres, sur le parcours (contrat phase26 §7) : quatre compteurs et la semaine en barres,
 * pour savoir où l'on en est sans changer d'onglet. Le détail reste aux statistiques, à un geste.
 *
 * Discret par construction : l'anneau de l'objectif du jour est l'objet fort du haut de l'écran
 * (contrat phase8 §1), cette carte n'a ni ombre ni ton. Avant toute activité elle n'existe pas —
 * quatre zéros sur l'écran d'un débutant ne disent rien, sinon qu'il n'a encore rien fait.
 */
export function HubKpis({ view, streak }: { view: HubKpisView; streak: number }) {
  if (!view.active) return null;
  const locale = getLocale();
  const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric" });
  const minutes = (seconds: number) => (seconds === 0 ? "0" : seconds < 60 ? t("stats.kpi.minutes.under") : String(Math.round(seconds / 60)));
  const points: ChartPoint[] = view.days.map((point) => ({
    day: point.day,
    value: point.seconds,
    label:
      point.seconds === 0
        ? t("stats.chart.minutes.dayNone", { date: dayLabel(point.day) })
        : point.seconds < 60
          ? t("stats.chart.minutes.daySeconds", { date: dayLabel(point.day), n: Math.round(point.seconds) })
          : t("stats.chart.minutes.day", { date: dayLabel(point.day), n: Math.round(point.seconds / 60) }),
  }));
  const weekTotal = view.days.reduce((sum, point) => sum + point.seconds, 0);

  return (
    <Card as="section" className="mb-5 flex flex-col gap-4" data-testid="hub-kpis" aria-labelledby="hub-kpis-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="hub-kpis-title" className="font-medium">{t("stats.hub.title")}</h2>
        <Link to="/statistiques" className="flex min-h-11 items-center gap-1 text-sm font-semibold text-ngoc" data-testid="hub-kpis-more">
          {t("stats.hub.more")}
          <Icon name="chevronRight" size={16} />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat data-kpi="streak" icon="flame" tone="son-mai" value={plural("stats.kpi.streak.day", "stats.kpi.streak.days", streak)} label={t("stats.hub.streak")} />
        <Stat data-kpi="minutes" icon="clock" value={minutes(view.weekSeconds)} label={t("stats.hub.minutes")} />
        <Stat data-kpi="lessons" icon="book" value={String(view.weekLessons)} label={t("stats.hub.lessons")} />
        <Stat
          data-kpi="accuracy"
          icon="target"
          tone="ngoc"
          value={view.accuracy === null ? t("stats.kpi.none") : `${Math.round(view.accuracy * 100)} %`}
          label={t("stats.hub.accuracy")}
        />
      </div>
      <DayBars
        title={t("stats.hub.chart")}
        unitLabel={t("stats.chart.minutes.unit")}
        tone="nghe"
        height={56}
        points={points}
        summary={t("stats.hub.chart.summary", { n: minutes(weekTotal) })}
      />
    </Card>
  );
}
