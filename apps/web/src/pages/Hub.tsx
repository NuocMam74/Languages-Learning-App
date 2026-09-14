import { nextLesson, type ContentIndex, type LessonId } from "@parlo/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { InstallHint } from "../components/InstallHint.tsx";
import { RiverPath } from "../components/RiverPath.tsx";
import { Button, Screen } from "../components/ui.tsx";
import type { Profile, Totals } from "../db.ts";
import { l, plural, t } from "../i18n.ts";
import { completedLessons, getTotals } from "../learner.ts";
import { useOnline } from "../use-online.ts";

/** Hub quotidien (spec §4.2) : un bouton principal, la série, la carte du parcours. */
export function Hub({ content, profile }: { content: ContentIndex; profile: Profile }) {
  const navigate = useNavigate();
  const online = useOnline();
  const [state, setState] = useState<{ completed: Set<LessonId>; totals: Totals } | null>(null);

  useEffect(() => {
    void Promise.all([completedLessons(), getTotals()]).then(([completed, totals]) => setState({ completed, totals }));
  }, []);

  if (!state) return <Screen><div /></Screen>;

  const next = nextLesson(content.curriculum, content.lessons, state.completed, profile.motivation);
  const { streak, xp } = state.totals;

  return (
    <Screen
      action={
        next ? (
          <Button onClick={() => navigate(`/lecon/${next.id}`)}>
            {t("hub.daily")} · {t("hub.minutes", { n: next.estimatedMinutes })}
          </Button>
        ) : undefined
      }
    >
      <header className="flex flex-col gap-3 pb-6">
        <div>
          <p className="font-serif text-2xl">{l(content.pack.name)}</p>
          <p className="text-sm text-phu-sa">{t("hub.guest")}</p>
        </div>
        {(streak.current > 0 || xp > 0) && (
          <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="text-lg font-semibold text-son-mai">{plural("hub.streak", "hub.streak.plural", streak.current)}</span>
            <span className="text-lg font-semibold text-ngoc">{t("hub.xp", { n: xp })}</span>
            {streak.freezesAvailable > 0 && <span className="text-sm text-phu-sa">{plural("hub.freezes", "hub.freezes.plural", streak.freezesAvailable)}</span>}
          </p>
        )}
      </header>

      {!online && <p className="mb-4 rounded-xl bg-phu-sa/5 px-4 py-2 text-sm text-phu-sa">{t("hub.offline")}</p>}
      <InstallHint />

      <h2 className="mt-6 mb-2 text-phu-sa">{t("hub.path")}</h2>
      <RiverPath content={content} completed={state.completed} current={next?.id ?? null} />
      {!next && <p className="py-6 text-center text-phu-sa">{t("hub.done")}</p>}
    </Screen>
  );
}
