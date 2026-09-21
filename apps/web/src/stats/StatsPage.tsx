import { MARK_MAX, STATS_WINDOW_DAYS, type ContentIndex, type DayPoint, type ThemeMark } from "@parlo/core";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { Card, EmptyState, Icon, PageHeader, ProgressBar, ProgressRing, SectionTitle, Skeleton, staggerStyle, Stat, type IconName } from "../design/index.ts";
import { getLocale, l, plural, t, type MessageKey } from "../i18n/index.ts";
import { DayBars, RatioLine, RegularityStrip, ShareBars, TrendChip, type ChartPoint, type LinePoint, type ShareRow } from "./charts.tsx";
import { statsView, type StatsView } from "./data.ts";

/**
 * Statistiques (contrat phase23 §1), cinquième destination de la navigation basse.
 *
 * Le profil est une étagère à trophées : il dit **ce qu'on a**. Cet écran dit **ce qui bouge** —
 * la question qu'aucun écran ne traitait, et celle qui décide si on revient demain. D'où le
 * découpage en trois onglets, chacun répondant à une question qu'on se pose vraiment :
 *
 *   Activité     — est-ce que je m'y tiens ?
 *   Compétences  — à quoi passe mon temps, et qu'est-ce qui rend ?
 *   Parcours     — où j'en suis, et sur quoi je bute ?
 *
 * Tout se lit en local (mode invité, hors ligne compris). Les hauteurs qui attendent IndexedDB
 * sont réservées d'avance : les compteurs arrivent après le premier rendu et ne poussent rien.
 */

const TABS = ["activity", "skills", "journey"] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | undefined): value is Tab => TABS.includes(value as Tab);

export default function StatsPage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const params = useParams();
  const tab: Tab = isTab(params.tab) ? params.tab : "activity";
  const [view, setView] = useState<StatsView | null>(null);

  useEffect(() => {
    let live = true;
    void statsView(content).then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [content]);

  const started = view === null || view.lifetimeAnswers > 0 || view.lessonsDone > 0;

  return (
    <Screen top={<PageHeader title={t("stats.title")} subtitle={t("stats.subtitle", { n: STATS_WINDOW_DAYS })} />}>
      {/* Les onglets vivent dans l'URL : revenir sur « Parcours » depuis le profil n'oblige pas à
          rechercher l'onglet, et le bouton retour du navigateur fait ce qu'on attend de lui. */}
      <div role="tablist" aria-label={t("stats.title")} className="mb-5 grid grid-cols-3 gap-1 rounded-card bg-surface-2 p-1">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === tab}
            data-testid="stats-tab"
            data-tab={key}
            onClick={() => navigate(key === "activity" ? "/statistiques" : `/statistiques/${key}`, { replace: true })}
            className={`min-h-11 rounded-chip px-2 text-sm font-semibold transition-[background-color,color] ${
              key === tab ? "bg-surface text-ngoc shadow-card" : "text-phu-sa"
            }`}
          >
            {t(`stats.tab.${key}` as MessageKey)}
          </button>
        ))}
      </div>

      {!started ? (
        <EmptyStateBlock onStart={() => navigate("/seance")} />
      ) : tab === "activity" ? (
        <ActivityTab view={view} />
      ) : tab === "skills" ? (
        <SkillsTab view={view} />
      ) : (
        <JourneyTab view={view} />
      )}

      <p className="mt-6 flex items-start gap-2 text-sm text-phu-sa">
        <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
        {t("stats.local")}
      </p>
    </Screen>
  );
}

/** Premier lancement : une invitation, pas une grille de zéros (contrat phase8 §1). */
function EmptyStateBlock({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center" data-testid="stats-empty">
      <EmptyState
        art="notebook"
        title={t("stats.empty.title")}
        body={t("stats.empty.body")}
        action={<Button onClick={onStart}>{t("stats.empty.cta")}</Button>}
      />
    </div>
  );
}

/* ------------------------------------------------------------- Compteurs */

/**
 * Rangée de compteurs. Hauteur fixe et squelettes de la taille finale : c'est la première chose
 * que l'écran affiche, et elle ne doit jamais grandir sous les yeux (l'audit mobile avait mesuré
 * des sauts exactement là).
 */
interface Kpi {
  key: string;
  icon: IconName;
  label: string;
  /** `null` tant que la lecture d'IndexedDB n'a pas rendu : un squelette de la taille finale. */
  value: string | null;
  tone?: "ngoc" | "nghe" | "son-mai";
}

