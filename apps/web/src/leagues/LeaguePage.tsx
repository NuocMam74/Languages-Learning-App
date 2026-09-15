import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError } from "../api.ts";
import { Screen } from "../components/ui.tsx";
import { BackHeader } from "../exams/BackHeader.tsx";
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
        <Explain text={t("league.guest")}>
          <Link to="/compte?next=/ligue" className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("social.account.cta")}</Link>
        </Explain>
      );
      break;
    case "disabled":
      body = (
        <Explain text={t("league.disabled")}>
          <Link to="/reglages" className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("league.enableLink")}</Link>
        </Explain>
      );
      break;
    case "offline":
      body = <Explain text={t("league.offline")} />;
      break;
    case "pending":
      body = <Explain text={t("league.pending")} />;
      break;
    case "error":
      body = <Explain text={t("social.error")} />;
      break;
    case "league":
      body = <Standings league={view.league} onDisable={() => setView({ kind: "disabled" })} />;
      break;
    case "loading":
      break;
  }

  return (
    <Screen top={<BackHeader title={t("league.title")} />}>
      <div className="flex flex-col gap-5" data-testid="league" data-state={view.kind}>
        {body}
      </div>
    </Screen>
  );
}

function Explain({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <p className="text-lg">{text}</p>
      {children}
    </div>
  );
}

const ZONE_ROW: Record<LeagueZone, string> = {
  promote: "border-l-4 border-nghe",
  relegate: "border-l-4 border-dashed border-phu-sa/25",
  stay: "border-l-4 border-transparent",
};

function Standings({ league, onDisable }: { league: Enabled; onDisable: () => void }) {
  const status = useAccount((s) => s.status);
  const locale = getLocale();
  const { days, hours } = weekRemaining(league.weekEnd);
  const rows = [...league.standings].sort((a, b) => a.rank - b.rank);
  const count = rows.length;
  const zoneOf = (rank: number) => leagueZone(rank, count, league.division, league.promoteTop, league.relegateBottom);

  const disable = async () => {
    await setLeaguesEnabled(false, status === "signed_in");
    clearLeagueCache();
    onDisable();
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-phu-sa">{t("league.division", { n: league.division })}</p>
        <h2 lang="vi" className="font-serif text-vi text-ngoc">{l(league.divisionName)}</h2>
        <p className="text-phu-sa" data-testid="league-countdown">
          {days > 0 ? t("league.endsIn", { d: days, h: hours }) : t("league.endsInHours", { h: hours })}
        </p>
      </header>
      <p className="text-sm text-phu-sa">{t("league.rules", { top: league.promoteTop, bottom: league.relegateBottom })}</p>

      <section aria-label={t("league.standings")}>
        <ol className="flex flex-col">
          {rows.map((row, i) => {
            const zone = zoneOf(row.rank);
            const previous = i > 0 ? zoneOf(rows[i - 1]!.rank) : null;
            const label = zone !== "stay" && zone !== previous ? (
              <li aria-hidden className="pt-3 pb-1 pl-5 text-sm text-phu-sa">{t(zone === "promote" ? "league.zone.promote" : "league.zone.relegate")}</li>
            ) : null;
            return (
              <Fragment key={`${row.rank}:${row.displayName}`}>
                {label}
                <li
                  data-testid="league-row"
                  data-zone={zone}
                  data-me={row.isMe ? "true" : undefined}
                  aria-current={row.isMe ? "true" : undefined}
                  className={`flex min-h-11 items-center gap-3 py-1.5 pr-3 pl-4 ${ZONE_ROW[zone]} ${row.isMe ? "rounded-r-xl bg-ngoc-sang font-semibold" : ""}`}
                >
                  <span className="w-10 shrink-0 text-right tabular-nums text-phu-sa">{ordinal(row.rank, locale)}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {row.displayName}
                    {row.isMe && <span className="text-sm font-normal text-phu-sa"> · {t("league.me")}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{t("league.xp", { n: row.xp })}</span>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </section>

      <button type="button" onClick={() => void disable()} className="min-h-11 self-start text-sm font-semibold text-ngoc">
        {t("league.disableLink")}
      </button>
    </>
  );
}
