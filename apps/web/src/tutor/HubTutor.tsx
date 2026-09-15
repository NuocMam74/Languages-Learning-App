import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAccount } from "../account.ts";
import { t } from "../i18n/index.ts";
import { cachedDebrief } from "./debrief.ts";
import { useTutorStatus } from "./status.ts";

/**
 * Entrées Cô Mai du hub : parler avec elle, et le bilan de la semaine
 * (le lundi, ou dès qu'un bilan de la semaine est disponible localement).
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
    <div className="flex flex-col gap-3 pb-5" data-testid="hub-tutor">
      {tutorAvailable === false ? (
        // Sans modèle ou sans persona : conversation annoncée, pas une page qui échoue (contrat phase5 §5).
        <p className="flex min-h-12 items-center rounded-2xl border-2 border-phu-sa/15 px-4 py-2 text-phu-sa" data-testid="hub-tutor-soon">
          {t("journey.tutor.talkSoon")}
        </p>
      ) : (
        <Link to="/co-mai" className="flex min-h-12 items-center justify-between rounded-2xl border-2 border-ngoc/25 px-4 py-2 font-semibold text-ngoc">
          {t("tutor.hub.talk")}
        </Link>
      )}
      {showDebrief && (
        <Link to="/bilan-semaine" className="flex flex-col border-l-4 border-nghe py-1 pl-3" data-testid="hub-debrief">
          <span className="font-semibold">{t("tutor.hub.debrief")}</span>
          <span className="text-sm text-phu-sa">{t("tutor.hub.debriefHint")}</span>
        </Link>
      )}
    </div>
  );
}
