import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { getLocale, t } from "../i18n/index.ts";
import { useTutorAccess } from "./access.ts";
import { GateActions, TutorGate } from "./ChatView.tsx";
import type { WeeklyDebrief } from "./client.ts";
import { BackHome } from "./ConversationPage.tsx";
import { cachedDebrief, fetchDebrief } from "./debrief.ts";

/** Bilan de la semaine : ce qui progresse, ce qui coince, l'objectif (spec §5.7). */
export default function DebriefPage() {
  // Le bilan a un repli lisible sans modèle : il ne dépend pas de la disponibilité de la conversation.
  const access = useTutorAccess({ conversation: false });
  const [debrief, setDebrief] = useState<WeeklyDebrief | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (access === "loading") return;
    let cancelled = false;
    void (async () => {
      const cached = await cachedDebrief();
      if (cancelled) return;
      if (access !== "ok") {
        setDebrief(cached);
        return;
      }
      if (cached) setDebrief(cached);
      try {
        const fresh = await fetchDebrief();
        if (!cancelled) setDebrief(fresh);
      } catch {
        if (!cancelled) {
          setDebrief(cached);
          if (!cached) setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access]);

  const talk = (
    <Link to="/co-mai" className="flex min-h-14 items-center justify-center rounded-2xl bg-ngoc px-6 text-lg font-semibold text-nuoc">
      {t("tutor.debrief.talk")}
    </Link>
  );

  if (access === "loading" || debrief === undefined) {
    return <Screen top={<BackHome />}><p className="my-auto text-center text-phu-sa">{failed ? "" : t("tutor.thinking")}</p></Screen>;
  }
  if (!debrief) {
    if (access !== "ok") {
      return (
        <Screen top={<BackHome />} action={<GateActions reason={access} />}>
          <TutorGate reason={access} />
        </Screen>
      );
    }
    return (
      <Screen top={<BackHome />}>
        <p className="my-auto text-center text-lg text-phu-sa" role="alert">{t("tutor.debrief.error")}</p>
      </Screen>
    );
  }

  const week = new Date(`${debrief.weekStart.slice(0, 10)}T12:00:00`).toLocaleDateString(getLocale(), { day: "numeric", month: "long" });
  const sections = [
    { title: t("tutor.debrief.progress"), text: debrief.progress, accent: "border-ngoc" },
    { title: t("tutor.debrief.struggles"), text: debrief.struggles, accent: "border-son-mai" },
    { title: t("tutor.debrief.goal"), text: debrief.goal, accent: "border-nghe" },
  ];
  return (
    <Screen top={<BackHome />} action={access === "ok" ? talk : undefined}>
      <article className="flex flex-col gap-6" data-testid="weekly-debrief">
        <header>
          <h1 className="font-serif text-2xl">{t("tutor.debrief.title")}</h1>
          <p className="text-phu-sa">{t("tutor.debrief.week", { date: week })}</p>
        </header>
        {sections.map((s) => (
          <section key={s.title} className={`border-l-4 pl-4 ${s.accent}`}>
            <h2 className="font-semibold">{s.title}</h2>
            <p className="text-lg whitespace-pre-line">{s.text}</p>
          </section>
        ))}
        {access !== "ok" && <p className="text-sm text-phu-sa">{t("tutor.debrief.cached")}</p>}
      </article>
    </Screen>
  );
}
