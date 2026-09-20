import { packHasNativeAudio, type ContentIndex } from "@parlo/core";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { useAccount } from "./account.ts";
import { NativeVoices } from "./components/AudioButton.tsx";
import { Shell } from "./components/BottomNav.tsx";
import { ScreenSkeleton, WithMessages } from "./components/Skeleton.tsx";
import { Button, Screen } from "./components/ui.tsx";
import { checkContentUpdate, loadPack, warmLessonUnit } from "./content.ts";
import { Dashboard } from "./dashboard/Dashboard.tsx";
import { DeepLinkGuard } from "./dashboard/DeepLinkGuard.tsx";
import type { Profile } from "./db.ts";
import { ensureMessages, t } from "./i18n/index.ts";
import { currentSession, getProfile, sessionPath } from "./learner.ts";
import { WithUnits } from "./offline/ContentGate.tsx";
import { prefetchLikelyUnits } from "./offline/prefetch.ts";
import { loadActivePack } from "./packs/switch.ts";
import { Hub } from "./pages/Hub.tsx";
import { Welcome } from "./pages/Welcome.tsx";
import { usePrefs } from "./prefs.ts";
import { RouteError, withRecovery } from "./pwa/chunk-recovery.tsx";
import { UpdatePrompt } from "./pwa/UpdatePrompt.tsx";
import { restoreOnStart, STATE_RESTORED_EVENT } from "./restore.ts";
import { ACCOUNT_UPDATED_EVENT, startSync } from "./sync.ts";
import { useTutorStatus } from "./tutor/status.ts";

/** Pages de démonstration des composants (spec §16) : développement uniquement, absentes du build. */
const DemoPage = import.meta.env.DEV ? lazy(() => import("./demo/DemoPage.tsx")) : null;

