import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
import { t } from "../i18n/index.ts";
import { fetchRoles } from "../teacher/teacher-api.ts";
import { useOnline } from "../use-online.ts";
import { getMyClasses } from "./classes-api.ts";

/**
 * Réglages : « Espace enseignant » pour le rôle teacher, « Mes classes » pour l'élève inscrit.
 * Rien pour les autres (ni invité, ni hors ligne) : la section entière est masquée.
 */
export function ClassesSettings() {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [teacher, setTeacher] = useState(false);
  const [student, setStudent] = useState(false);

  useEffect(() => {
    if (status !== "signed_in" || !online) return;
    let live = true;
    void fetchRoles().then((roles) => live && setTeacher(roles.includes("teacher")));
    getMyClasses().then((c) => live && setStudent(c.length > 0), () => undefined);
    return () => {
      live = false;
    };
  }, [status, online]);

  if (!teacher && !student) return null;
  return (
    <section className="flex flex-col gap-3 border-t border-phu-sa/10 py-5 first:border-t-0" data-testid="classes-settings">
      <h2 className="font-semibold">{t("classes.settings.title")}</h2>
      <div className="flex flex-wrap gap-x-6">
        {teacher && <Link to="/prof" className="min-h-11 py-2 font-semibold text-ngoc">{t("classes.settings.teacher")}</Link>}
        {student && <Link to="/mes-classes" className="min-h-11 py-2 font-semibold text-ngoc">{t("classes.settings.mine")}</Link>}
      </div>
    </section>
  );
}
