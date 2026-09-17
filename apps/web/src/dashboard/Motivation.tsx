import { badgeCodesFor, isChallengeBadge, isExamUnlocked, type ContentIndex, type Pack } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BadgeIcon } from "../components/BadgeIcon.tsx";
import { Icon } from "../design/index.ts";
import { doneLessons, loadExams, splitCertificateName } from "../exams/exam-files.ts";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { getBadges, type EarnedBadge } from "../learner.ts";

/**
 * Blocs « motivation » de l'accueil (contrat phase7 §2.4) : derniers badges obtenus et prochain
 * certificat accessible. Les deux se lisent hors ligne (IndexedDB + core.json) et disparaissent
 * quand ils sont vides — jamais une carte creuse pour meubler.
 */

const RECENT_BADGES = 3;

export function DashboardBadges({ pack }: { pack: Pack }) {
  const [earned, setEarned] = useState<EarnedBadge[] | null>(null);

  useEffect(() => {
    let live = true;
    void getBadges().then((all) => live && setEarned(all));
    return () => {
      live = false;
    };
  }, [pack.code]);

  if (earned === null) return null;
  const applicable = new Set<string>(badgeCodesFor(pack));
  const mine = earned
    .filter((b) => applicable.has(b.code) || isChallengeBadge(b.code))
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt))
    .slice(0, RECENT_BADGES);
  if (mine.length === 0) return null;

  return (
    <section className="flex items-center justify-between gap-4 py-2" data-testid="dashboard-badges">
      <span className="flex items-center gap-3">
        {mine.map((badge) => (
          <span key={badge.code} className="flex flex-col items-center" title={isChallengeBadge(badge.code) ? t("badges.challenge.name") : t(`badges.${badge.code}.name` as MessageKey)}>
            <BadgeIcon code={badge.code} earned size={40} />
          </span>
        ))}
        <span className="text-sm text-phu-sa">{t("dashboard.badges.recent")}</span>
      </span>
      <Link to="/badges" className="flex min-h-11 shrink-0 items-center gap-1 font-semibold text-ngoc">
        {t("dashboard.badges.all")}
      </Link>
    </section>
  );
}

/** Prochain certificat à portée : seulement quand l'examen est vraiment ouvert. */
export function DashboardCertificate({ content }: { content: ContentIndex }) {
  const [next, setNext] = useState<{ level: string; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [exams, done] = await Promise.all([loadExams(content.pack.code), doneLessons(content)]);
        const open = exams.find((exam) => isExamUnlocked(content.curriculum, exam, done, content.lessons));
        if (!live || !open) return;
        const { name } = splitCertificateName(l(open.certificate), open.level);
        setNext({ level: open.level, name: `${open.level} ${name}`.trim() });
      } catch {
        // Contenu d'examen indisponible hors ligne : la carte reste absente.
      }
    })();
    return () => {
      live = false;
    };
  }, [content]);

  if (!next) return null;
  return (
    <Link
      to="/examens"
      className="flex min-h-12 items-center gap-3 rounded-card border border-nghe/30 bg-surface-nghe px-4 py-2 transition-transform motion-safe:active:scale-[.99]"
      data-testid="dashboard-certificate"
    >
      <Icon name="diploma" size={22} className="text-nghe" />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-phu-sa">{t("dashboard.certificate.title")}</span>
        <span className="font-semibold text-ngoc">{t("dashboard.certificate.ready", { name: next.name })}</span>
      </span>
    </Link>
  );
}