// Séance et jeux : chargés à la demande (le hub et l'accueil n'embarquent ni exercices, ni jeux, ni karaoké).
const SessionPage = lazy(() => import("./pages/SessionPage.tsx").then((m) => ({ default: m.SessionPage })));
const GamesPage = lazy(() => import("./games/GamesPage.tsx").then((m) => ({ default: m.GamesPage })));
const GamePlayPage = lazy(() => import("./games/GamesPage.tsx").then((m) => ({ default: m.GamePlayPage })));
const Onboarding = lazy(() => import("./pages/Onboarding.tsx").then((m) => ({ default: m.Onboarding })));
// Écrans hors du parcours quotidien : chargés à la demande (bundle principal léger).
const LanguageChoice = lazy(() => import("./pages/LanguageChoice.tsx"));
const Placement = lazy(() => import("./pages/Placement.tsx"));
const AccountPage = lazy(() => import("./pages/Account.tsx"));
const ForgotPasswordPage = lazy(() => import("./pages/AccountRecovery.tsx").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./pages/AccountRecovery.tsx").then((m) => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import("./pages/AccountRecovery.tsx").then((m) => ({ default: m.VerifyEmailPage })));
const Settings = lazy(() => import("./pages/Settings.tsx"));
/** Changer d'appareil (contrat phase17 §2) : écran dédié, chargé à la demande. */
const TransferPage = lazy(() => import("./pages/Transfer.tsx"));
const ProfilePage = lazy(() => import("./profile/ProfilePage.tsx"));
/** Onglet « Réviser » (contrat phase8 §2, §4) : la bibliothèque de tout ce qui a été vu, et les notes. */
const ReviewPage = lazy(() => import("./review/ReviewPage.tsx"));
const NotesPage = lazy(() => import("./notes/NotesPage.tsx"));
const TipPage = lazy(() => import("./review/Tips.tsx").then((m) => ({ default: m.TipPage })));
const Badges = lazy(() => import("./pages/Badges.tsx"));
// Phase 9 : missions, récompenses, atelier du personnage.
const MissionsPage = lazy(() => import("./missions/MissionsPage.tsx"));
// Phase 11 : la carte des mondes.
const WorldsPage = lazy(() => import("./worlds/WorldsPage.tsx"));
const WorldPage = lazy(() => import("./worlds/WorldsPage.tsx").then((m) => ({ default: m.WorldPage })));
const RewardsPage = lazy(() => import("./rewards/RewardsPage.tsx"));
const WardrobePage = lazy(() => import("./rewards/WardrobePage.tsx"));
// Phase 2 : examens, certificats, rappels.
const ExamsPage = lazy(() => import("./exams/ExamPages.tsx").then((m) => ({ default: m.ExamsPage })));
const MockExamPage = lazy(() => import("./exams/ExamPages.tsx").then((m) => ({ default: m.MockExamPage })));
const RealExamPage = lazy(() => import("./exams/ExamPages.tsx").then((m) => ({ default: m.RealExamPage })));
const CertificatesPage = lazy(() => import("./certificates/CertificatePages.tsx").then((m) => ({ default: m.CertificatesPage })));
const VerifyPage = lazy(() => import("./certificates/CertificatePages.tsx").then((m) => ({ default: m.VerifyPage })));
const KaraokePage = lazy(() => import("./karaoke/KaraokePage.tsx"));
const RemindersPage = lazy(() => import("./notifications/Reminders.tsx").then((m) => ({ default: m.RemindersPage })));
// Phase 3 : Cô Mai (conversation, bilan de la semaine) et Đối đáp.
const TutorStartPage = lazy(() => import("./tutor/ConversationPage.tsx").then((m) => ({ default: m.TutorStartPage })));
const ConversationPage = lazy(() => import("./tutor/ConversationPage.tsx").then((m) => ({ default: m.ConversationPage })));
const DebriefPage = lazy(() => import("./tutor/DebriefPage.tsx"));
const DoiDapPage = lazy(() => import("./games/DoiDapPage.tsx"));
// Phase 3 : ligue, défis entre amis, défi express, partage.
const LeaguePage = lazy(() => import("./leagues/LeaguePage.tsx").then((m) => ({ default: m.LeaguePage })));
const ChallengesPage = lazy(() => import("./social/FriendsPages.tsx").then((m) => ({ default: m.ChallengesPage })));
const JoinChallengePage = lazy(() => import("./social/FriendsPages.tsx").then((m) => ({ default: m.JoinChallengePage })));
const ExpressPage = lazy(() => import("./social/ExpressPages.tsx").then((m) => ({ default: m.ExpressPage })));
const SharePage = lazy(() => import("./social/ExpressPages.tsx").then((m) => ({ default: m.SharePage })));
// Phase 4 : espace enseignant (rôle teacher) et classes côté élève.
const TeacherHomePage = lazy(() => import("./teacher/TeacherPages.tsx").then((m) => ({ default: m.TeacherHomePage })));
const TeacherClassPage = lazy(() => import("./teacher/TeacherPages.tsx").then((m) => ({ default: m.ClassPage })));
const JoinClassPage = lazy(() => import("./classes/ClassesPages.tsx").then((m) => ({ default: m.JoinClassPage })));
const MyClassesPage = lazy(() => import("./classes/ClassesPages.tsx").then((m) => ({ default: m.MyClassesPage })));
// Phase 4 : studio de contenu (reviewer, editor, admin) ; garde des rôles dans le chunk du studio.
const StudioApp = lazy(() => import("./studio/StudioApp.tsx"));

// Écran à la demande : squelette, puis chaînes d'interface de tous les domaines chargées avant le rendu.
const later = (node: ReactNode) => <Suspense fallback={<ScreenSkeleton />}><WithMessages>{node}</WithMessages></Suspense>;

/** Travail non critique après le premier affichage (le navigateur peint d'abord). */
const afterFirstPaint = (task: () => void) => {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  setTimeout(() => (idle ? idle(task, { timeout: 2000 }) : task()), 0);
};

const inSessionRoute = () => /^\/(seance|revision|lecon\/)/.test(window.location.pathname);

interface Boot {
  content: ContentIndex;
  profile: Profile;
}

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failed, setFailed] = useState(false);
  const chosenLocale = usePrefs((s) => s.locale);
  // Langue d'interface changée : l'arbre est remonté une fois ses chaînes chargées (anglais chargé à la demande).
  const [locale, setLocale] = useState(chosenLocale);
  useEffect(() => {
    let live = true;
    void ensureMessages("all").then(() => live && setLocale(chosenLocale), () => live && setLocale(chosenLocale));
    return () => {
      live = false;
    };
  }, [chosenLocale]);

  const start = useCallback(() => {
    setFailed(false);
    // Lien direct vers une séance : son écran et toutes les chaînes partent en même temps que le contenu
    // (une seule attente réseau au lieu de trois en cascade).
    if (inSessionRoute()) {
      void import("./pages/SessionPage.tsx");
      void ensureMessages("all");
      const lessonId = /^\/lecon\/(.+)$/.exec(window.location.pathname)?.[1];
      if (lessonId) warmLessonUnit(decodeURIComponent(lessonId));
    }
    // Langue apprise enregistrée d'abord (ADR 0006) : contenu, profil et progression sont ceux de ce pack.
    loadActivePack()
      .then(async () => {
        // Nouvel appareil d'un compte connecté : progression restaurée avant d'afficher le parcours (contrat phase5 §4).
        // Sans effet (et sans réseau) dès qu'une progression locale existe.
        await restoreOnStart().catch(() => false);
      })
      // Premier affichage depuis IndexedDB (ou core.json, petit et précaché) : jamais d'attente réseau si le contenu est local.
      .then(() => Promise.all([loadPack(), getProfile(), ensureMessages("boot")]))
      .then(async ([content, profile]) => {
        const session = await currentSession(content);
        // Reprise exacte, une seule fois au lancement, en arrivant sur le parcours de la langue :
        // quitter la séance y ramène ensuite. L'accueil (`/`) n'enlève jamais la vue d'ensemble —
        // sa carte « Reprendre » propose la séance interrompue (contrat phase7 §2).
        if (session && profile.onboardedAt && window.location.pathname === "/apprendre") {
          window.history.replaceState(null, "", sessionPath(session));
        }
        setBoot({ content, profile });
        afterFirstPaint(() => {
          void useTutorStatus.getState().refresh({ packHasTutor: Boolean(content.pack.tutor) });
          void import("./offline/downloads.ts").then((m) => m.startOfflineMaintenance(content));
          void prefetchLikelyUnits(content);
          void ensureMessages("all");
          // Prochain écran probable depuis le hub : la séance (chunk préchargé au repos).
          if (!inSessionRoute()) void import("./pages/SessionPage.tsx");
          // Contenu publié depuis le build (contrat phase5 §6), vérifié en arrière-plan : appliqué tout de suite hors
          // séance (le hub se met à jour), sinon mis en attente jusqu'à la fin de la séance.
          void checkContentUpdate(undefined, undefined, inSessionRoute)
            .then(async (update) => {
              if (update !== "applied" || inSessionRoute()) return;
              const next = await loadPack();
              setBoot((current) => (current ? { ...current, content: next } : current));
            })
            .catch(() => undefined);
        });
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(start, [start]);

  useEffect(() => {
    // Progression restaurée depuis le compte (connexion, OAuth) : on relit contenu et profil.
    const onRestored = () => start();
    const onAccount = () => void useAccount.getState().reload();
    window.addEventListener(STATE_RESTORED_EVENT, onRestored);
    window.addEventListener(ACCOUNT_UPDATED_EVENT, onAccount);
    return () => {
      window.removeEventListener(STATE_RESTORED_EVENT, onRestored);
      window.removeEventListener(ACCOUNT_UPDATED_EVENT, onAccount);
    };
  }, [start]);

  useEffect(() => {
    void useAccount.getState().init();
    // File du défi express : module chargé après le premier affichage.
    let stopExpress: (() => void) | null = null;
    let live = true;
    void import("./social/express-store.ts").then((m) => {
      if (live) stopExpress = m.startExpressQueue(() => useAccount.getState().status === "signed_in");
    });
    const stopSync = startSync();
    return () => {
      live = false;
      stopExpress?.();
      stopSync();
    };
  }, []);

  if (failed) {
    return (
      <Screen action={<Button onClick={start}>{t("error.retry")}</Button>}>
        <p className="my-auto text-center text-lg">{t("error.content")}</p>
      </Screen>
    );
  }
  if (!boot) return <ScreenSkeleton />;
  // Changer la langue d'interface remonte l'arbre : toutes les chaînes sont relues.
  return <Routes key={locale ?? "auto"} boot={boot} onProfile={(profile) => setBoot({ ...boot, profile })} />;
}

function Routes({ boot, onProfile }: { boot: Boot; onProfile: (p: Profile) => void }) {
  const { content, profile } = boot;
  const onboarded = profile.onboardedAt !== null;

  // Recréé seulement quand l'onboarding se termine ; les pages relisent le profil elles-mêmes.
  const router = useMemo(
    () =>
      // withRecovery : chunk périmé après déploiement → rechargement unique ou écran « Recharger ».
      // Toutes les routes vivent sous `Shell` : il pose la navigation basse (contrat phase7 §1) et
      // la place qu'elle réserve. Chaque route garde son propre écran de secours (withRecovery).
      createBrowserRouter([{
        element: <Shell />,
        errorElement: <RouteError />,
        children: withRecovery([
          {
            path: "/",
            element: onboarded ? <Dashboard content={content} /> : <Navigate to="/bienvenue" replace />,
          },
        // Le parcours de la langue active : tout ce qui existait sur l'ancien accueil.
        { path: "/apprendre", element: onboarded ? <Hub content={content} /> : <Navigate to="/bienvenue" replace /> },
        { path: "/profil", element: later(<ProfilePage content={content} />) },
        // Bibliothèque « Réviser » : les explications et les cartes culture vivent dans les unités,
        // donc celles de la progression sont chargées avant le rendu (au mieux : hors ligne, les
        // unités absentes n'apportent rien et ne cassent rien).
        { path: "/reviser", element: later(<WithUnits content={content}><ReviewPage content={content} /></WithUnits>) },
        { path: "/reviser/:section", element: later(<WithUnits content={content}><ReviewPage content={content} /></WithUnits>) },
        // La fiche conseil se lit sans la bibliothèque : son contenu vient de core.json, donc pas de
        // `WithUnits` ni de lecture d'IndexedDB — elle s'ouvre instantanément, hors ligne compris.
        { path: "/reviser/conseils/:guideId", element: later(<TipPage content={content} />) },
        { path: "/notes", element: later(<WithUnits content={content}><NotesPage content={content} /></WithUnits>) },
        { path: "/bienvenue", element: <Welcome content={content} /> },
        { path: "/langue", element: later(<LanguageChoice content={content} />) },
        { path: "/onboarding", element: later(<Onboarding content={content} onDone={onProfile} />) },
        { path: "/placement", element: later(<Placement content={content} />) },
        { path: "/seance", element: later(<SessionPage content={content} mode="daily" />) },
        { path: "/revision", element: later(<SessionPage content={content} mode="review" />) },
        // Lien profond vers une leçon d'une autre langue : confirmation, bascule, puis la leçon (contrat phase7 §1).
        { path: "/lecon/:lessonId", element: later(<DeepLinkGuard><SessionPage content={content} mode="lesson" /></DeepLinkGuard>) },
        // Rejouer une leçon terminée en entraînement (contrat phase8 §2). Sous `/lecon/` : c'est un
        // écran de concentration comme un autre (navigation basse masquée, reprise de séance).
        { path: "/lecon/:lessonId/entrainement", element: later(<DeepLinkGuard><SessionPage content={content} mode="practice" /></DeepLinkGuard>) },
        { path: "/compte", element: later(<AccountPage mode="register" />) },
        { path: "/connexion", element: later(<AccountPage mode="login" />) },
        { path: "/compte/mot-de-passe-oublie", element: later(<ForgotPasswordPage />) },
        { path: "/compte/reinitialiser", element: later(<ResetPasswordPage />) },
        { path: "/compte/verifier", element: later(<VerifyEmailPage />) },
        { path: "/reglages", element: later(<Settings />) },
        { path: "/reglages/appareil", element: later(<TransferPage />) },
        { path: "/badges", element: later(<Badges content={content} />) },
        { path: "/missions", element: later(<MissionsPage content={content} />) },
        { path: "/mondes", element: later(<WorldsPage content={content} />) },
        { path: "/mondes/:worldId", element: later(<WorldPage content={content} />) },
        { path: "/recompenses", element: later(<RewardsPage />) },
        { path: "/atelier", element: later(<WardrobePage />) },
        { path: "/jeux", element: later(<WithUnits content={content}><GamesPage content={content} /></WithUnits>) },
        { path: "/jeux/karaoke_tonal", element: later(<WithUnits content={content}><KaraokePage content={content} /></WithUnits>) },
        { path: "/jeux/doi_dap", element: later(<DoiDapPage content={content} />) },
        { path: "/co-mai", element: later(<TutorStartPage />) },
        { path: "/co-mai/:conversationId", element: later(<ConversationPage content={content} />) },
        { path: "/bilan-semaine", element: later(<DebriefPage />) },
        { path: "/jeux/:game", element: later(<WithUnits content={content}><GamePlayPage content={content} /></WithUnits>) },
        { path: "/examens", element: later(<ExamsPage content={content} />) },
        { path: "/examens/:level", element: later(<WithUnits content={content}><RealExamPage content={content} /></WithUnits>) },
        { path: "/examens/:level/blanc", element: later(<WithUnits content={content}><MockExamPage content={content} /></WithUnits>) },
        { path: "/certificats", element: later(<CertificatesPage content={content} />) },
        { path: "/verifier/:code", element: later(<VerifyPage />) },
        { path: "/rappels", element: later(<RemindersPage />) },
        { path: "/ligue", element: later(<LeaguePage />) },
        { path: "/defis", element: later(<ChallengesPage />) },
        { path: "/defi/:code", element: later(<JoinChallengePage />) },
        { path: "/:lang/defi/:code", element: later(<JoinChallengePage />) },
        { path: "/express", element: later(<ExpressPage content={content} />) },
        { path: "/partage/:id", element: later(<SharePage />) },
        { path: "/prof", element: later(<TeacherHomePage />) },
        { path: "/prof/classes/:id", element: later(<TeacherClassPage />) },
        { path: "/classe/:code", element: later(<JoinClassPage />) },
        { path: "/mes-classes", element: later(<MyClassesPage content={content} />) },
        { path: "/studio/*", element: later(<StudioApp />) },
        ...(DemoPage
          ? [
              { path: "/demo", element: later(<WithUnits content={content} scope="all"><DemoPage content={content} /></WithUnits>) },
              { path: "/demo/:component", element: later(<WithUnits content={content} scope="all"><DemoPage content={content} /></WithUnits>) },
            ]
          : []),
        { path: "*", element: <Navigate to="/" replace /> },
        ]),
      }]),
    [content, onboarded],
  );
  const voices = useMemo(() => packHasNativeAudio(content), [content]);

  return (
    // Aucune voix native dans le pack (contrat phase16 §5) : les boutons audio le disent
    // calmement au lieu d'afficher une erreur rouge par mot. Fourni ici, une fois, parce que
    // c'est un état du **contenu** et non de l'écran où l'on se trouve.
    <NativeVoices.Provider value={voices}>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </NativeVoices.Provider>
  );
}
