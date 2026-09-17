import { useEffect, useState } from "react";
import { Icon } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import { installPrompt, isIos, isIosSafari, isStandalone, onInstallPrompt, type BeforeInstallPromptEvent } from "../pwa/install.ts";

/**
 * Aide à l'installation selon la plateforme (spec §8.1) :
 *  - Android / Chromium : bouton « Installer » (beforeinstallprompt capturé au démarrage) ;
 *  - Safari iOS : Partager › « Sur l'écran d'accueil » ;
 *  - autre navigateur iOS (Chrome, Firefox, app intégrée) : ouvrir la page dans Safari.
 */

const DISMISS_KEY = "parlo.installHint.dismissed";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(installPrompt);
  const [dismissed, setDismissed] = useState(() => isStandalone() || wasDismissed());

  useEffect(() => {
    // Invite arrivée entre la capture globale et le montage, ou pas de capture (page de démo, tests).
    setDeferred(installPrompt());
    const stop = onInstallPrompt(setDeferred);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      stop();
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  const ios = isIos();
  if (dismissed || (!deferred && !ios)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Stockage indisponible : l'aide disparaît pour cette visite seulement.
    }
    setDismissed(true);
  };

  const body = deferred ? t("install.android") : isIosSafari() ? t("install.ios") : t("mobile.install.iosOther");
  return (
    <aside className="flex flex-col gap-3 rounded-card border border-nghe/30 bg-surface-nghe px-4 py-4" data-testid="install-hint" data-variant={deferred ? "prompt" : isIosSafari() ? "ios-safari" : "ios-other"}>
      <p className="flex items-center gap-2 font-semibold"><Icon name="download" size={18} className="text-nghe" />{t("install.title")}</p>
      <p className="text-sm text-phu-sa">{body}</p>
      <div className="flex gap-4">
        {deferred && (
          <button type="button" className="min-h-11 rounded-chip bg-ngoc px-4 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98]" onClick={() => void deferred.prompt().then(dismiss)}>
            {t("install.cta")}
          </button>
        )}
        <button type="button" className="min-h-11 min-w-11 px-1 text-ngoc" onClick={dismiss}>
          {t("install.later")}
        </button>
      </div>
    </aside>
  );
}