function Kpis({ items }: { items: readonly Kpi[] }) {
  return (
    <Card tone="raised" className="mb-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4" data-testid="stats-kpis">
      {items.map((item) => (
        <Stat
          key={item.key}
          data-testid="stats-kpi"
          data-kpi={item.key}
          icon={item.icon}
          {...(item.tone ? { tone: item.tone } : {})}
          value={item.value ?? <Skeleton className="inline-block h-4 w-10 align-middle" />}
          label={item.label}
        />
      ))}
    </Card>
  );
}

/* -------------------------------------------------------------- Activité */

function ActivityTab({ view }: { view: StatsView | null }) {
  const locale = getLocale();
  const dayLabel = useMemo(
    () => (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }),
    [locale],
  );
  const series = view?.series ?? [];

  const answers: ChartPoint[] = series.map((point) => ({
    day: point.day,
    value: point.answers,
    label: point.answers > 0
      ? t("stats.chart.answers.day", { date: dayLabel(point.day), n: point.answers })
      : t("stats.chart.answers.dayNone", { date: dayLabel(point.day) }),
  }));
  // La barre porte des **secondes**, l'étiquette parle en minutes. Arrondir la valeur à la minute
  // effaçait purement et simplement les séances de moins de trente secondes : le graphique
  // annonçait « rien à montrer » un jour où l'on avait travaillé.
  const minutes: ChartPoint[] = series.map((point) => ({
    day: point.day,
    value: point.seconds,
    label:
      point.seconds === 0
        ? t("stats.chart.minutes.dayNone", { date: dayLabel(point.day) })
        : point.seconds < 60
          ? t("stats.chart.minutes.daySeconds", { date: dayLabel(point.day), n: Math.round(point.seconds) })
          : t("stats.chart.minutes.day", { date: dayLabel(point.day), n: Math.round(point.seconds / 60) }),
  }));
  const accuracy: LinePoint[] = series.map((point) => ({
    day: point.day,
    value: point.ratio,
    label:
      point.ratio === null
        ? t("stats.chart.answers.dayNone", { date: dayLabel(point.day) })
        : t("stats.chart.accuracy.day", { date: dayLabel(point.day), n: Math.round(point.ratio * 100), correct: point.correct, total: point.answers }),
  }));

  const totals = view?.totals;
  const percent = (ratio: number | null | undefined) => (ratio === null || ratio === undefined ? null : `${Math.round(ratio * 100)} %`);
  /** Minutes lisibles : « 0 » après une vraie séance serait faux, on dit « moins d'une ». */
  const minutesLabel = (seconds: number) => (seconds === 0 ? "0" : seconds < 60 ? t("stats.kpi.minutes.under") : String(Math.round(seconds / 60)));

  return (
    <>
      <Kpis
        items={[
          {
            key: "streak",
            icon: "flame",
            tone: "son-mai",
            label: t("stats.kpi.streak"),
            value: view ? plural("stats.kpi.streak.day", "stats.kpi.streak.days", view.streak.current) : null,
          },
          {
            key: "regularity",
            icon: "calendar",
            label: t("stats.kpi.regularity"),
            value: view ? t("stats.kpi.regularity.value", { n: totals?.activeDays ?? 0, total: series.length }) : null,
          },
          { key: "minutes", icon: "clock", label: t("stats.kpi.minutes"), value: view ? minutesLabel(totals?.seconds ?? 0) : null },
          { key: "accuracy", icon: "target", tone: "ngoc", label: t("stats.kpi.accuracy"), value: view ? (percent(totals?.ratio) ?? t("stats.kpi.none")) : null },
        ]}
      />

      <Card as="section" className="mb-4 flex flex-col gap-5">
        {/* Deux cadres empilés plutôt qu'un double axe : des réponses et des minutes ne se
            comparent pas, et superposées elles racontent une corrélation inventée. */}
        <DayBars
          title={t("stats.chart.answers")}
          unitLabel={t("stats.chart.answers.unit")}
          points={answers}
          summary={t("stats.chart.answers.summary", { n: totals?.answers ?? 0, days: series.length })}
        />
        <DayBars
          title={t("stats.chart.minutes")}
          unitLabel={t("stats.chart.minutes.unit")}
          tone="nghe"
          height={84}
          points={minutes}
          summary={t("stats.chart.minutes.summary", {
            n: `${minutesLabel(totals?.seconds ?? 0)} min`,
            avg:
              totals?.minutesPerActiveDay === null || totals?.minutesPerActiveDay === undefined
                ? "—"
                : `${minutesLabel(totals.minutesPerActiveDay * 60)} min`,
          })}
        />
      </Card>

      <Card as="section" className="mb-4 flex flex-col gap-2">
        <RatioLine
          title={t("stats.chart.accuracy")}
          hint={t("stats.chart.accuracy.hint")}
          points={accuracy}
          summary={t("stats.chart.accuracy.summary", { n: totals?.ratio === null || totals === undefined ? 0 : Math.round((totals.ratio ?? 0) * 100) })}
        />
        {/* La tendance est une phrase, jamais une flèche nue : une couleur seule ne se lit pas. */}
        {view && <TrendChip trend={view.comparison.trend} label={trendLabel(view.comparison)} />}
      </Card>

      <Card as="section">
        <RegularityStrip
          title={t("stats.chart.regularity")}
          weekdayLabels={t("stats.weekday").split(" ")}
          points={regularityPoints(series, dayLabel)}
          summary={t((totals?.activeDays ?? 0) > 1 ? "stats.chart.regularity.summary" : "stats.chart.regularity.summary.one", {
            n: totals?.activeDays ?? 0,
            total: series.length,
          })}
        />
      </Card>
    </>
  );
}

