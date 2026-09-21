import {
  inMonth,
  journalDay,
  monthGrid,
  plannedMinutes,
  shiftMonth,
  type ContentIndex,
  type JournalDay,
  type PlanDay,
  type PlanEntry,
} from "@parlo/core";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, Icon, PageHeader, SectionTitle, Skeleton, staggerStyle, type IconName } from "../design/index.ts";
import { getLocale, l, plural, t, type MessageKey } from "../i18n/index.ts";
import { calendarView, journalInput, type CalendarView } from "./data.ts";

/**
 * Calendrier (contrat phase24 §5) : **ce qui est prévu**, et **ce qui a été fait**.
 *
 * Deux onglets, deux questions. « Ma semaine » répond à « qu'est-ce que je fais aujourd'hui ? » —
 * la question qu'on se pose en ouvrant l'application. « Le mois » répond à « est-ce que j'avance
 * vraiment ? », qu'on se pose en en doutant.
 *
 * Ce qui n'est **pas** là, et c'est le point le plus important : aucun jour manqué n'est marqué en
 * rouge, aucune ligne ne dit « en retard », rien ne se verrouille (spec §5.8). Un calendrier qui
 * gronde est un calendrier qu'on ferme, et on ferme l'application avec.
 */

const TABS = ["week", "month"] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: string | undefined): value is Tab => TABS.includes(value as Tab);

const ENTRY_ICON: Record<PlanEntry["kind"], IconName> = {
  lesson: "boat",
  review: "cards",
  redo: "refresh",
  game: "games",
  tutor: "tutor",
  rest: "heart",
};

export default function CalendarPage({ content }: { content: ContentIndex }) {
  const params = useParams();
  const navigate = useNavigate();
  const tab: Tab = isTab(params.tab) ? params.tab : "week";
  const [view, setView] = useState<CalendarView | null>(null);

  useEffect(() => {
    let live = true;
    void calendarView(content).then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [content]);

  return (
    <Screen top={<PageHeader title={t("calendar.title")} subtitle={t("calendar.subtitle")} back="/profil" backLabel={t("common.back")} />}>
      <div role="tablist" aria-label={t("calendar.title")} className="mb-5 grid grid-cols-2 gap-1 rounded-card bg-surface-2 p-1">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === tab}
            data-testid="calendar-tab"
            data-tab={key}
            onClick={() => navigate(key === "week" ? "/calendrier" : `/calendrier/${key}`, { replace: true })}
            className={`min-h-11 rounded-chip px-2 text-sm font-semibold transition-[background-color,color] ${
              key === tab ? "bg-surface text-ngoc shadow-card" : "text-phu-sa"
            }`}
          >
            {t(`calendar.tab.${key}` as MessageKey)}
          </button>
        ))}
      </div>

      {tab === "week" ? <WeekTab view={view} /> : <MonthTab view={view} />}
    </Screen>
  );
}

/* ------------------------------------------------------------- La semaine */

function WeekTab({ view }: { view: CalendarView | null }) {
  const locale = getLocale();
  const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

  if (!view) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" rounded="card" />
        ))}
      </div>
    );
  }

  const input = journalInput(view);
  return (
    <>
      <SectionTitle tone="strong" icon="calendar" className="pb-2">{t("calendar.plan.title")}</SectionTitle>
      <ul className="flex flex-col gap-2.5" data-testid="calendar-week">
        {view.plan.map((day, index) => (
          <li key={day.day} style={staggerStyle(index)} className="motion-safe:parlo-enter">
            <PlanCard day={day} journal={journalDay(day.day, input)} today={view.today} label={label(day.day)} />
          </li>
        ))}
      </ul>
      <p className="pt-3 text-sm text-phu-sa">{t("calendar.plan.total", { n: plannedMinutes(view.plan) })}</p>
      <p className="pt-1 text-sm text-phu-sa">{t("calendar.plan.hint")}</p>
    </>
  );
}

/**
 * Un jour du programme. Trois états, jamais un quatrième : **fait** (on montre ce qui a été fait,
 * pas ce qui était prévu), **aujourd'hui** (le programme, mis en avant), **à venir** (le programme,
 * discret). Un jour passé sans rien n'a pas d'état à lui : il est simplement vide.
 */
