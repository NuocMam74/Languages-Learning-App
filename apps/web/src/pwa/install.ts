/**
 * Installation de la PWA : l'événement `beforeinstallprompt` est capturé dès le démarrage
 * (il arrive souvent avant que le hub soit affiché) et la plateforme iOS est détectée finement.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(event: BeforeInstallPromptEvent | null) => void>();

export function captureInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    for (const listener of listeners) listener(deferred);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    for (const listener of listeners) listener(null);
  });
}

export const installPrompt = () => deferred;

export function onInstallPrompt(listener: (event: BeforeInstallPromptEvent | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints): boolean {
  return /iphone|ipad|ipod/i.test(ua) || (platform === "MacIntel" && touchPoints > 1);
}

/**
 * Safari lui-même (seul navigateur iOS qui propose « Sur l'écran d'accueil » partout) :
 * pas Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS), Opera, Google app ni navigateurs intégrés.
 */
export function isIosSafari(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints): boolean {
  if (!isIos(ua, platform, touchPoints)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|Brave|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok/i.test(ua)) return false;
  return /Safari\//.test(ua) && /Version\//.test(ua);
}
