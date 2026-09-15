import { useAccount } from "../account.ts";
import { useOnline } from "../use-online.ts";
import { useTutorStatus } from "./status.ts";

/**
 * La conversation avec Cô Mai exige un compte et le réseau (le modèle n'est appelé que par le serveur).
 * `soon` : le serveur n'a pas de modèle ou le pack n'a pas de persona (contrat phase5 §5).
 */
export type TutorAccess = "loading" | "ok" | "guest" | "expired" | "offline" | "soon";

export function useTutorAccess({ conversation = true }: { conversation?: boolean } = {}): TutorAccess {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const available = useTutorStatus((s) => s.available);
  if (conversation && available === false) return "soon";
  if (status === "loading") return "loading";
  if (status === "guest") return "guest";
  if (status === "expired") return "expired";
  return online ? "ok" : "offline";
}
