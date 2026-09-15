import type { ContentIndex } from "@parlo/core";
import { localDay } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
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
    <Link
      to={next ? `/lecon/${encodeURIComponent(next)}` : "/mes-classes"}
      className="mb-5 flex min-h-12 items-center border-l-4 border-ngoc py-1 pl-4 font-semibold text-ngoc"
      data-testid="hub-assignment"
    >
      {text}
    </Link>
  );
}
