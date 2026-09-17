import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, Illustration, Notebook, SectionTitle, Skeleton, type IconName } from "../design/index.ts";
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
    <Link
      to="/co-mai"
      className="flex min-h-14 items-center justify-center rounded-card bg-ngoc px-6 text-lg font-semibold text-nuoc shadow-card transition-[background-color,transform] hover:bg-ngoc/90 motion-safe:active:scale-[.98]"
    >
      {t("tutor.debrief.talk")}
    </Link>
  );

  if (access === "loading" || debrief === undefined) {
    return (
      <Screen top={<BackHome />}>
        {!failed && <p className="pb-3 text-phu-sa" role="status">{t("tutor.thinking")}</p>}
        <div className="flex flex-col gap-4" aria-hidden>
          <Skeleton className="h-28 w-full" rounded="card" />
          <Skeleton className="h-24 w-full" rounded="card" />
          <Skeleton className="h-24 w-full" rounded="card" />
        </div>
      </Screen>
    );
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
        <div className="my-auto" role="alert">
          <EmptyState art="notebook" title={t("tutor.debrief.title")} body={t("tutor.debrief.error")} />
        </div>
      </Screen>
    );
  }

  const week = new Date(`${debrief.weekStart.slice(0, 10)}T12:00:00`).toLocaleDateString(getLocale(), { day: "numeric", month: "long" });
  // Trois regards sur la même semaine : ce qui monte, ce qui résiste, ce qu'on vise. L'icône dit
  // lequel avant même la lecture ; le ton de la carte fait la hiérarchie (le progrès d'abord).
  const sections: { title: string; text: string; icon: IconName }[] = [
    { title: t("tutor.debrief.progress"), text: debrief.progress, icon: "chart" },
    { title: t("tutor.debrief.struggles"), text: debrief.struggles, icon: "target" },
    { title: t("tutor.debrief.goal"), text: debrief.goal, icon: "flame" },
  ];
  return (
    <Screen top={<BackHome />} action={access === "ok" ? talk : undefined}>
      <article className="flex flex-col gap-5" data-testid="weekly-debrief">
        {/* En-tête mémorable : le carnet ouvert, la semaine datée. Un seul objet fort par écran. */}
        <Card tone="feature" className="flex items-center gap-4">
          <Illustration className="max-w-[6.5rem] shrink-0"><Notebook /></Illustration>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl leading-tight">{t("tutor.debrief.title")}</h1>
            <p className="text-phu-sa">{t("tutor.debrief.week", { date: week })}</p>
          </div>
        </Card>
        {sections.map((s, i) => (
          <section key={s.title} className="flex flex-col gap-2">
            <SectionTitle tone="strong" icon={s.icon}>{s.title}</SectionTitle>
            <Card tone={i === 0 ? "raised" : "plain"} stagger={i}>
              <p className="text-lg whitespace-pre-line">{s.text}</p>
            </Card>
          </section>
        ))}
        {access !== "ok" && (
          <Chip tone="neutral" icon="offline" className="self-start">{t("tutor.debrief.cached")}</Chip>
        )}
      </article>
    </Screen>
  );
}
