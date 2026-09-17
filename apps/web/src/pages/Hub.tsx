import { localDay, streakAt, type ContentIndex } from "@parlo/core";
import { examLevels } from "../exams/exam-files.ts";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { LevelLine } from "../components/LevelLine.tsx";
import { RiverPath } from "../components/RiverPath.tsx";
import { Button, Screen } from "../components/ui.tsx";
import type { Profile, Totals } from "../db.ts";
import { getLocale, l, plural, t } from "../i18n/index.ts";
import { getProfile, getTotals, hasWork, MAX_FREEZE_DAYS, planning, setFreeze, todaySeconds, type Planning } from "../learner.ts";
import { localGreeting, remoteGreeting } from "../tutor.ts";
import { useOnline } from "../use-online.ts";

const OfflineUnit = lazy(() => import("../offline/OfflineUnit.tsx").then((m) => ({ default: m.OfflineUnit })));

interface HubState {
  profile: Profile;
  totals: Totals;
  plan: Planning;
  seconds: number;
}

/**
 * Parcours de la langue active, route `/apprendre` (spec §4.2, contrat phase7 §1) : la salutation
 * de Cô Mai, un bouton principal, l'objectif du jour, la série de cette langue, les révisions, les
 * examens, les jeux et la carte fluviale.
 *
 * Tout ce qui concerne **le compte** (langues, badges, défi, ligue, devoirs, rappel, installation)
 * vit sur l'accueil `/` : rien de global ici.
 */
