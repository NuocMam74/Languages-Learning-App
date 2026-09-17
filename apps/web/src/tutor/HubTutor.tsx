import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
import { Slot } from "../components/Slot.tsx";
import { Icon } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import { cachedDebrief } from "./debrief.ts";
import { useTutorStatus } from "./status.ts";

/**
 * Entrées Cô Mai du hub : parler avec elle, et le bilan de la semaine
 * (le lundi, ou dès qu'un bilan de la semaine est disponible localement).
 *
 * Deux rangées posées sur une surface, pas deux liens nus : l'accueil reste une page de surfaces.
 * Aucune animation d'entrée ici — l'emplacement réservé (`Slot`) mesure la hauteur réelle.
 */
export function HubTutor({ now = new Date() }: { now?: Date }) {
  const status = useAccount((s) => s.status);
  const tutorAvailable = useTutorStatus((s) => s.available);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    void cachedDebrief(now).then((d) => setAvailable(d !== null)).catch(() => undefined);
  }, []);

  const showDebrief = status === "signed_in" && (now.getDay() === 1 || available);
  return (
    <div className="flex flex-col pb-5" data-testid="hub-tutor">
      {tutorAvailable === false ? (
        // Sans modèle ou sans persona : conversation annoncée, pas une page qui échoue (contrat phase5 §5).
        <p className="flex min-h-12 items-center gap-3 rounded-card border border-line bg-surface-2 px-4 py-2 text-phu-sa" data-testid="hub-tutor-soon">
          <Icon name="tutor" size={20} />
          {t("journey.tutor.talkSoon")}
        </p>
      ) : (
        <Link
          to="/co-mai"
          className="flex min-h-12 items-center gap-3 rounded-card border border-ngoc/25 bg-surface px-4 py-2 font-semibold text-ngoc shadow-card transition-[background-color,transform] hover:bg-ngoc-sang/40 motion-safe:active:scale-[.99]"
        >
          <Icon name="tutor" size={20} />
          <span className="min-w-0 flex-1">{t("tutor.hub.talk")}</span>
          <Icon name="chevronRight" size={18} className="opacity-60" />
        </Link>
      )}
      {/* Bilan : connu après lecture locale ; emplacement réservé (pas de saut du hub). */}
      <Slot id={`hub-debrief-${status}`}>
        {showDebrief && (
          <Link
            to="/bilan-semaine"
            className="mt-3 flex items-center gap-3 rounded-card border border-nghe/30 bg-surface-nghe px-4 py-2.5"
            data-testid="hub-debrief"
          >
            <Icon name="notebook" size={20} className="text-nghe" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{t("tutor.hub.debrief")}</span>
              <span className="text-sm text-phu-sa">{t("tutor.hub.debriefHint")}</span>
            </span>
            <Icon name="chevronRight" size={18} className="text-phu-sa opacity-60" />
          </Link>
        )}
      </Slot>
    </div>
  );
}
