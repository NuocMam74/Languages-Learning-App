import { useNavigate } from "react-router";
import { t } from "../i18n/index.ts";

/** En-tête d'écran secondaire : retour + titre. */
export function BackHeader({ title, to = "/" }: { title: string; to?: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3 pt-2">
      <button type="button" onClick={() => navigate(to)} className="grid size-11 shrink-0 place-items-center text-phu-sa" aria-label={t("common.back")}>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1 className="font-serif text-2xl">{title}</h1>
    </div>
  );
}