export function Hub({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const online = useOnline();
  const accountStatus = useAccount((s) => s.status);
  const [state, setState] = useState<HubState | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;

  const load = async () => {
    const profile = await getProfile();
    const [totals, plan, seconds] = await Promise.all([getTotals(), planning(content, profile), todaySeconds()]);
    setState({ profile, totals, plan, seconds });
  };

  useEffect(() => {
    void load();
  }, [content]);

  useEffect(() => {
    if (accountStatus === "signed_in" && online) void remoteGreeting().then((text) => text && setGreeting(text));
  }, [accountStatus, online]);

  // Statut du compte connu avant le premier rendu : pas de bascule invité → connecté visible (CLS).
  if (!state || accountStatus === "loading") return <Screen><div /></Screen>;

  const { profile, totals, plan, seconds } = state;
  const { xp } = totals;
  // Série à la lecture (contrat phase5 §3) : 0 si des jours manqués ne sont pas couverts.
  const streak = streakAt(totals.streak, localDay(new Date()));
  const minutes = Math.max(1, Math.round(plan.daily.estimatedSeconds / 60));
  const doneMin = Math.floor(seconds / 60);
  const goalRatio = Math.min(1, seconds / (profile.dailyGoalMin * 60));
  const today = localDay(new Date());
  const frozen = streak.frozenUntil !== null && streak.frozenUntil >= today;

  return (
    <Screen
      action={
        hasWork(plan.daily) ? (
          <Button onClick={() => navigate("/seance")}>
            {t("hub.daily")} · {t("hub.minutes", { n: minutes })}
          </Button>
        ) : undefined
      }
    >
      <header className="flex items-start justify-between gap-3 pb-4">
        <div>
          {/* Changer de langue apprise (ADR 0006) : chaque pack garde sa progression. */}
          <Link to="/langue" className="inline-flex min-h-11 items-center font-serif text-2xl" aria-label={`${l(content.pack.name)} — ${t("packs.change")}`} data-testid="hub-pack">
            {l(content.pack.name)}
          </Link>
          <p className="text-sm text-phu-sa">{accountStatus === "signed_in" ? t("session.hub.synced") : accountStatus === "expired" ? t("session.hub.expired") : t("hub.guest")}</p>
        </div>
        <Link to="/reglages" aria-label={t("settings.title")} className="grid size-11 shrink-0 place-items-center rounded-full text-phu-sa hover:bg-phu-sa/5">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
          </svg>
        </Link>
      </header>

      {notice === "locked" && (
        <p role="status" className="mb-4 rounded-xl bg-nghe/15 px-4 py-2 text-sm" data-testid="hub-notice">{t("journey.locked")}</p>
      )}

      {/* Salut du serveur à la place du salut local : deux lignes réservées, texte échangé sur place. */}
      <p className={`mb-5 border-l-4 border-nghe pl-3 ${accountStatus === "signed_in" && online ? "min-h-[3.2rem]" : ""}`} data-testid="tutor-greeting">
        <span className="font-semibold">{t("tutor.name")}</span>
        <span className="text-phu-sa"> — </span>
        {greeting ?? localGreeting(new Date(), streak)}
      </p>

      <section className="flex flex-col gap-3 pb-5" aria-label={t("session.hub.progress")}>
        <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {streak.current > 0 && <span className="text-lg font-semibold text-son-mai">{plural("hub.streak", "hub.streak.plural", streak.current)}</span>}
          <span className="text-lg font-semibold text-ngoc">{t("hub.xp", { n: xp })}</span>
          {streak.freezesAvailable > 0 && <span className="text-sm text-phu-sa">{plural("hub.freezes", "hub.freezes.plural", streak.freezesAvailable)}</span>}
        </p>

        <div>
          <div className="mb-1 flex justify-between text-sm text-phu-sa">
            <span>{t("session.hub.goal")}</span>
            <span>{t("session.hub.goalValue", { done: Math.min(doneMin, 999), goal: profile.dailyGoalMin })}</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-phu-sa/10"
            role="progressbar"
            aria-label={t("session.hub.goal")}
            aria-valuemin={0}
            aria-valuemax={profile.dailyGoalMin}
            aria-valuenow={Math.min(doneMin, profile.dailyGoalMin)}
          >
            <div className={`h-full rounded-full ${goalRatio >= 1 ? "bg-nghe" : "bg-ngoc"}`} style={{ width: `${goalRatio * 100}%` }} />
          </div>
        </div>

        <LevelLine pack={content.pack} xp={xp} />
        <FreezeControl frozenUntil={frozen ? streak.frozenUntil : null} onChange={() => void load()} />
      </section>

      <nav className="flex flex-col border-y border-phu-sa/10" aria-label={t("session.hub.more")}>
        {plan.dueCount > 0 && (
          <Link to="/revision" className="flex min-h-12 items-center justify-between py-2 font-medium text-ngoc">
            <span>{plural("session.hub.review", "session.hub.review.plural", plan.dueCount)}</span>
          </Link>
        )}
        <Link to="/jeux" className="flex min-h-12 items-center border-t border-phu-sa/10 py-2 first:border-t-0">
          {t("session.hub.games")}
        </Link>
        {examLevels(content.pack.code).length > 0 && (
          <Link to="/examens" className="flex min-h-12 items-center border-t border-phu-sa/10 py-2">
            {t("exams.hub.entry")}
          </Link>
        )}
      </nav>

      {/* État de la connexion : il appartient à l'écran où l'on est, pas seulement à l'accueil. */}
      {!online && <p className="mt-4 rounded-xl bg-phu-sa/5 px-4 py-2 text-sm text-phu-sa">{t("hub.offline")}</p>}

      <h2 className="mt-6 mb-2 text-phu-sa">{t("hub.path")}</h2>
      {/* Unité en cours disponible hors ligne (spec §8.1) ; toutes les unités : Réglages → Hors ligne. */}
      {plan.next && <Suspense fallback={null}><OfflineUnit content={content} unitId={plan.next.unit} current /></Suspense>}
      <RiverPath content={content} completed={plan.completed} unlocked={plan.open} current={plan.next?.id ?? null} />
      {!plan.next && <p className="py-6 text-center text-phu-sa">{t("hub.done")}</p>}
    </Screen>
  );
}

function FreezeControl({ frozenUntil, onChange }: { frozenUntil: string | null; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(3);

  if (frozenUntil) {
    const date = new Date(`${frozenUntil}T12:00:00`).toLocaleDateString(getLocale(), { day: "numeric", month: "long" });
    return (
      <p className="flex flex-wrap items-center gap-x-4 text-sm text-phu-sa">
        <span>{t("session.freeze.active", { date })}</span>
        <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => void setFreeze(0).then(onChange)}>
          {t("session.freeze.cancel")}
        </button>
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" className="min-h-11 self-start text-sm font-semibold text-ngoc" onClick={() => setOpen(true)}>
        {t("session.freeze.open")}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-l-4 border-ngoc-sang pl-3">
      <label htmlFor="freeze-days" className="text-sm">{t("session.freeze.question")}</label>
      <div className="flex items-center gap-3">
        <input
          id="freeze-days"
          type="range"
          min={1}
          max={MAX_FREEZE_DAYS}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-11 flex-1 accent-ngoc"
        />
        <span className="w-20 text-right text-sm font-semibold">{plural("session.freeze.days", "session.freeze.days.plural", days)}</span>
      </div>
      <p className="text-sm text-phu-sa">{t("session.freeze.note")}</p>
      <div className="flex gap-4">
        <button type="button" className="min-h-11 rounded-xl bg-ngoc px-4 font-semibold text-nuoc" onClick={() => void setFreeze(days).then(() => { setOpen(false); onChange(); })}>
          {t("session.freeze.confirm")}
        </button>
        <button type="button" className="min-h-11 text-ngoc" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