/**
 * La bande de régularité se lit en semaines : elle commence donc un lundi, quitte à combler le
 * début avec des jours hors fenêtre — sinon les colonnes ne veulent rien dire et « je ne fais
 * jamais rien le dimanche » reste invisible.
 */
function regularityPoints(series: readonly DayPoint[], dayLabel: (day: string) => string): ChartPoint[] {
  const first = series[0];
  if (!first) return [];
  // getDay : 0 = dimanche. On veut lundi en tête.
  const offset = (new Date(`${first.day}T12:00:00`).getDay() + 6) % 7;
  const padding: ChartPoint[] = Array.from({ length: offset }, (_, i) => ({ day: `pad-${i}`, value: 0, label: "", placeholder: true }));
  return [
    ...padding,
    ...series.map((point) => ({
      day: point.day,
      value: point.answers,
      label:
        point.answers > 0
          ? t("stats.chart.regularity.day", { date: dayLabel(point.day), n: point.answers })
          : t("stats.chart.regularity.dayNone", { date: dayLabel(point.day) }),
    })),
  ];
}

function trendLabel(comparison: StatsView["comparison"]): string {
  if (comparison.trend === "unknown" || comparison.recent === null) return t("stats.trend.unknown");
  const to = Math.round(comparison.recent * 100);
  const from = Math.round((comparison.previous ?? 0) * 100);
  if (comparison.trend === "flat") return t("stats.trend.flat", { to });
  return t(comparison.trend === "up" ? "stats.trend.up" : "stats.trend.down", { from, to });
}

/* ----------------------------------------------------------- Compétences */

function SkillsTab({ view }: { view: StatsView | null }) {
  const rows: ShareRow[] = (view?.shares ?? []).map((share) => {
    const summary = view?.skills.find((s) => s.skill === share.skill);
    const level = summary?.level ?? "none";
    return {
      key: share.skill,
      label: t(`profile.skill.${share.skill}` as MessageKey),
      share: share.share,
      detail:
        share.answers > 0
          ? t("stats.skills.detail", { n: share.answers, percent: Math.round((share.ratio ?? 0) * 100) })
          : t("stats.skills.none"),
      // Le verdict est écrit : la couleur de la barre ne le porte jamais seule (laque et curcuma
      // ne se distinguent pas en vision deutan — mesuré, voir charts.tsx).
      verdict: share.answers > 0 ? `${t("stats.skills.share", { percent: Math.round(share.share * 100) })} · ${t(`profile.skill.level.${level}` as MessageKey)}` : undefined,
      tone: level === "fragile" ? "son-mai" : level === "new" || level === "none" ? "nghe" : "ngoc",
    };
  });

  return (
    <>
      <Kpis
        items={[
          { key: "answers", icon: "target", label: t("stats.kpi.answers"), value: view ? String(view.totals.answers) : null },
          { key: "words", icon: "cards", label: t("stats.kpi.words"), value: view ? String(view.counts.words) : null },
          { key: "speaking", icon: "mic", label: t("profile.acquired.speaking"), value: view ? String(view.counts.speaking) : null },
          { key: "xp", icon: "star", tone: "ngoc", label: t("stats.kpi.xp"), value: view ? String(view.xp) : null },
        ]}
      />
      <Card as="section" className="flex flex-col gap-4">
        <SectionTitle id="stats-skills-title" tone="strong" icon="chart">{t("stats.skills.title")}</SectionTitle>
        <ShareBars rows={rows} labelledBy="stats-skills-title" />
        <p className="text-sm text-phu-sa">{t("stats.skills.hint")}</p>
        <p className="min-h-[1.3125rem] text-sm text-phu-sa">{view ? t("stats.skills.lifetime", { n: view.lifetimeAnswers }) : ""}</p>
      </Card>
    </>
  );
}

