import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError } from "../api.ts";
import { Screen } from "../components/ui.tsx";
import { Card, EmptyState, Icon, PageHeader, SectionTitle, Skeleton, Stat, staggerStyle } from "../design/index.ts";
import { getLocale, l, t } from "../i18n/index.ts";
import { getProfile } from "../learner.ts";
import type { LeagueDto } from "../social/social-api.ts";
import { useOnline } from "../use-online.ts";
import { clearLeagueCache, fetchLeague, getLeaguesEnabled, leagueZone, ordinal, setLeaguesEnabled, syncLeaguesPref, weekRemaining, type LeagueZone } from "./league-store.ts";

type Enabled = Extract<LeagueDto, { enabled: true }>;

type View =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "disabled" }
  | { kind: "offline" }
  | { kind: "pending" }
  | { kind: "error" }
  | { kind: "league"; league: Enabled };

/** Écran de la ligue (spec §5.3) : division, fin de semaine, classement de 30, zones discrètes. */
export function LeaguePage() {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    if (status === "loading") return;
    let live = true;
    const set = (v: View) => live && setView(v);
    void (async () => {
      const enabled = await getLeaguesEnabled(await getProfile());
      if (status !== "signed_in" && status !== "expired") return set({ kind: "guest" });
      if (!enabled) return set({ kind: "disabled" });
      if (!online) return set({ kind: "offline" });
      await syncLeaguesPref();
      try {
        const league = await fetchLeague(true);
        if (!league.enabled) return set({ kind: "disabled" });
        set(league.standings.length === 0 ? { kind: "pending" } : { kind: "league", league });
      } catch (error) {
        set(error instanceof ApiError && error.status === 404 ? { kind: "pending" } : { kind: "error" });
      }
    })();
    return () => {
      live = false;
    };
  }, [status, online]);

  let body: ReactNode = null;
  switch (view.kind) {
    case "guest":
      body = (
        <EmptyState
          art="lanterns"
          title={t("league.guest")}
          action={<Link to="/compte?next=/ligue" className={LINK_ACTION}>{t("social.account.cta")}</Link>}
        />
      );
      break;
    case "disabled":
      body = (
        <EmptyState
          art="boat"
          title={t("league.disabled")}
          action={<Link to="/reglages" className={LINK_ACTION}>{t("league.enableLink")}</Link>}
        />
      );
      break;
    case "offline":
      body = <EmptyState art="boat" title={t("league.offline")} />;
      break;
    case "pending":
      body = <EmptyState art="lanterns" title={t("league.pending")} />;
      break;
    case "error":
      body = <EmptyState art="page" title={t("social.error")} />;
      break;
    case "league":
      body = <Standings league={view.league} onDisable={() => setView({ kind: "disabled" })} />;
      break;
    case "loading":
      // Jamais d'écran blanc pendant l'appel réseau : la forme du classement s'installe d'abord.
      body = (
        <div className="flex flex-col gap-3" aria-hidden>
          <Skeleton className="h-28 w-full" rounded="card" />
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" rounded="card" />)}
        </div>
      );
      break;
  }

  return (
    <Screen top={<PageHeader title={t("league.title")} back="/" backLabel={t("common.back")} />}>
      <div className="flex flex-col gap-5" data-testid="league" data-state={view.kind}>
        {body}
      </div>
    </Screen>
  );
}

const LINK_ACTION = "flex min-h-11 items-center rounded-chip px-3 font-semibold text-ngoc hover:bg-ngoc/8";

/**
 * Zone de fin de semaine. Le classement est déjà une hiérarchie : la zone se dit par un filet de
 * couleur en tête de ligne, jamais par un fond plein qui écraserait la ligne de l'apprenant.
 */
const ZONE_ROW: Record<LeagueZone, string> = {
  promote: "border-l-4 border-nghe",
  relegate: "border-l-4 border-dashed border-phu-sa/25",
  stay: "border-l-4 border-transparent",
};

/** Podium : les trois premières places portent la coupe, en curcuma pour la première. */
const PODIUM: Record<number, string> = { 1: "text-nghe", 2: "text-phu-sa", 3: "text-phu-sa/70" };