function PlanCard({ day, journal, today, label }: { day: PlanDay; journal: JournalDay; today: string; label: string }) {
  const isToday = day.day === today;
  const past = day.day < today;

  return (
    <Card
      tone={isToday ? "feature" : "plain"}
      className="flex flex-col gap-2"
      data-testid="calendar-day"
      data-day={day.day}
      data-today={isToday || undefined}
      data-active={journal.active || undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium first-letter:uppercase">{label}</span>
        {isToday ? (
          <Chip tone="solid">{t("calendar.today")}</Chip>
        ) : journal.active ? (
          <Chip tone="ngoc" icon="check">{t("calendar.day.done")}</Chip>
        ) : !past ? (
          <span className="text-sm text-phu-sa">{t("calendar.day.future")}</span>
        ) : null}
      </div>

      {/* Ce qui a été fait prime sur ce qui était prévu : un jour passé raconte, il ne réclame pas. */}
      {journal.active ? (
        <JournalLines journal={journal} />
      ) : past ? (
        <p className="text-sm text-phu-sa">{t("calendar.day.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {day.entries.map((entry, i) => (
            <li key={i}>
              <PlanRow entry={entry} strong={isToday} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlanRow({ entry, strong }: { entry: PlanEntry; strong: boolean }) {
  const body = (
    <>
      <Icon name={ENTRY_ICON[entry.kind]} size={18} className={strong ? "text-ngoc" : "text-phu-sa"} />
      <span className="min-w-0 flex-1">
        {t(`calendar.plan.${entry.kind}` as MessageKey)}
        {entry.title && <span className="text-phu-sa"> · {l(entry.title)}</span>}
      </span>
      {entry.minutes > 0 && <span className="shrink-0 text-sm text-phu-sa tabular-nums">{t("calendar.plan.minutes", { n: entry.minutes })}</span>}
    </>
  );
  // Un jour léger ne mène nulle part : il n'a rien à proposer, et c'est le message.
  if (!entry.to) {
    return (
      <p className="flex min-h-11 items-center gap-2.5 text-phu-sa">
        {body}
      </p>
    );
  }
  return (
    <Link to={entry.to} className="flex min-h-11 items-center gap-2.5 font-medium">
      {body}
      <Icon name="chevronRight" size={16} className="shrink-0 text-phu-sa" />
    </Link>
  );
}

/** Ce qui a été fait ce jour-là : des chiffres et des titres, jamais un jugement. */
function JournalLines({ journal }: { journal: JournalDay }) {
  const counters = journal.counters;
  const bits = [
    counters.items ? t("calendar.day.items", { n: counters.items }) : null,
    counters.minutes ? t("calendar.day.minutes", { n: counters.minutes }) : null,
    counters.games ? t("calendar.day.games", { n: counters.games }) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-1">
      {journal.lessons.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid="calendar-day-lessons">
          {journal.lessons.map((lesson, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{l(lesson.title)}</span>
              {lesson.mark !== null && (
                <span className="shrink-0 text-sm font-semibold text-ngoc tabular-nums">{t("calendar.day.mark", { mark: lesson.mark })}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {bits.length > 0 && <p className="text-sm text-phu-sa">{bits.join(" · ")}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- Le mois */

function MonthTab({ view }: { view: CalendarView | null }) {
  const locale = getLocale();
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? view?.today.slice(0, 7) ?? "";
  const [picked, setPicked] = useState<string | null>(null);

  const weeks = useMemo(() => (shown ? monthGrid(shown) : []), [shown]);

  if (!view) return <Skeleton className="h-72 w-full" rounded="card" />;

  const input = journalInput(view);
  const monthLabel = new Date(`${shown}-01T12:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" });
  const day = picked ? journalDay(picked, input) : null;
  const dayLabel = picked ? new Date(`${picked}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setMonth(shiftMonth(shown, -1))} aria-label={t("calendar.previous")} className="grid size-11 place-items-center rounded-full text-phu-sa hover:bg-phu-sa/8">
          <Icon name="chevronLeft" />
        </button>
        <p className="font-serif text-lg first-letter:uppercase" data-testid="calendar-month">{monthLabel}</p>
        <button type="button" onClick={() => setMonth(shiftMonth(shown, 1))} aria-label={t("calendar.next")} className="grid size-11 place-items-center rounded-full text-phu-sa hover:bg-phu-sa/8">
          <Icon name="chevronRight" />
        </button>
      </div>

      <Card className="flex flex-col gap-2">
        <div className="grid grid-cols-7 gap-1.5" aria-hidden>
          {t("calendar.weekdays").split(" ").map((initial, i) => (
            <span key={i} className="text-center text-sm text-phu-sa">{initial}</span>
          ))}
        </div>
        <div className="flex flex-col gap-1.5" data-testid="calendar-grid">
          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 gap-1.5">
              {week.map((date) => {
                const here = inMonth(date, shown);
                const entry = journalDay(date, input);
                const isToday = date === view.today;
                // Trois états, jamais deux : travaillé, **rien fait**, et **pas encore arrivé**.
                // Peindre un jour à venir comme un jour manqué invente des reproches.
                const tone = !here
                  ? "text-phu-sa/40"
                  : entry.active
                    ? "bg-ngoc font-semibold text-nuoc"
                    : entry.future
                      ? "border border-dashed border-line-strong text-phu-sa/70"
                      : "bg-phu-sa/8 text-phu-sa";
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setPicked(picked === date ? null : date)}
                    aria-pressed={picked === date}
                    aria-label={new Date(`${date}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" })}
                    data-testid="calendar-cell"
                    data-day={date}
                    data-active={entry.active || undefined}
                    data-future={entry.future || undefined}
                    className={`grid aspect-square place-items-center rounded-chip text-sm tabular-nums transition-colors ${tone} ${
                      isToday ? "ring-2 ring-muc ring-offset-1 ring-offset-surface" : ""
                    } ${picked === date ? "ring-2 ring-nghe" : ""}`}
                  >
                    {Number(date.slice(8))}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-sm text-phu-sa">{t("calendar.legend")}</p>
      </Card>

      {/* Le détail du jour touché. Hauteur réservée : la carte ne pousse pas la grille (CLS). */}
      <Card tone="quiet" className="mt-3 flex min-h-[5.5rem] flex-col gap-1" data-testid="calendar-detail">
        {day === null ? (
          // La légende est déjà sous la grille : ici on dit ce qu'il y a **à faire**, pas la même chose.
          <p className="text-sm text-phu-sa">{t("calendar.pick")}</p>
        ) : (
          <>
            <p className="font-medium first-letter:uppercase">{dayLabel}</p>
            {day.future ? (
              <p className="text-sm text-phu-sa">{t("calendar.day.future")}</p>
            ) : day.active ? (
              <>
                <JournalLines journal={day} />
                {day.lessons.length > 0 && (
                  <p className="text-sm text-phu-sa">{plural("calendar.day.lessons.one", "calendar.day.lessons", day.lessons.length)}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-phu-sa">{t("calendar.day.empty")}</p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
