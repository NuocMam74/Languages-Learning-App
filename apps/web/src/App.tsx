import type { ContentIndex } from "@parlo/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { Button, Screen } from "./components/ui.tsx";
import { loadPack } from "./content.ts";
import type { Profile } from "./db.ts";
import { t } from "./i18n/index.ts";
import { currentSnapshot, getProfile } from "./learner.ts";
import { Hub } from "./pages/Hub.tsx";
import { LessonPage } from "./pages/LessonPage.tsx";
import { Onboarding } from "./pages/Onboarding.tsx";
import { Welcome } from "./pages/Welcome.tsx";

interface Boot {
  content: ContentIndex;
  profile: Profile;
}

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failed, setFailed] = useState(false);

  const start = useCallback(() => {
    setFailed(false);
    Promise.all([loadPack(), getProfile(), currentSnapshot()])
      .then(([content, profile, snapshot]) => {
        // Reprise exacte, une seule fois au lancement : quitter la leçon ramène ensuite au hub.
        if (snapshot && profile.onboardedAt && window.location.pathname === "/") {
          window.history.replaceState(null, "", `/lecon/${snapshot.run.lessonId}`);
        }
        setBoot({ content, profile });
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(start, [start]);

  if (failed) {
    return (
      <Screen action={<Button onClick={start}>{t("error.retry")}</Button>}>
        <p className="my-auto text-center text-lg">{t("error.content")}</p>
      </Screen>
    );
  }
  if (!boot) return null;
  return <Routes boot={boot} onProfile={(profile) => setBoot({ ...boot, profile })} />;
}

function Routes({ boot, onProfile }: { boot: Boot; onProfile: (p: Profile) => void }) {
  const { content, profile } = boot;
  const onboarded = profile.onboardedAt !== null;

  // Recréé seulement quand l'onboarding se termine (le profil n'évolue pas ailleurs en Phase 0).
  const router = useMemo(
    () =>
      createBrowserRouter([
        {
          path: "/",
          element: onboarded ? <Hub content={content} profile={profile} /> : <Navigate to="/bienvenue" replace />,
        },
        { path: "/bienvenue", element: <Welcome content={content} /> },
        { path: "/onboarding", element: <Onboarding content={content} onDone={onProfile} /> },
        { path: "/lecon/:lessonId", element: <LessonPage content={content} /> },
        { path: "*", element: <Navigate to="/" replace /> },
      ]),
    [content, onboarded],
  );

  return <RouterProvider router={router} />;
}
