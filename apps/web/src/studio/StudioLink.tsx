import { Link } from "react-router";
import { useAccount } from "../account.ts";
import { st } from "./i18n.ts";
import { canUseStudio, useMyRoles } from "./roles.ts";

/** Lien vers le studio dans les Réglages : seulement pour les relecteurs, éditeurs et administrateurs connectés. */
export function StudioLink() {
  const status = useAccount((s) => s.status);
  const signedIn = status === "signed_in";
  const roles = useMyRoles(signedIn);
  if (!signedIn || roles.status !== "ready" || !canUseStudio(roles.roles)) return null;
  return (
    <section className="flex flex-col gap-1 border-t border-phu-sa/10 py-5" data-testid="studio-link">
      <Link to="/studio" className="min-h-11 self-start py-2 font-semibold text-ngoc">{st("studio.link")}</Link>
      <p className="text-sm text-phu-sa">{st("studio.link.hint")}</p>
    </section>
  );
}
