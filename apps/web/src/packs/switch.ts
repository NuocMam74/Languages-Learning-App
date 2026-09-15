import { makeEvent } from "@parlo/core";
import { ACTIVE_PACK_KEY, db, type Profile } from "../db.ts";
import { activePackCode, DEFAULT_PACK, isAvailablePack, scopedKey, setActivePackCode } from "./active.ts";

/**
 * Changement de langue apprise (ADR 0006). Le pack actif est une préférence locale
 * (clé `kv` globale) ; chaque changement écrit `pack_switched` dans l'outbox, dans la
 * même transaction (contrat phase3 §4). La progression de chaque pack reste intacte.
 */

/** Lit le pack actif enregistré (au démarrage de l'app). Pack inconnu de ce build : pack par défaut. */
export async function loadActivePack(): Promise<string> {
  const stored = (await db().kv.get(ACTIVE_PACK_KEY))?.value;
  const code = isAvailablePack(stored) ? stored : isAvailablePack(DEFAULT_PACK) ? DEFAULT_PACK : activePackCode();
  setActivePackCode(code);
  return code;
}

/** Active `toPack` et journalise le changement. Sans effet si c'est déjà le pack actif enregistré. */
export async function switchPack(toPack: string, now = new Date()): Promise<boolean> {
  if (!isAvailablePack(toPack)) throw new Error(`Pack inconnu : ${toPack}`);
  const d = db();
  const changed = await d.transaction("rw", d.kv, d.outbox, async () => {
    const stored = (await d.kv.get(ACTIVE_PACK_KEY))?.value;
    const fromPack = isAvailablePack(stored) ? stored : null;
    if (fromPack === toPack) return false;
    await d.kv.put({ key: ACTIVE_PACK_KEY, value: toPack });
    const event = makeEvent("pack_switched", { fromPack, toPack }, now);
    await d.outbox.put({ id: event.id, occurredAt: event.occurredAt, event });
    return true;
  });
  setActivePackCode(toPack);
  return changed;
}

/** L'apprenant a-t-il déjà fait l'onboarding de ce pack ? */
export async function isOnboarded(pack: string): Promise<boolean> {
  const profile = (await db().kv.get(scopedKey("profile", pack)))?.value as Profile | undefined;
  return Boolean(profile?.onboardedAt);
}
