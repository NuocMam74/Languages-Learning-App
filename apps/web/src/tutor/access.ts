import { useAccount } from "../account.ts";
import { useOnline } from "../use-online.ts";

/** La conversation avec Cô Mai exige un compte et le réseau (le modèle n'est appelé que par le serveur). */
export type TutorAccess = "loading" | "ok" | "guest" | "expired" | "offline";

export function useTutorAccess(): TutorAccess {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  if (status === "loading") return "loading";
  if (status === "guest") return "guest";
  if (status === "expired") return "expired";
  return online ? "ok" : "offline";
}
