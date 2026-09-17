import { levelForXp, levelName, type ContentIndex } from "@parlo/core";
import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { Slot } from "../components/Slot.tsx";
import { Button, Screen } from "../components/ui.tsx";
import { VerifyEmailBanner } from "../components/VerifyEmailBanner.tsx";
import { Avatar, Card, DeltaDawn, Icon, Illustration, ProgressRing, SectionTitle, Skeleton } from "../design/index.ts";
import { getLocale, l, plural, t } from "../i18n/index.ts";
import { currentSession, sessionPath } from "../learner.ts";
import { readDisplayName } from "../profile/identity.ts";
import { activePackCode } from "../packs/active.ts";
import { isOnboarded, switchPack } from "../packs/switch.ts";
import { usePackChoices } from "../packs/use-packs.ts";
import { OptionalChunk } from "../pwa/chunk-recovery.tsx";
import { useOnline } from "../use-online.ts";
import { allPackSummaries, cachedPackSummary, resumePack, type PackSummary } from "./summary.ts";

/** Cartes secondaires : leur code et leurs requêtes arrivent après le premier affichage. */
const ChallengeCard = lazy(() => import("../challenges/ChallengeCard.tsx").then((m) => ({ default: m.ChallengeCard })));
const LeagueHubLine = lazy(() => import("../leagues/LeagueWidgets.tsx").then((m) => ({ default: m.LeagueHubLine })));
const ReminderPrompt = lazy(() => import("../notifications/Reminders.tsx").then((m) => ({ default: m.ReminderPrompt })));
const HubAssignmentCard = lazy(() => import("../classes/HubAssignmentCard.tsx"));
const InstallHint = lazy(() => import("../components/InstallHint.tsx").then((m) => ({ default: m.InstallHint })));
const HubTutor = lazy(() => import("../tutor/HubTutor.tsx").then((m) => ({ default: m.HubTutor })));
// Badges et certificat : dessins de médaillons et fichiers d'examen — hors du bundle de démarrage.
const DashboardBadges = lazy(() => import("./Motivation.tsx").then((m) => ({ default: m.DashboardBadges })));
const DashboardCertificate = lazy(() => import("./Motivation.tsx").then((m) => ({ default: m.DashboardCertificate })));

/**
 * Accueil (contrat phase7 §2) : **jamais spécifique à une langue**. Un compte, ses langues, sa
 * reprise, son élan. Tout vient d'IndexedDB (lisible hors ligne) ; le serveur ne fait que compléter.
 *
 * Hiérarchie (contrat phase8 §1) : une seule carte porte l'écran — « Reprendre » (ou l'invitation
 * du premier jour). Les langues sont une liste homogène, la motivation un rayon discret. Jamais
 * deux cartes identiques empilées.
 *
 * Anti-CLS : les résumés déjà calculés s'affichent au premier rendu, et chaque bloc garde sa
 * hauteur pendant la lecture (l'audit mobile avait mesuré des sauts de mise en page ici).
 */
