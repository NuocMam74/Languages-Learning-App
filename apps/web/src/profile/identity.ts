import { patchProfile } from "../api.ts";
import { useAccount } from "../account.ts";
import { getKv, setKv } from "../db.ts";

/**
 * Identité affichée (contrat phase7 §3). Le nom vit d'abord sur l'appareil : le mode invité doit
 * marcher entièrement hors ligne. Connecté, le changement part aussi au serveur (`PATCH /me/profile`)
 * et met à jour le compte mémorisé — l'échec réseau ne fait jamais perdre le nom choisi.
 *
 * Clé `kv` globale (pas par pack) : c'est la personne, pas la langue.
 */

const NAME_KEY = "displayName";
export const MAX_DISPLAY_NAME = 40;

export const getStoredDisplayName = () => getKv<string | null>(NAME_KEY, null);

/** Initiales du médaillon : une ou deux lettres, jamais plus (spec §13 : pas d'emoji). */
export function initialsOf(name: string | null): string {
  const words = (name ?? "").trim().split(/[\s'’-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? "");
  const initials = letters.join("").toLocaleUpperCase();
  return initials || "?";
}

export function cleanDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_DISPLAY_NAME);
}

/** Nom affiché : celui choisi ici, sinon celui du compte. Null = invité sans nom (« invité »). */
export async function readDisplayName(): Promise<string | null> {
  const stored = await getStoredDisplayName();
  if (stored) return stored;
  const account = useAccount.getState().account;
  // L'email sert de repli côté compte : on ne l'affiche pas comme un prénom.
  return account && account.displayName && account.displayName !== account.email ? account.displayName : null;
}

export async function saveDisplayName(raw: string): Promise<string> {
  const name = cleanDisplayName(raw);
  await setKv(NAME_KEY, name || null);
  if (useAccount.getState().status === "signed_in" && name) {
    try {
      await patchProfile({ displayName: name });
    } catch {
      // Hors ligne ou champ ignoré par le serveur : le nom reste celui de l'appareil.
    }
  }
  return name;
}
