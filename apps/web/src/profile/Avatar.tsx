import { Avatar as DesignAvatar } from "../design/index.ts";
import { initialsOf } from "./identity.ts";

/**
 * Médaillon d'identité : les initiales du nom affiché, ou une silhouette au trait tant qu'aucun nom
 * n'est donné (spec §13 : pas d'emoji, et surtout pas un « ? » qui ressemble à une erreur).
 *
 * Le dessin vient du système de design (contrat phase8 §1) ; ce fichier ne garde que la règle
 * d'initiales propre au profil (accents, prénoms composés — `identity.ts`).
 */
export function Avatar({ name, size = "sm" }: { name: string | null; size?: "sm" | "lg" }) {
  return <DesignAvatar name={name} initials={name ? initialsOf(name) : null} size={size} />;
}
