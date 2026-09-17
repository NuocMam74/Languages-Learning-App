import { BADGE_CODES, badgeCodesFor, isChallengeBadge, type ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BadgeIcon } from "../components/BadgeIcon.tsx";
import { Screen } from "../components/ui.tsx";
import { getLocale, t, type MessageKey } from "../i18n/index.ts";
import { getBadges, type EarnedBadge } from "../learner.ts";

/** Badges et jalons (spec §5.4). */
export default function Badges({ content }: { content?: ContentIndex }) {
  const navigate = useNavigate();
  const [earned, setEarned] = useState<EarnedBadge[] | null>(null);

  useEffect(() => {
    void getBadges().then(setEarned);
  }, []);

  const byCode = new Map((earned ?? []).map((b) => [b.code, b]));
  const codes = content ? badgeCodesFor(content.pack) : BADGE_CODES;
  // Badges de défi attribués par le serveur (contrat phase5 §3) : affichés à part.
  const challenges = (earned ?? []).filter((b) => isChallengeBadge(b.code));
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" });

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
        {codes.map((code) => {
          const badge = byCode.get(code);
          return (
            <li key={code} className="flex flex-col items-center gap-2 text-center" data-earned={badge ? "true" : "false"}>
              <BadgeIcon code={code} earned={badge !== undefined} size={88} />
              <p className={`font-semibold ${badge ? "" : "text-phu-sa"}`}>{t(`badges.${code}.name` as MessageKey)}</p>
              <p className="text-sm text-phu-sa">{t(`badges.${code}.desc` as MessageKey)}</p>
              <p className="text-sm">
                {badge
                  ? t("badges.earnedOn", { date: dateOf(badge.earnedAt) })
                  : t("badges.locked")}
              </p>
            </li>
          );
        })}
      </ul>
      {challenges.length > 0 && (
        <section className="mt-10 border-t border-phu-sa/10 pt-6" data-testid="challenge-badges">
          <h2 className="mb-4 font-semibold">{t("badges.challenges.title")}</h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8">
            {challenges.map((badge) => (
              <li key={badge.code} className="flex flex-col items-center gap-2 text-center" data-earned="true" data-code={badge.code}>
                <BadgeIcon code={badge.code} earned size={88} />
                <p className="font-semibold">{t("badges.challenge.name")}</p>
                <p className="text-sm text-phu-sa">{t("badges.challenge.desc")}</p>
                <p className="text-sm">{t("badges.earnedOn", { date: dateOf(badge.earnedAt) })}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  );
}