function Standings({ league, onDisable }: { league: Enabled; onDisable: () => void }) {
  const status = useAccount((s) => s.status);
  const locale = getLocale();
  const { days, hours } = weekRemaining(league.weekEnd);
  const rows = [...league.standings].sort((a, b) => a.rank - b.rank);
  const count = rows.length;
  const zoneOf = (rank: number) => leagueZone(rank, count, league.division, league.promoteTop, league.relegateBottom);
  const me = rows.find((r) => r.isMe);

  const disable = async () => {
    await setLeaguesEnabled(false, status === "signed_in");
    clearLeagueCache();
    onDisable();
  };

  return (
    <>
      {/* L'objet fort de l'écran : le nom de la division en grand vietnamien, son compte à rebours. */}
      <Card tone="feature" className="flex flex-col gap-2">
        <p className="text-sm text-phu-sa">{t("league.division", { n: league.division })}</p>
        <h2 lang="vi" className="font-serif text-vi leading-tight text-ngoc">{l(league.divisionName)}</h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="flex items-center gap-1.5 text-phu-sa" data-testid="league-countdown">
            {days > 0 ? t("league.endsIn", { d: days, h: hours }) : t("league.endsInHours", { h: hours })}
          </p>
          {me && <Stat value={ordinal(me.rank, locale)} label={t("league.me")} tone="ngoc" icon="trophy" />}
        </div>
      </Card>
      <p className="text-sm text-phu-sa">{t("league.rules", { top: league.promoteTop, bottom: league.relegateBottom })}</p>

      <section className="flex flex-col gap-2" aria-label={t("league.standings")}>
        <SectionTitle icon="chart">{t("league.standings")}</SectionTitle>
        {/*
          Trente lignes = **une** surface, pas trente cartes empilées (interdit du contrat §1). La
          hiérarchie vient du rang lui-même : la coupe sur le podium, le jade sur la ligne de
          l'apprenant, le filet de zone en tête de ligne. Seules les six premières lignes entrent en
          cascade — plus loin, la cascade se lirait comme un chargement lent.
        */}
        <ol className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {rows.map((row, i) => {
            const zone = zoneOf(row.rank);
            const previous = i > 0 ? zoneOf(rows[i - 1]!.rank) : null;
            const label = zone !== "stay" && zone !== previous ? (
              <li aria-hidden className="flex items-center gap-1.5 bg-surface-2 px-4 py-1.5 text-sm text-phu-sa">
                <Icon name={zone === "promote" ? "arrowUp" : "arrowDown"} size={14} />
                {t(zone === "promote" ? "league.zone.promote" : "league.zone.relegate")}
              </li>
            ) : null;
            return (
              <Fragment key={`${row.rank}:${row.displayName}`}>
                {label}
                <li
                  data-testid="league-row"
                  data-zone={zone}
                  data-me={row.isMe ? "true" : undefined}
                  aria-current={row.isMe ? "true" : undefined}
                  className={`${ZONE_ROW[zone]} ${row.isMe ? "bg-ngoc-sang font-semibold" : ""} ${i < 6 ? "motion-safe:parlo-enter" : ""}`}
                  {...(i < 6 ? { style: staggerStyle(i) as CSSProperties } : {})}
                >
                  {/* Le filet de séparation vit à l'intérieur : le bord gauche de la ligne garde sa couleur de zone. */}
                  <div className={`flex min-h-11 items-center gap-3 py-2 pr-4 pl-3 ${i < rows.length - 1 ? "border-b border-line" : ""}`}>
                    <span className="flex w-11 shrink-0 items-center justify-end gap-1 tabular-nums text-phu-sa">
                      {row.rank <= 3 && <Icon name="trophy" size={14} className={PODIUM[row.rank] ?? ""} />}
                      {ordinal(row.rank, locale)}
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {row.displayName}
                      {row.isMe && <span className="text-sm font-normal text-phu-sa"> · {t("league.me")}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{t("league.xp", { n: row.xp })}</span>
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </section>

      <button type="button" onClick={() => void disable()} className="min-h-11 self-start rounded-chip px-3 text-sm font-semibold text-ngoc hover:bg-ngoc/8">
        {t("league.disableLink")}
      </button>
    </>
  );
}