export function Dashboard({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const online = useOnline();
  const accountStatus = useAccount((s) => s.status);
  const choices = usePackChoices(content.pack);
  const codes = choices.map((c) => c.code);
  const active = activePackCode();

  const [summaries, setSummaries] = useState<PackSummary[] | null>(() => {
    const cached = codes.map((code) => cachedPackSummary(code));
    return cached.every((s) => s !== null) ? (cached as PackSummary[]) : null;
  });
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Séance interrompue de la langue active : « tout est reprenable » (spec §3.6) passe par ce bouton. */
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // La langue active est relue à chaque venue (on arrive souvent d'une séance) ; les autres
    // gardent leur résumé en mémoire.
    void allPackSummaries(codes, new Date(), [active]).then((next) => live && setSummaries(next));
    void readDisplayName().then((value) => live && setName(value));
    void currentSession(content)
      .then((session) => live && setSaved(session ? sessionPath(session) : null))
      .catch(() => undefined);
    // Badges et certificat : le chunk part tout de suite, il arrive avec leurs données.
    void import("./Motivation.tsx").catch(() => undefined);
    return () => {
      live = false;
    };
    // codes.join : la liste des langues proposées ne change qu'après lecture des pack.json.
  }, [codes.join(","), active, accountStatus]);

  const resume = summaries ? resumePack(summaries, active) : null;
  const totalXp = (summaries ?? []).reduce((sum, s) => sum + s.xp, 0);
  const streak = (summaries ?? []).reduce((best, s) => Math.max(best, s.streak), 0);
  const level = levelForXp(totalXp);
  const tier = levelName(content.pack.levelNames, level.value);
  const started = (summaries ?? []).some((s) => s.started);

  /** Ouvre une langue : elle devient la langue active (`pack_switched`) puis on va sur son parcours. */
  const open = async (code: string, to: string) => {
    if (busy) return;
    if (code === active) {
      navigate(to);
      return;
    }
    setBusy(true);
    try {
      await switchPack(code);
      // Une langue jamais commencée passe par son propre onboarding (chaque pack a le sien).
      const target = (await isOnboarded(code)) ? to : "/onboarding";
      // Contenu, profil et progression du nouveau pack : on repart d'un démarrage propre (hors ligne compris).
      window.location.assign(target);
    } catch {
      setBusy(false);
    }
  };

  // Une séance en cours de la langue active se reprend exactement où elle s'est arrêtée.
  const sessionTarget = (code: string) => (code === active && saved ? saved : "/seance");

  const mainAction =
    summaries === null ? null : !started ? (
      <Button data-testid="dashboard-first-cta" onClick={() => void open(resume?.code ?? active, sessionTarget(resume?.code ?? active))}>
        {t("dashboard.first.cta")}
      </Button>
    ) : resume && resume.nextLesson ? (
      <Button data-testid="dashboard-resume-cta" disabled={busy} onClick={() => void open(resume.code, sessionTarget(resume.code))}>
        {t("dashboard.resume.daily")} · {t("dashboard.minutes", { n: resume.nextLesson.minutes })}
      </Button>
    ) : resume ? (
      <Button data-testid="dashboard-resume-cta" disabled={busy} onClick={() => void open(resume.code, "/apprendre")}>
        {t("dashboard.resume.continue")}
      </Button>
    ) : null;

  return (
    <Screen action={mainAction}>
      <Header name={name} level={level.value} tier={tier ? l(tier) : null} xp={totalXp} streak={streak} loading={summaries === null} />
      <VerifyEmailBanner />

      {/* 2. Reprendre — l'action principale de l'écran (le seul bouton plein est en bas). */}
      {started ? <ResumeCard summary={resume} /> : <FirstRun signedIn={accountStatus === "signed_in"} />}

      {/* 3. Mes langues */}
      <section aria-labelledby="dash-langs" className="pb-6">
        <SectionTitle id="dash-langs" icon="globe" className="pb-2">{t("dashboard.languages.title")}</SectionTitle>
        <ul className="flex flex-col gap-2" data-testid="dashboard-languages">
          {codes.map((code, i) => (
            <li key={code}>
              <LanguageCard
                summary={summaries?.find((s) => s.code === code) ?? null}
                code={code}
                fallbackName={choices.find((c) => c.code === code)?.name ?? null}
                active={code === active}
                disabled={busy}
                index={i}
                onOpen={() => void open(code, "/apprendre")}
              />
            </li>
          ))}
        </ul>
        <Link to="/langue" className="mt-3 flex min-h-11 items-center gap-2 font-semibold text-ngoc" data-testid="dashboard-add-language">
          <Icon name="plus" size={18} />
          {t("dashboard.languages.add")}
        </Link>
      </section>

      {/* 4. Motivation — cartes courtes, masquées si vides. */}
      <section aria-labelledby="dash-motivation" className="flex flex-col gap-2 border-t border-line pt-5">
        <SectionTitle id="dash-motivation" icon="flame" className="pb-1">{t("dashboard.motivation.title")}</SectionTitle>
        <Slot id={`dash-challenge-${accountStatus}`} fallback={accountStatus === "signed_in" && online ? 132 : 0}>
          <OptionalChunk>
            <Suspense fallback={null}><ChallengeCard content={content} /></Suspense>
          </OptionalChunk>
        </Slot>
        <Slot id={`dash-league-${accountStatus}`}>
          <div className="empty:hidden">
            <OptionalChunk>
              <Suspense fallback={null}><LeagueHubLine /></Suspense>
            </OptionalChunk>
          </div>
        </Slot>
        {accountStatus === "signed_in" && online && (
          <Slot id="dash-assignment">
            <OptionalChunk>
              <Suspense fallback={null}><HubAssignmentCard content={content} completed={new Set()} /></Suspense>
            </OptionalChunk>
          </Slot>
        )}
        {/* Badges et certificat : chunk chargé après le premier affichage puis lecture d'IndexedDB.
            Les hauteurs réelles sont réservées d'avance (rangée de médaillons 60 px, carte 52 px) :
            la section ne grandit pas sous les yeux de l'apprenant (CLS). */}
        <Slot id="dash-badges" fallback={started ? 60 : 0}>
          <div className="empty:hidden">
            <OptionalChunk>
              <Suspense fallback={null}><DashboardBadges pack={content.pack} /></Suspense>
            </OptionalChunk>
          </div>
        </Slot>
        <Slot id="dash-certificate" fallback={started ? 52 : 0}>
          <div className="empty:hidden">
            <OptionalChunk>
              <Suspense fallback={null}><DashboardCertificate content={content} /></Suspense>
            </OptionalChunk>
          </div>
        </Slot>
        <Slot id="dash-reminder">
          <OptionalChunk>
            <Suspense fallback={null}><ReminderPrompt /></Suspense>
          </OptionalChunk>
        </Slot>
      </section>

      {/* 5. Cô Mai — entrée conversation / bilan, pour la langue active seulement. */}
      <section className="mt-5 border-t border-line pt-5">
        <OptionalChunk>
          <Suspense fallback={null}><HubTutor /></Suspense>
        </OptionalChunk>
      </section>

      {/* 6. Hors ligne et installation. */}
      {!online && (
        <p className="mt-4 mb-4 flex items-center gap-2 rounded-chip bg-surface-2 px-4 py-2.5 text-sm text-phu-sa" data-testid="dashboard-offline">
          <Icon name="offline" size={16} />
          {t("dashboard.offline")}
        </p>
      )}
      {started && (
        <Slot id="dash-install">
          <div className="empty:hidden">
            <OptionalChunk>
              <Suspense fallback={null}><InstallHint /></Suspense>
            </OptionalChunk>
          </div>
        </Slot>
      )}
    </Screen>
  );
}

