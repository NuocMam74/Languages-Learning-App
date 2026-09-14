import { BADGE_CODES } from "@parlo/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BadgeIcon } from "../components/BadgeIcon.tsx";
import { Screen } from "../components/ui.tsx";
import { t, type MessageKey } from "../i18n/index.ts";
import { getBadges, type EarnedBadge } from "../learner.ts";

/** Badges et jalons (spec §5.4). */
export default function Badges() {
  const navigate = useNavigate();
  const [earned, setEarned] = useState<EarnedBadge[] | null>(null);

  useEffect(() => {
    void getBadges().then(setEarned);
  }, []);

  const byCode = new Map((earned ?? []).map((b) => [b.code, b]));

  return (
    <Screen
      top={
        <div className="flex items-center gap-3 pt-2">
          <button type="button" onClick={() => navigate("/")} className="grid size-11 place-items-center text-phu-sa" aria-label={t("common.back")}>
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1 className="font-serif text-2xl">{t("badges.title")}</h1>
        </div>
      }
    >
      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 pt-4">
        {BADGE_CODES.map((code) => {
          const badge = byCode.get(code);
          return (
            <li key={code} className="flex flex-col items-center gap-2 text-center" data-earned={badge ? "true" : "false"}>
              <BadgeIcon code={code} earned={badge !== undefined} size={88} />
              <p className={`font-semibold ${badge ? "" : "text-phu-sa"}`}>{t(`badges.${code}.name` as MessageKey)}</p>
              <p className="text-sm text-phu-sa">{t(`badges.${code}.desc` as MessageKey)}</p>
              <p className="text-sm">
                {badge
                  ? t("badges.earnedOn", { date: new Date(badge.earnedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) })
                  : t("badges.locked")}
              </p>
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}
