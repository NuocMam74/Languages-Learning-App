import { getVapidKey, patchProfile, subscribePush, unsubscribePush } from "../api.ts";
import type { Profile } from "../db.ts";
import { getKv, setKv } from "../db.ts";

/**
 * Rappels quotidiens par Web Push (spec §5.8, contrat phase2 §4).
 * La permission n'est jamais demandée au lancement : seulement après la 3e séance
 * terminée, depuis un écran d'explication, et sur iOS uniquement une fois installée.
 */

export interface ReminderState {
  enabled: boolean;
  hour: number;
  endpoint: string | null;
}

export const SESSIONS_BEFORE_PROMPT = 3;
const STATE_KEY = "notifications";
const ASKED_KEY = "notifications.asked";

export function defaultHour(reminder: Profile["reminder"]): number {
  return reminder === "morning" ? 8 : reminder === "noon" ? 12 : 19;
}

export const getReminderState = (fallbackHour = 19) => getKv<ReminderState>(STATE_KEY, { enabled: false, hour: fallbackHour, endpoint: null });
const saveState = (state: ReminderState) => setKv(STATE_KEY, state);

export function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type PushSupport = "ok" | "unsupported" | "ios_install" | "denied";

export function pushSupport(): PushSupport {
  if (isIos() && !isStandalone()) return "ios_install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Demande la permission (si besoin), abonne le navigateur et enregistre l'abonnement côté API. */
export async function enableReminders(hour: number): Promise<ReminderState> {
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  await setKv(ASKED_KEY, true);
  if (permission !== "granted") throw new Error("permission_denied");

  const { key } = await getVapidKey();
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const tz = timezone();
  await subscribePush({
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    reminderHour: hour,
    timezone: tz,
  });
  await patchProfile({ reminderHour: hour, timezone: tz, notificationsEnabled: true }).catch(() => undefined);
  const state: ReminderState = { enabled: true, hour, endpoint: subscription.endpoint };
  await saveState(state);
  return state;
}

export async function disableReminders(): Promise<ReminderState> {
  const current = await getReminderState();
  let endpoint = current.endpoint;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    endpoint ??= subscription?.endpoint ?? null;
    await subscription?.unsubscribe();
  } catch {
    // Pas de service worker : rien à désabonner localement.
  }
  if (endpoint) await unsubscribePush(endpoint);
  await patchProfile({ notificationsEnabled: false, timezone: timezone() }).catch(() => undefined);
  const state: ReminderState = { ...current, enabled: false, endpoint: null };
  await saveState(state);
  return state;
}

/** Proposer les rappels ? Après la 3e séance, jamais au premier lancement, une seule fois. */
export async function shouldOfferReminders(signedIn: boolean): Promise<boolean> {
  if (!signedIn) return false;
  const [sessions, asked, state] = await Promise.all([getKv<number>("sessionsCompleted", 0), getKv<boolean>(ASKED_KEY, false), getReminderState()]);
  if (asked || state.enabled || sessions < SESSIONS_BEFORE_PROMPT) return false;
  const support = pushSupport();
  return support === "ok" || support === "ios_install";
}

export const markRemindersAsked = () => setKv(ASKED_KEY, true);