function greetingKey(now: Date) {
  const hour = now.getHours();
  if (hour < 12) return "dashboard.hello.morning" as const;
  return hour < 18 ? ("dashboard.hello.afternoon" as const) : ("dashboard.hello.evening" as const);
}

function Header({ name, level, tier, xp, streak, loading }: { name: string | null; level: number; tier: string | null; xp: number; streak: number; loading: boolean }) {
  return (
    // Hauteur fixe : les chiffres arrivent d'IndexedDB, la ligne ne grandit pas sous eux.
    <header className="flex min-h-[4.5rem] items-start justify-between gap-3 pb-5" data-testid="dashboard-header">
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold">{t(greetingKey(new Date()), { name: name ?? t("dashboard.guest") })}</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="dashboard-totals" data-level={level}>
          <span className="font-semibold">
            {t("journey.level.label", { n: level })}
            {tier && <span className="font-normal text-phu-sa"> · {tier}</span>}
          </span>
          {loading ? (
            <Skeleton className="h-4 w-16" />
          ) : (
            <span className="font-semibold text-ngoc tabular-nums">{t("dashboard.xp", { n: xp })}</span>
          )}
          <span className="flex items-center gap-1 text-phu-sa">
            {streak > 0 && <Icon name="flame" size={15} className="text-son-mai motion-safe:parlo-flame" />}
            {streak > 0 ? plural("dashboard.streak", "dashboard.streak.plural", streak) : t("dashboard.streak.none")}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link to="/profil" aria-label={t("dashboard.openProfile")} data-testid="dashboard-avatar" className="grid min-h-11 place-items-center">
          <Avatar name={name} />
        </Link>
        <Link
          to="/reglages"
          aria-label={t("settings.title")}
          className="grid size-11 place-items-center rounded-full text-phu-sa transition-[background-color,transform] hover:bg-phu-sa/8 motion-safe:active:scale-[.98]"
        >
          <Icon name="settings" strokeWidth={1.8} />
        </Link>
      </div>
    </header>
  );
}

/** Première ouverture : une invitation, pas un tableau vide (contrat §1). Le delta ouvre l'écran. */
function FirstRun({ signedIn }: { signedIn: boolean }) {
  return (
    <Card tone="feature" as="section" className="mb-6 flex min-h-[9rem] flex-col items-center gap-2 text-center" data-testid="dashboard-first">
      <Illustration className="max-w-[15rem] motion-safe:parlo-enter">
        <DeltaDawn />
      </Illustration>
      <h2 className="font-serif text-2xl">{t("dashboard.first.title")}</h2>
      <p className="text-phu-sa text-balance">{t("dashboard.first.body")}</p>
      {!signedIn && <p className="text-sm text-phu-sa">{t("dashboard.first.guest")}</p>}
    </Card>
  );
}

