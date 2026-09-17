import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
import type { Profile } from "../db.ts";
import { getLocale, l, t } from "../i18n/index.ts";
import { getProfile } from "../learner.ts";
import { useOnline } from "../use-online.ts";
import { fetchLeague, getLeaguesEnabled, ordinal, setLeaguesEnabled, syncLeaguesPref } from "./league-store.ts";

/** Ligne du hub « Tu es 7e en division Rạch » : seulement si la ligue est activée et le rang connu. */
export function LeagueHubLine() {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [line, setLine] = useState<{ rank: number; name: string } | null>(null);

  useEffect(() => {
    if (status !== "signed_in" || !online) {
      setLine(null);
      return;
    }
    let live = true;
    void (async () => {
      if (!(await getLeaguesEnabled(await getProfile()))) return live && setLine(null);
      await syncLeaguesPref();
      try {
        const league = await fetchLeague();
        const me = league.enabled ? league.standings.find((r) => r.isMe) : undefined;
        if (live) setLine(league.enabled && me ? { rank: me.rank, name: l(league.divisionName) } : null);
      } catch {
        if (live) setLine(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [status, online]);

  if (!line) return null;
  return (
    <Link to="/ligue" className="flex min-h-11 items-center self-start text-ngoc" data-testid="league-hub-line">
      {t("league.hub", { rank: ordinal(line.rank, getLocale()), name: line.name })}
    </Link>
  );
}

/** Réglage de la ligue (section des réglages). */
export function LeagueSettings({ motivation, initialEnabled = null }: { motivation: Profile["motivation"]; initialEnabled?: boolean | null }) {
  const status = useAccount((s) => s.status);
  // Valeur préchargée par les Réglages : pas de section qui apparaît après coup (CLS).
  const [enabled, setEnabled] = useState<boolean | null>(initialEnabled);
  const signedIn = status === "signed_in" || status === "expired";

  // Relu quand la motivation change : sans choix explicite, le défaut suit la motivation.
  useEffect(() => {
    void getLeaguesEnabled({ motivation }).then(setEnabled);
  }, [motivation]);

  if (enabled === null) return null;
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    void setLeaguesEnabled(next, status === "signed_in");
  };

  return (
    <div className="flex flex-col gap-2" data-testid="league-settings">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p>{t("league.settings.switch")}</p>
          <p className="text-sm text-phu-sa">{t("league.settings.hint")}</p>
          {!signedIn && <p className="text-sm text-phu-sa">{t("league.settings.guest")}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("league.settings.switch")}
          onClick={toggle}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors before:absolute before:-inset-2 ${enabled ? "bg-ngoc" : "bg-phu-sa/30"}`}
        >
          <span className={`absolute top-1 left-1 size-6 rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : ""}`} />
        </button>
      </div>
      {signedIn && (
        <Link to="/ligue" className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("league.title")}</Link>
      )}
    </div>
  );
}
