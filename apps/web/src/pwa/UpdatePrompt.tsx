import { useEffect, useState } from "react";
import { t } from "../i18n/index.ts";
import { canReloadNow, usePwaUpdate } from "./update.ts";

/**
 * « Nouvelle version disponible — Mettre à jour ». Masqué pendant une séance, un examen, un jeu ou une
 * conversation : proposé au bilan ou au hub, jamais de rechargement au milieu d'un exercice.
 */
export function UpdatePrompt() {
  const needRefresh = usePwaUpdate((s) => s.needRefresh);
  const apply = usePwaUpdate((s) => s.apply);
  // Séance en cours = écran d'exercice monté (le bilan ne l'est pas) ; lu dans le DOM pour ne pas
  // tirer le moteur de séance dans le bundle initial.
  const read = () => ({ path: window.location.pathname, inSession: document.querySelector('[data-testid="lesson"]') !== null });
  const [where, setWhere] = useState(read);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);

  // Navigation SPA (pushState) sans événement : relue chaque seconde tant qu'une version attend.
  useEffect(() => {
    if (!needRefresh) return;
    setWhere(read());
    const id = window.setInterval(() => setWhere(read()), 1000);
    return () => window.clearInterval(id);
  }, [needRefresh]);

  if (!needRefresh || later || !apply || !canReloadNow(where.path, where.inSession)) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto flex max-w-[480px] justify-center pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:max-w-[720px]">
      <div
        role="status"
        data-testid="update-prompt"
        className="pointer-events-auto flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-muc py-1.5 pr-2 pl-4 text-nuoc shadow-[0_8px_30px_rgb(20_32_30/0.25)] motion-safe:animate-[rise_300ms_ease-out]"
      >
        <p className="min-w-0 flex-1 font-semibold">{t("mobile.update.available")}</p>
        <div className="flex items-center gap-1">
          <button type="button" className="min-h-11 rounded-xl px-3 text-nuoc/85" onClick={() => setLater(true)}>
            {t("mobile.update.later")}
          </button>
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-xl bg-nghe px-4 font-semibold text-muc"
            onClick={() => {
              setBusy(true);
              void apply().catch(() => window.location.reload());
            }}
          >
            {t("mobile.update.cta")}
          </button>
        </div>
      </div>
    </div>
  );
}
