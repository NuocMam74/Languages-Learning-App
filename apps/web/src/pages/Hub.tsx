import { localDay, packHasNativeAudio, streakAt, type ContentIndex } from "@parlo/core";
import { examLevels } from "../exams/exam-files.ts";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { LevelLine } from "../components/LevelLine.tsx";
import { RiverPath } from "../components/RiverPath.tsx";
import { Button, Screen } from "../components/ui.tsx";
import { Card, Icon, ProgressRing, SectionTitle, Skeleton, staggerStyle, type IconName } from "../design/index.ts";
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
 *
 * Hiérarchie (contrat phase8 §1) : l'anneau de l'objectif du jour est l'objet fort du haut de
 * l'écran, la carte fluviale celui du bas — entre les deux, tout est discret.
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
  // Un squelette plutôt qu'un écran vide (contrat phase8 §1) — mêmes hauteurs que le contenu final.
  if (!state || accountStatus === "loading") return <HubSkeleton />;

  const { profile, totals, plan, seconds } = state;
  const { xp } = totals;
  // Série à la lecture (contrat phase5 §3) : 0 si des jours manqués ne sont pas couverts.
  const streak = streakAt(totals.streak, localDay(new Date()));
  const minutes = Math.max(1, Math.round(plan.daily.estimatedSeconds / 60));
  const doneMin = Math.floor(seconds / 60);
  const today = localDay(new Date());
  const frozen = streak.frozenUntil !== null && streak.frozenUntil >= today;

  const voices = packHasNativeAudio(content);

  const shortcuts: { to: string; icon: IconName; label: string; badge?: string; strong?: boolean }[] = [
    ...(plan.dueCount > 0
      ? [{
          to: "/revision",
          icon: "cards" as const,
          label: plural("session.hub.review", "session.hub.review.plural", plan.dueCount),
          strong: true,
        }]
      : []),
    { to: "/jeux", icon: "games", label: t("session.hub.games") },
    ...(examLevels(content.pack.code).length > 0 ? [{ to: "/examens", icon: "diploma" as const, label: t("exams.hub.entry") }] : []),
  ];

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
        <div className="min-w-0">
          {/* Changer de langue apprise (ADR 0006) : chaque pack garde sa progression. */}
          <Link to="/langue" className="inline-flex min-h-11 items-center gap-2 font-serif text-2xl" aria-label={`${l(content.pack.name)} — ${t("packs.change")}`} data-testid="hub-pack">
            {l(content.pack.name)}
            <Icon name="chevronDown" size={18} className="text-phu-sa" />
          </Link>
          <p className="text-sm text-phu-sa">{accountStatus === "signed_in" ? t("session.hub.synced") : accountStatus === "expired" ? t("session.hub.expired") : t("hub.guest")}</p>
        </div>
        <Link
          to="/reglages"
          aria-label={t("settings.title")}
          className="grid size-11 shrink-0 place-items-center rounded-full text-phu-sa transition-[background-color,transform] hover:bg-phu-sa/8 motion-safe:active:scale-[.98]"
        >
          <Icon name="settings" strokeWidth={1.8} />
        </Link>
      </header>

      {/* Aucune voix native dans ce pack (contrat phase16 §5) : dit une fois, ici, au ton d'un
          chantier annoncé — et plus jamais en rouge sous chaque mot. Disparaît dès le premier
          enregistrement livré. */}
      {!voices && (
        <Card tone="notice" as="section" role="status" className="mb-4 flex items-start gap-2.5" data-testid="hub-no-voices">
          <Icon name="mute" size={18} className="mt-0.5 shrink-0 text-phu-sa" />
          <span className="min-w-0">
            <span className="block font-medium">{t("audio.noVoices.title")}</span>
            <span className="block text-sm text-phu-sa text-balance">{t("audio.noVoices.body")}</span>
          </span>
        </Card>
      )}

      {notice === "locked" && (
        <Card tone="notice" as="p" role="status" className="mb-4 flex items-center gap-2 py-2.5 text-sm" data-testid="hub-notice">
          <Icon name="lock" size={16} />
          {t("journey.locked")}
        </Card>
      )}

      {/* Salut de Cô Mai : deux lignes réservées, texte échangé sur place quand le serveur répond. */}
      <Card tone="quiet" as="p" className={`mb-5 flex gap-3 ${accountStatus === "signed_in" && online ? "min-h-[4.5rem]" : ""}`} data-testid="tutor-greeting">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-ngoc-sang text-ngoc">
          <Icon name="tutor" size={18} />
        </span>
        <span className="min-w-0">
          <span className="font-semibold">{t("tutor.name")}</span>
          <span className="text-phu-sa"> — </span>
          {greeting ?? localGreeting(new Date(), streak)}
        </span>
      </Card>

      {/* L'élan du jour : un seul bloc, l'anneau porte l'écran. */}
      <Card tone="raised" as="section" className="mb-5 flex flex-col gap-4" aria-label={t("session.hub.progress")}>
        <div className="flex items-center gap-5">
          <ProgressRing
            value={Math.min(doneMin, profile.dailyGoalMin)}
            max={Math.max(1, profile.dailyGoalMin)}
            size={92}
            tone={doneMin >= profile.dailyGoalMin ? "nghe" : "ngoc"}
            label={t("session.hub.goal")}
            data-testid="hub-goal-ring"
          >
            <span className="flex flex-col leading-none">
              <span className="text-2xl font-semibold tabular-nums">{Math.min(doneMin, 999)}</span>
              <span className="text-sm text-phu-sa tabular-nums">/{profile.dailyGoalMin}</span>
            </span>
          </ProgressRing>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="text-sm text-phu-sa">{t("session.hub.goal")}</p>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {streak.current > 0 && (
                <span className="flex items-center gap-1.5 text-lg font-semibold text-son-mai">
                  <Icon name="flame" size={18} className="motion-safe:parlo-flame" />
                  {plural("hub.streak", "hub.streak.plural", streak.current)}
                </span>
              )}
              <span className="text-lg font-semibold text-ngoc tabular-nums">{t("hub.xp", { n: xp })}</span>
            </p>
            {streak.freezesAvailable > 0 && (
              <p className="text-sm text-phu-sa">{plural("hub.freezes", "hub.freezes.plural", streak.freezesAvailable)}</p>
            )}
          </div>
        </div>

        <LevelLine pack={content.pack} xp={xp} />
        <FreezeControl frozenUntil={frozen ? streak.frozenUntil : null} onChange={() => void load()} />
      </Card>

      {/* Ce qu'on peut faire d'autre : des raccourcis lisibles, jamais des liens nus soulignés. */}
      <nav className="mb-6 flex flex-col gap-2" aria-label={t("session.hub.more")}>
        {shortcuts.map((shortcut, i) => (
          <Link
            key={shortcut.to}
            to={shortcut.to}
            style={staggerStyle(i)}
            className={`flex min-h-14 items-center gap-3 rounded-card border px-4 py-3 font-medium transition-transform motion-safe:parlo-enter motion-safe:active:scale-[.99] ${
              shortcut.strong ? "border-ngoc/30 bg-ngoc-sang/50 text-ngoc" : "border-line bg-surface"
            }`}
          >
            <Icon name={shortcut.icon} size={20} className={shortcut.strong ? "text-ngoc" : "text-phu-sa"} />
            <span className="min-w-0 flex-1">{shortcut.label}</span>
            <Icon name="chevronRight" size={18} className="text-phu-sa" />
          </Link>
        ))}
      </nav>

      {/* État de la connexion : il appartient à l'écran où l'on est, pas seulement à l'accueil. */}
      {!online && (
        <p className="mb-4 flex items-center gap-2 rounded-chip bg-surface-2 px-4 py-2.5 text-sm text-phu-sa">
          <Icon name="offline" size={16} />
          {t("hub.offline")}
        </p>
      )}

      {/* La carte du parcours est l'élément mémorable (spec §13) : un bandeau jade l'annonce. */}
      <SectionTitle
        tone="banner"
        icon="boat"
        className="mb-3"
        action={
          <Link to="/mondes" className="flex min-h-11 items-center gap-1 pr-1 font-semibold text-nuoc" data-testid="hub-worlds">
            {t("worlds.title")}
            <Icon name="chevronRight" size={18} />
          </Link>
        }
      >
        {t("hub.path")}
      </SectionTitle>
      {/* Unité en cours disponible hors ligne (spec §8.1) ; toutes les unités : Réglages → Hors ligne. */}
      {plan.next && <Suspense fallback={null}><OfflineUnit content={content} unitId={plan.next.unit} current /></Suspense>}
      <RiverPath content={content} completed={plan.completed} passed={plan.passed} unlocked={plan.open} current={plan.next?.id ?? null} />
      {!plan.next && <p className="py-6 text-center text-phu-sa">{t("hub.done")}</p>}
    </Screen>
  );
}

/** Attente de la lecture d'IndexedDB : les mêmes blocs, en gris — jamais un écran vide. */
function HubSkeleton() {
  return (
    <Screen>
      <div className="flex flex-col gap-5 pt-1" role="status" aria-busy="true" data-testid="hub-skeleton">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="size-11" />
        </div>
        <Skeleton className="h-[4.5rem] w-full" rounded="card" />
        <Skeleton className="h-44 w-full" rounded="card" />
        <Skeleton className="h-14 w-full" rounded="card" />
        <Skeleton className="h-14 w-full" rounded="card" />
      </div>
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
      <button type="button" className="flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-ngoc" onClick={() => setOpen(true)}>
        <Icon name="calendar" size={16} />
        {t("session.freeze.open")}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-field bg-surface-2 px-3 py-3">
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
        <button
          type="button"
          className="min-h-11 rounded-chip bg-ngoc px-4 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98]"
          onClick={() => void setFreeze(days).then(() => { setOpen(false); onChange(); })}
        >
          {t("session.freeze.confirm")}
        </button>
        <button type="button" className="min-h-11 text-ngoc" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
