import { BADGE_CODES, badgeCodesFor, isChallengeBadge, type BadgeCode, type ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BadgeIcon } from "../components/BadgeIcon.tsx";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, PageHeader, SectionTitle, Skeleton } from "../design/index.ts";
import { getLocale, t, type MessageKey } from "../i18n/index.ts";
import { getBadges, type EarnedBadge } from "../learner.ts";

/** Badges et jalons (spec §5.4). */

const dateOf = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" });

/**
 * Une pastille. Le médaillon lui-même ne change pas (spec §5.4) : c'est la carte autour qui porte
 * la hiérarchie — posée quand le badge est gagné, creuse et sourde tant qu'il ne l'est pas.
 */
function BadgeTile({ code, name, desc, earnedAt, stagger }: {
  code: BadgeCode | (string & {});
  name: string;
  desc: string;
  earnedAt: string | null;
  /** Rang sur la première rangée seulement : au-delà, l'entrée en cascade se lit comme une attente. */
  stagger?: number | undefined;
}) {
  const earned = earnedAt !== null;
  return (
    <Card
      as="li"
      tone={earned ? "plain" : "quiet"}
      {...(stagger === undefined ? {} : { stagger })}
      className={`flex flex-col items-center gap-2 text-center ${earned ? "" : "opacity-75"}`}
      data-earned={earned ? "true" : "false"}
      data-code={code}
    >
      <BadgeIcon code={code} earned={earned} size={88} />
      <p className={`font-semibold ${earned ? "" : "text-phu-sa"}`}>{name}</p>
      <p className="text-sm text-phu-sa">{desc}</p>
      <p className="text-sm">{earned ? t("badges.earnedOn", { date: dateOf(earnedAt) }) : t("badges.locked")}</p>
    </Card>
  );
}

export default function Badges({ content }: { content?: ContentIndex }) {
  const [earned, setEarned] = useState<EarnedBadge[] | null>(null);

  useEffect(() => {
    void getBadges().then(setEarned);
  }, []);

  const byCode = new Map((earned ?? []).map((b) => [b.code, b]));
  const codes = content ? badgeCodesFor(content.pack) : BADGE_CODES;
  // Badges de défi attribués par le serveur (contrat phase5 §3) : affichés à part.
  const challenges = (earned ?? []).filter((b) => isChallengeBadge(b.code));
  const won = codes.filter((code) => byCode.has(code));
  const toWin = codes.filter((code) => !byCode.has(code));

  return (
    <Screen top={<PageHeader title={t("badges.title")} back="/" backLabel={t("common.back")} />}>
      {earned === null ? (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} rounded="card" className="h-56" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {won.length === 0 ? (
            <EmptyState
              art="lanterns"
              title={t("badges.empty.title")}
              body={t("badges.empty.body")}
              action={
                <Link to="/" className="inline-flex min-h-11 items-center rounded-chip px-3 font-semibold text-ngoc">
                  {t("hub.daily")}
                </Link>
              }
            />
          ) : (
            <section className="flex flex-col gap-3">
              <SectionTitle
                tone="strong"
                icon="trophy"
                action={<Chip tone="ngoc">{t("badges.count", { n: won.length, total: codes.length })}</Chip>}
              >
                {t("badges.section.earned")}
              </SectionTitle>
              <ul className="grid grid-cols-2 gap-3">
                {won.map((code, i) => (
                  <BadgeTile
                    key={code}
                    code={code}
                    name={t(`badges.${code}.name` as MessageKey)}
                    desc={t(`badges.${code}.desc` as MessageKey)}
                    earnedAt={byCode.get(code)?.earnedAt ?? null}
                    {...(i < 2 ? { stagger: i } : {})}
                  />
                ))}
              </ul>
            </section>
          )}

          {toWin.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle icon="lock">{t("badges.section.locked")}</SectionTitle>
              <ul className="grid grid-cols-2 gap-3">
                {toWin.map((code) => (
                  <BadgeTile
                    key={code}
                    code={code}
                    name={t(`badges.${code}.name` as MessageKey)}
                    desc={t(`badges.${code}.desc` as MessageKey)}
                    earnedAt={null}
                  />
                ))}
              </ul>
            </section>
          )}

          {challenges.length > 0 && (
            <section className="flex flex-col gap-3" data-testid="challenge-badges">
              <SectionTitle tone="strong" icon="star">{t("badges.challenges.title")}</SectionTitle>
              <ul className="grid grid-cols-2 gap-3">
                {challenges.map((badge) => (
                  <BadgeTile
                    key={badge.code}
                    code={badge.code}
                    name={t("badges.challenge.name")}
                    desc={t("badges.challenge.desc")}
                    earnedAt={badge.earnedAt}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Screen>
  );
}