/** Carte « Reprendre » : la langue utilisée en dernier, sa prochaine leçon, son unité en cours. */
function ResumeCard({ summary }: { summary: PackSummary | null }) {
  const unit = summary?.unit ?? null;
  const done = unit?.done ?? 0;
  const total = unit?.total ?? 0;
  return (
    <Card
      tone="feature"
      as="section"
      className="mb-6 flex min-h-[10.5rem] flex-col gap-2"
      aria-labelledby="dash-resume"
      data-testid="dashboard-resume"
      data-pack={summary?.code}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="dash-resume" className="text-sm text-phu-sa">{t("dashboard.resume.title")}</h2>
          <p className="font-serif text-2xl leading-tight" data-testid="dashboard-resume-pack">{summary?.name ? l(summary.name) : (summary?.code ?? "")}</p>
          {summary?.nextLesson ? (
            <p className="pt-1" data-testid="dashboard-next-lesson">
              <span className="font-semibold">{l(summary.nextLesson.title)}</span>
              <span className="flex items-center gap-1.5 text-sm text-phu-sa">
                <Icon name="clock" size={14} />
                {t("dashboard.minutes", { n: summary.nextLesson.minutes })}
              </span>
            </p>
          ) : (
            <p className="pt-1 text-phu-sa">{summary ? t("dashboard.resume.done") : ""}</p>
          )}
        </div>
        {/* Seule animation orchestrée de l'écran (spec §13) : l'anneau de l'unité se remplit. */}
        {unit && (
          <ProgressRing
            value={done}
            max={Math.max(1, total)}
            size={76}
            label={t("dashboard.resume.unitProgress", { done, total })}
            data-testid="dashboard-unit-ring"
          >
            {/* Chiffres nus au centre : lisibles à 76 px et identiques dans toutes les langues. */}
            <span className="text-lg font-semibold tabular-nums">{done}<span className="text-phu-sa">/{total}</span></span>
          </ProgressRing>
        )}
      </div>
      {unit && <p className="truncate text-sm text-phu-sa">{l(unit.title)}</p>}
      {summary && summary.dueCount > 0 && (
        <Link to="/revision" className="flex min-h-11 items-center gap-2 font-semibold text-ngoc" data-testid="dashboard-due">
          <Icon name="cards" size={18} />
          {plural("dashboard.resume.due", "dashboard.resume.due.plural", summary.dueCount)}
        </Link>
      )}
    </Card>
  );
}

function LanguageCard({ summary, code, fallbackName, active, disabled, index, onOpen }: {
  summary: PackSummary | null;
  code: string;
  fallbackName: ReturnType<typeof usePackChoices>[number]["name"];
  active: boolean;
  disabled: boolean;
  index: number;
  onOpen: () => void;
}) {
  const name = summary?.name ?? fallbackName;
  const label = name ? l(name) : code;
  const date = summary?.lastActiveAt ? new Date(summary.lastActiveAt).toLocaleDateString(getLocale(), { day: "numeric", month: "long" }) : null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      data-testid="dashboard-language"
      data-pack={code}
      data-active={active || undefined}
      aria-label={t("dashboard.lang.open", { name: label })}
      style={{ "--parlo-stagger": `${Math.min(index, 5) * 40}ms` } as CSSProperties}
      className={`flex min-h-[5.25rem] w-full flex-col gap-1 rounded-card border px-5 py-3 text-left transition-transform motion-safe:parlo-enter motion-safe:active:scale-[.99] ${
        active ? "border-ngoc/40 bg-ngoc-sang/50 shadow-card" : "border-line bg-surface"
      }`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="font-serif text-lg">{label}</span>
        {active && <span className="shrink-0 rounded-chip bg-ngoc px-2 py-0.5 text-sm font-medium text-nuoc">{t("dashboard.lang.active")}</span>}
      </span>
      {summary === null ? (
        <Skeleton className="h-4 w-2/3" />
      ) : summary.contentMissing ? (
        <span className="text-sm text-phu-sa">{t("dashboard.lang.unavailable")}</span>
      ) : summary.started ? (
        <>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold tabular-nums">{t("dashboard.lang.lessons", { done: summary.lessonsDone, total: summary.lessonsTotal })}</span>
            <span className="text-phu-sa tabular-nums">{plural("dashboard.lang.units", "dashboard.lang.units.plural", summary.unitsPassed)}</span>
            <span className="text-phu-sa tabular-nums">{t("dashboard.xp", { n: summary.xp })}</span>
          </span>
          <span className="text-sm text-phu-sa">{date ? t("dashboard.lang.lastActive", { date }) : ""}</span>
        </>
      ) : (
        <span className="text-sm text-phu-sa">{t("dashboard.lang.never")}</span>
      )}
    </button>
  );
}
