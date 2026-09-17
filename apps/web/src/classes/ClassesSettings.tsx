import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
import { Icon, SectionTitle } from "../design/index.ts";
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
  // Deux entrées au plus : des rangées posées sur une surface, pas deux liens nus côte à côte.
  const row = "flex min-h-12 items-center gap-3 rounded-card border border-line bg-surface px-4 py-2 font-semibold text-ngoc transition-[background-color] hover:bg-ngoc-sang/40";
  return (
    <section className="flex flex-col gap-3 border-t border-line py-5" data-testid="classes-settings">
      <SectionTitle icon="diploma">{t("classes.settings.title")}</SectionTitle>
      <div className="flex flex-col gap-2">
        {teacher && (
          <Link to="/prof" className={row}>
            <Icon name="users" size={20} />
            <span className="min-w-0 flex-1">{t("classes.settings.teacher")}</span>
            <Icon name="chevronRight" size={18} className="opacity-60" />
          </Link>
        )}
        {student && (
          <Link to="/mes-classes" className={row}>
            <Icon name="notebook" size={20} />
            <span className="min-w-0 flex-1">{t("classes.settings.mine")}</span>
            <Icon name="chevronRight" size={18} className="opacity-60" />
          </Link>
        )}
      </div>
    </section>
  );
}
