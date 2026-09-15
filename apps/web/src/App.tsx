import type { ContentIndex } from "@parlo/core";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { useAccount } from "./account.ts";
import { Button, Screen } from "./components/ui.tsx";
import { loadPack } from "./content.ts";
import type { Profile } from "./db.ts";
import { t } from "./i18n/index.ts";
import { currentSession, getProfile, sessionPath } from "./learner.ts";
import { Hub } from "./pages/Hub.tsx";
import { Onboarding } from "./pages/Onboarding.tsx";
import { SessionPage } from "./pages/SessionPage.tsx";
import { Welcome } from "./pages/Welcome.tsx";
import { GamePlayPage, GamesPage } from "./games/GamesPage.tsx";
import { usePrefs } from "./prefs.ts";
import { startSync } from "./sync.ts";

/** Pages de démonstration des composants (spec §16) : développement uniquement, absentes du build. */
const DemoPage = import.meta.env.DEV ? lazy(() => import("./demo/DemoPage.tsx")) : null;

// Écrans hors du parcours quotidien : chargés à la demande (bundle principal léger).
const LanguageChoice = lazy(() => import("./pages/LanguageChoice.tsx"));
const Placement = lazy(() => import("./pages/Placement.tsx"));
const AccountPage = lazy(() => import("./pages/Account.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const Badges = lazy(() => import("./pages/Badges.tsx"));
// Phase 2 : examens, certificats, rappels.
const ExamsPage = lazy(() => import("./exams/ExamPages.tsx").then((m) => ({ default: m.ExamsPage })));
const MockExamPage = lazy(() => import("./exams/ExamPages.tsx").then((m) => ({ default: m.MockExamPage })));
const RealExamPage = lazy(() => import("./exams/ExamPages.tsx").then((m) => ({ default: m.RealExamPage })));
const CertificatesPage = lazy(() => import("./certificates/CertificatePages.tsx").then((m) => ({ default: m.CertificatesPage })));
const VerifyPage = lazy(() => import("./certificates/CertificatePages.tsx").then((m) => ({ default: m.VerifyPage })));
const KaraokePage = lazy(() => import("./karaoke/KaraokePage.tsx"));
const RemindersPage = lazy(() => import("./notifications/Reminders.tsx").then((m) => ({ default: m.RemindersPage })));

const later = (node: ReactNode) => <Suspense fallback={null}>{node}</Suspense>;

interface Boot {
  content: ContentIndex;
  profile: Profile;
}

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failed, setFailed] = useState(false);
  const locale = usePrefs((s) => s.locale);

  const start = useCallback(() => {
    setFailed(false);
    Promise.all([loadPack(), getProfile()])
      .then(async ([content, profile]) => {
        const session = await currentSession(content);
        // Reprise exacte, une seule fois au lancement : quitter la séance ramène ensuite au hub.
        if (session && profile.onboardedAt && window.location.pathname === "/") {
          window.history.replaceState(null, "", sessionPath(session));
        }
        setBoot({ content, profile });
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(start, [start]);

  useEffect(() => {
    void useAccount.getState().init();
    return startSync();
  }, []);

  if (failed) {
    return (
      <Screen action={<Button onClick={start}>{t("error.retry")}</Button>}>
        <p className="my-auto text-center text-lg">{t("error.content")}</p>
      </Screen>
    );
  }
  if (!boot) return null;
  // Changer la langue d'interface remonte l'arbre : toutes les chaînes sont relues.
  return <Routes key={locale ?? "auto"} boot={boot} onProfile={(profile) => setBoot({ ...boot, profile })} />;
}

function Routes({ boot, onProfile }: { boot: Boot; onProfile: (p: Profile) => void }) {
  const { content, profile } = boot;
  const onboarded = profile.onboardedAt !== null;

  // Recréé seulement quand l'onboarding se termine ; les pages relisent le profil elles-mêmes.
  const router = useMemo(
    () =>
      createBrowserRouter([
        {
          path: "/",
          element: onboarded ? <Hub content={content} /> : <Navigate to="/bienvenue" replace />,
        },
        { path: "/bienvenue", element: <Welcome content={content} /> },
        { path: "/langue", element: later(<LanguageChoice content={content} />) },
        { path: "/onboarding", element: <Onboarding content={content} onDone={onProfile} /> },
        { path: "/placement", element: later(<Placement content={content} />) },
        { path: "/seance", element: <SessionPage content={content} mode="daily" /> },
        { path: "/revision", element: <SessionPage content={content} mode="review" /> },
        { path: "/lecon/:lessonId", element: <SessionPage content={content} mode="lesson" /> },
        { path: "/compte", element: later(<AccountPage mode="register" />) },
        { path: "/connexion", element: later(<AccountPage mode="login" />) },
        { path: "/reglages", element: later(<Settings />) },
        { path: "/badges", element: later(<Badges />) },
        { path: "/jeux", element: <GamesPage /> },
        { path: "/jeux/karaoke_tonal", element: later(<KaraokePage content={content} />) },
        { path: "/jeux/:game", element: <GamePlayPage content={content} /> },
        { path: "/examens", element: later(<ExamsPage content={content} />) },
        { path: "/examens/:level", element: later(<RealExamPage content={content} />) },
        { path: "/examens/:level/blanc", element: later(<MockExamPage content={content} />) },
        { path: "/certificats", element: later(<CertificatesPage content={content} />) },
        { path: "/verifier/:code", element: later(<VerifyPage />) },
        { path: "/rappels", element: later(<RemindersPage />) },
        ...(DemoPage
          ? [
              { path: "/demo", element: <Suspense fallback={null}><DemoPage content={content} /></Suspense> },
              { path: "/demo/:component", element: <Suspense fallback={null}><DemoPage content={content} /></Suspense> },
            ]
          : []),
        { path: "*", element: <Navigate to="/" replace /> },
      ]),
    [content, onboarded],
  );

  return <RouterProvider router={router} />;
}