/* --------------------------------------------------------------- Parcours */

function JourneyTab({ view }: { view: StatsView | null }) {
  const overall = view?.marks.overall;
  const themes = (view?.marks.themes ?? []).filter((theme) => theme.mark !== null);

  return (
    <>
      <Kpis
        items={[
          { key: "lessons", icon: "book", label: t("stats.kpi.lessons"), value: view ? `${view.lessonsDone}/${view.lessonsTotal}` : null },
          { key: "units", icon: "boat", label: t("stats.kpi.units"), value: view ? `${view.unitsPassed}/${view.unitsTotal}` : null },
          { key: "mark", icon: "chart", tone: "ngoc", label: t("stats.kpi.mark"), value: view ? (overall?.mark === null || overall === undefined ? t("stats.kpi.none") : String(overall.mark)) : null },
          { key: "certificates", icon: "diploma", label: t("profile.acquired.certificates"), value: view ? String(view.counts.certificates) : null },
        ]}
      />

      {/* L'anneau de la moyenne est l'objet fort de l'onglet : un seul, et il porte l'écran. */}
      <Card tone="feature" as="section" className="mb-4 flex items-center gap-5" data-testid="stats-overall">
        <ProgressRing value={overall?.mark ?? 0} max={MARK_MAX} size={96} label={t("stats.kpi.mark")}>
          <span className="flex flex-col leading-none">
            <span className="font-serif text-2xl tabular-nums">{overall?.mark ?? "—"}</span>
            <span className="text-sm text-phu-sa tabular-nums">/{MARK_MAX}</span>
          </span>
        </ProgressRing>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-medium">{t("stats.journey.title")}</p>
          <ProgressBar
            value={view?.lessonsDone ?? 0}
            max={Math.max(1, view?.lessonsTotal ?? 1)}
            size="sm"
            label={t("stats.journey.lessons")}
          />
          <p className="text-sm text-phu-sa tabular-nums">
            {t("stats.journey.lessons")} · {view ? `${view.lessonsDone}/${view.lessonsTotal}` : ""}
          </p>
          <Link to="/profil" className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc">
            {t("stats.journey.profile")}
            <Icon name="chevronRight" size={18} />
          </Link>
        </div>
      </Card>

      <Card as="section" className="flex flex-col gap-4">
        <SectionTitle tone="strong" icon="target">{t("stats.journey.themes")}</SectionTitle>
        {themes.length === 0 ? (
          <p className="text-phu-sa">{view ? t("stats.journey.empty") : ""}</p>
        ) : (
          <ul className="flex flex-col gap-3.5" data-testid="stats-themes">
            {themes.map((theme, i) => (
              <ThemeLine key={theme.unit} theme={theme} index={i} />
            ))}
          </ul>
        )}
        <p className="text-sm text-phu-sa">{t("stats.journey.themes.hint")}</p>
      </Card>
    </>
  );
}

function ThemeLine({ theme, index }: { theme: ThemeMark; index: number }) {
  const mark = theme.mark ?? 0;
  const tone = theme.level === "fragile" ? "son-mai" : theme.level === "strong" ? "ngoc" : "nghe";
  return (
    <li data-testid="stats-theme" data-unit={theme.unit} data-level={theme.level ?? "none"} style={staggerStyle(index)} className="motion-safe:parlo-enter">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{l(theme.title)}</span>
        <span className="text-sm text-phu-sa tabular-nums">{t("profile.marks.value", { mark, max: MARK_MAX })}</span>
      </div>
      <ProgressBar value={mark} max={MARK_MAX} size="sm" tone={tone} label={l(theme.title)} />
      {/* Le niveau est écrit à côté de la barre : sa couleur seule ne le dirait pas. */}
      <p className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-sm text-phu-sa">
        <span>{theme.level ? t(`profile.marks.level.${theme.level}` as MessageKey) : ""}</span>
        <span>{t(theme.done > 1 ? "profile.marks.progress.plural" : "profile.marks.progress", { n: theme.done, total: theme.total })}</span>
      </p>
    </li>
  );
}
