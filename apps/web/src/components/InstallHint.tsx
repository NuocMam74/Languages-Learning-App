import { useEffect, useState } from "react";
import { t } from "../i18n.ts";

/** Aide à l'installation selon la plateforme (spec §8.1). */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const DISMISS_KEY = "parlo.installHint.dismissed";

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => isStandalone() || localStorage.getItem(DISMISS_KEY) === "1");

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || (!deferred && !isIos())) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <aside className="flex flex-col gap-3 border-l-4 border-nghe py-1 pl-4">
      <p className="font-semibold">{t("install.title")}</p>
      <p className="text-sm text-phu-sa">{isIos() ? t("install.ios") : t("install.android")}</p>
      <div className="flex gap-4">
        {deferred && (
          <button type="button" className="min-h-11 rounded-xl bg-ngoc px-4 font-semibold text-nuoc" onClick={() => void deferred.prompt().then(dismiss)}>
            {t("install.cta")}
          </button>
        )}
        <button type="button" className="min-h-11 text-ngoc" onClick={dismiss}>
          {t("install.later")}
        </button>
      </div>
    </aside>
  );
}
