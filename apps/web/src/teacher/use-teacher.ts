import { useEffect, useState } from "react";
import { useAccount } from "../account.ts";
import { useOnline } from "../use-online.ts";
import { fetchRoles } from "./teacher-api.ts";

export type TeacherAccess = "loading" | "guest" | "offline" | "notTeacher" | "teacher";

/** Accès à l'espace enseignant : compte connecté, en ligne, rôle `teacher` dans `/me.roles`. */
export function useTeacherAccess(): TeacherAccess {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [roles, setRoles] = useState<string[] | null>(null);

  useEffect(() => {
    if (status !== "signed_in" || !online) return;
    let live = true;
    void fetchRoles().then((r) => live && setRoles(r));
    return () => {
      live = false;
    };
  }, [status, online]);

  if (status === "loading") return "loading";
  if (status !== "signed_in") return "guest";
  if (!online) return "offline";
  if (roles === null) return "loading";
  return roles.includes("teacher") ? "teacher" : "notTeacher";
}
