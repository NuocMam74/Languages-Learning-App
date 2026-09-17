import type { ContentIndex } from "@parlo/core";
import { localDay } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
import { Icon } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import { useOnline } from "../use-online.ts";
import { assignmentProgress, featuredAssignment, nextLesson } from "./assignments.ts";
import { getMyClasses, type MyClass } from "./classes-api.ts";
import { whenLabel } from "./widgets.tsx";

/** Hub : « Devoir : … pour vendredi (3/5) », vers la prochaine leçon du devoir. Rien sans classe. */
export default function HubAssignmentCard({ content, completed }: { content: ContentIndex; completed: ReadonlySet<string> }) {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [classes, setClasses] = useState<MyClass[] | null>(null);

  useEffect(() => {
    if (status !== "signed_in" || !online) return;
    let live = true;
    getMyClasses().then((c) => live && setClasses(c), () => live && setClasses(null));
    return () => {
      live = false;
    };
  }, [status, online]);

  if (!classes) return null;
  const today = localDay(new Date());
  const featured = featuredAssignment(classes, today, completed);
  if (!featured) return null;
  const { assignment } = featured;
  const { done, total } = assignmentProgress(assignment, completed);
  const next = nextLesson(assignment, completed, (id) => content.lessons.has(id));
  const text = assignment.dueDate
    ? t("classes.hub.card", { title: assignment.title, when: whenLabel(assignment.dueDate, today), done, total })
    : t("classes.hub.cardNoDue", { title: assignment.title, done, total });

  return (
    // Rangée du hub, pas une bannière : même surface que les autres cartes, même hauteur qu'avant
    // (l'emplacement du hub mesure ce bloc). Les icônes sont muettes : le libellé reste seul à parler.
    <Link
      to={next ? `/lecon/${encodeURIComponent(next)}` : "/mes-classes"}
      className="mb-5 flex min-h-12 items-center gap-3 rounded-card border border-ngoc/25 bg-surface px-4 py-1 font-semibold text-ngoc transition-[background-color,transform] hover:bg-ngoc-sang/40 motion-safe:active:scale-[.99]"
      data-testid="hub-assignment"
    >
      <Icon name="notebook" size={20} />
      <span className="min-w-0 flex-1">{text}</span>
      <Icon name="chevronRight" size={18} className="opacity-60" />
    </Link>
  );
}
