import { badgeCodesFor, isChallengeBadge, levelForXp, levelName, SKILLS, type ContentIndex, type GameBest, type GameId, type SkillSummary } from "@parlo/core";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { BadgeIcon } from "../components/BadgeIcon.tsx";
import { LevelLine } from "../components/LevelLine.tsx";
import { Screen } from "../components/ui.tsx";
import { allPackSummaries, type PackSummary } from "../dashboard/summary.ts";
import { getLocale, l, plural, t, type MessageKey } from "../i18n/index.ts";
import { getProfile, type EarnedBadge } from "../learner.ts";
import { activePackCode } from "../packs/active.ts";
import { isOnboarded, switchPack } from "../packs/switch.ts";
import { usePackChoices } from "../packs/use-packs.ts";
import { acquired, certificateCount, earnedBadges, gameBests, languageSkills, streakView, type AcquiredCounts, type StreakView } from "./data.ts";
import { Avatar } from "./Avatar.tsx";
import { MAX_DISPLAY_NAME, readDisplayName, saveDisplayName } from "./identity.ts";

/**
 * Profil (contrat phase7 §3) : qui tu es, où tu en es, ce que tu sais faire. Entièrement lisible
 * en mode invité et hors ligne — un compte ne fait qu'ajouter la sauvegarde et la vérification.
 */
export default function ProfilePage({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const { status, account } = useAccount();
  const choices = usePackChoices(content.pack);
  const codes = choices.map((c) => c.code);
  const active = activePackCode();

  const [name, setName] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<PackSummary[] | null>(null);
  const [streak, setStreak] = useState<StreakView | null>(null);
  const [counts, setCounts] = useState<AcquiredCounts | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[] | null>(null);
  const [bests, setBests] = useState<{ game: GameId; best: GameBest }[]>([]);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [skillPack, setSkillPack] = useState(active);
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [display, packs, streakNow, allBadges, records, profile] = await Promise.all([
        readDisplayName(), allPackSummaries(codes), streakView(), earnedBadges(), gameBests(), getProfile(),
      ]);
      const acquis = await acquired(content, await certificateCount());
      if (!live) return;
      setName(display);
      setSummaries(packs);
      setStreak(streakNow);
      setBadges(allBadges);
      setBests(records);
      setCounts(acquis);
      setMemberSince(account?.linkedAt ?? profile.onboardedAt);
    })();
    return () => {
      live = false;
    };
  }, [content, codes.join(","), account?.linkedAt]);

  useEffect(() => {
    let live = true;
    void languageSkills(skillPack).then((result) => live && setSkills(result.skills));
    return () => {
      live = false;
    };
  }, [skillPack]);

  const totalXp = (summaries ?? []).reduce((sum, s) => sum + s.xp, 0);
  const level = levelForXp(totalXp);
  const tier = levelName(content.pack.levelNames, level.value);
  const longest = Math.max(streak?.longest ?? 0, streak?.current ?? 0);
  const applicable = badgeCodesFor(content.pack);
  const byCode = new Map((badges ?? []).map((b) => [b.code, b]));
  const earnedCount = applicable.filter((code) => byCode.has(code)).length;
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" });

  const openLanguage = async (code: string) => {
    if (code === active) {
      navigate("/apprendre");
      return;
    }
    await switchPack(code);
    window.location.assign((await isOnboarded(code)) ? "/apprendre" : "/onboarding");
  };

  return (
    <Screen
      top={
        <div className="flex items-center gap-3 pt-2">
          <button type="button" onClick={() => navigate("/")} className="grid size-11 shrink-0 place-items-center text-phu-sa" aria-label={t("common.back")}>
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1 className="font-serif text-2xl">{t("profile.title")}</h1>
        </div>
      }
    >
      <Identity
        name={name}
        onName={setName}
        status={status}
        email={account?.email ?? null}
        verified={account?.emailVerified}
        memberSince={memberSince ? dateOf(memberSince) : null}
      />

      <Section title={t("profile.level.title")}>
        {/* `LevelLine` affiche déjà le nom de la tranche : pas de doublon sous la barre. */}
        <div data-testid="profile-level" data-level={level.value} data-tier={tier ? l(tier) : undefined}>
          <LevelLine pack={content.pack} xp={totalXp} />
        </div>
      </Section>

      <Section title={t("profile.streak.title")}>
        <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1" data-testid="profile-streak">
          <span className="text-lg font-semibold text-son-mai">
            {streak && streak.current > 0 ? plural("profile.streak.current", "profile.streak.current.plural", streak.current) : t("profile.streak.none")}
          </span>
          <span className="text-sm text-phu-sa">{plural("profile.streak.longest", "profile.streak.longest.plural", longest)}</span>
          <span className="text-sm text-phu-sa">{plural("profile.streak.freezes", "profile.streak.freezes.plural", streak?.freezesAvailable ?? 0)}</span>
        </p>
        {streak?.frozen && streak.frozenUntil && <p className="text-sm text-phu-sa">{t("profile.streak.frozen", { date: dateOf(`${streak.frozenUntil}T12:00:00`) })}</p>}
      </Section>

      <Section title={t("profile.skills.title")}>
        {codes.length > 1 && (
          <div role="radiogroup" aria-label={t("profile.skills.language")} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {choices.map((choice) => (
              <button
                key={choice.code}
                type="button"
                role="radio"
                aria-checked={choice.code === skillPack}
                data-pack={choice.code}
                onClick={() => setSkillPack(choice.code)}
                className={`min-h-11 rounded-xl border-2 px-4 ${choice.code === skillPack ? "border-ngoc bg-ngoc-sang font-semibold" : "border-phu-sa/15 bg-white/70"}`}
              >
                {choice.name ? l(choice.name) : choice.code}
              </button>
            ))}
          </div>
        )}
        <ul className="flex flex-col gap-3" data-testid="profile-skills">
          {(skills ?? SKILLS.map((skill) => ({ skill, correct: 0, total: 0, ratio: null, level: "none" as const, lifetime: 0 }))).map((line) => (
            <SkillRow key={line.skill} line={line} />
          ))}
        </ul>
        <p className="text-sm text-phu-sa">{t("profile.skills.window")}</p>
      </Section>

      <Section title={t("profile.acquired.title")}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3" data-testid="profile-acquired">
          <Count label={t("profile.acquired.words")} value={counts?.words} testid="acquired-words" />
          <Count label={t("profile.acquired.structures")} value={counts?.structures} />
          <Count label={t("profile.acquired.lessons")} value={counts?.lessons} testid="acquired-lessons" />
          <Count label={t("profile.acquired.units")} value={counts?.units} />
          <Count label={t("profile.acquired.speaking")} value={counts?.speaking} />
          <Count label={t("profile.acquired.activeDays")} value={counts?.activeDays} />
          <Count label={t("profile.acquired.certificates")} value={counts?.certificates} />
        </dl>
        {bests.length > 0 && (
          <>
            <h3 className="pt-2 text-sm text-phu-sa">{t("profile.games.title")}</h3>
            <ul className="flex flex-col">
              {bests.map(({ game, best }) => (
                <li key={game} className="flex items-baseline justify-between border-t border-phu-sa/10 py-2 first:border-t-0">
                  <span>{t(`game.${game}` as MessageKey)}</span>
                  <span className="text-sm font-semibold">{t("profile.games.best", { correct: best.correct, total: best.total })}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex flex-wrap gap-x-6">
          <Link to="/examens" className="min-h-11 py-2 font-semibold text-ngoc">{t("profile.exams.link")}</Link>
          <Link to="/certificats" className="min-h-11 py-2 font-semibold text-ngoc">{t("cert.title")}</Link>
        </div>
      </Section>

      <Section title={`${t("profile.badges.title")} · ${t("profile.badges.count", { n: earnedCount, total: applicable.length })}`}>
        <ul className="grid grid-cols-3 gap-x-3 gap-y-6" data-testid="profile-badges">
          {applicable.map((code) => {
            const badge = byCode.get(code);
            return (
              <li key={code} className="flex flex-col items-center gap-1 text-center" data-earned={badge ? "true" : "false"} data-code={code}>
                <BadgeIcon code={code} earned={badge !== undefined} size={56} />
                <p className={`text-sm font-semibold ${badge ? "" : "text-phu-sa"}`}>{t(`badges.${code}.name` as MessageKey)}</p>
                <p className="text-sm text-phu-sa">{badge ? t("badges.earnedOn", { date: dateOf(badge.earnedAt) }) : t(`badges.${code}.desc` as MessageKey)}</p>
              </li>
            );
          })}
        </ul>
        {(badges ?? []).some((b) => isChallengeBadge(b.code)) && (
          <Link to="/badges" className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("dashboard.badges.all")}</Link>
        )}
      </Section>

      <Section title={t("profile.languages.title")}>
        <ul className="flex flex-col gap-2" data-testid="profile-languages">
          {choices.map((choice) => {
            const summary = summaries?.find((s) => s.code === choice.code) ?? null;
            return (
              <li key={choice.code}>
                <button
                  type="button"
                  onClick={() => void openLanguage(choice.code)}
                  data-pack={choice.code}
                  className="flex min-h-[4.5rem] w-full flex-col gap-0.5 rounded-2xl border-2 border-phu-sa/15 bg-white/70 px-5 py-3 text-left"
                >
                  <span className="font-serif text-lg">{choice.name ? l(choice.name) : choice.code}</span>
                  <span className="text-sm text-phu-sa">
                    {summary
                      ? `${t("dashboard.lang.lessons", { done: summary.lessonsDone, total: summary.lessonsTotal })} · ${t("dashboard.xp", { n: summary.xp })}`
                      : t("profile.loading")}
                  </span>
                  <span className="text-sm font-semibold text-ngoc">{t("profile.languages.continue")}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-phu-sa/10 py-5 first:border-t-0">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Count({ label, value, testid }: { label: string; value: number | undefined; testid?: string }) {
  return (
    <div className="flex flex-col" data-testid={testid}>
      <dt className="text-sm text-phu-sa">{label}</dt>
      {/* Hauteur réservée : le chiffre arrive d'IndexedDB sans faire grandir la grille. */}
      <dd className="text-lg font-semibold">{value ?? 0}</dd>
    </div>
  );
}

function SkillRow({ line }: { line: SkillSummary }) {
  const percent = line.ratio === null ? 0 : Math.round(line.ratio * 100);
  return (
    <li data-testid="profile-skill" data-skill={line.skill} data-level={line.level}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{t(`profile.skill.${line.skill}` as MessageKey)}</span>
        <span className="text-sm text-phu-sa">
          {line.total > 0 ? t("profile.skill.ratio", { percent, correct: line.correct, total: line.total }) : t(`profile.skill.level.${line.level}` as MessageKey)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-phu-sa/10" role="progressbar" aria-label={t(`profile.skill.${line.skill}` as MessageKey)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={`h-full rounded-full ${line.level === "fragile" ? "bg-son-mai" : line.level === "strong" ? "bg-ngoc" : "bg-nghe"}`} style={{ width: `${percent}%` }} />
      </div>
      {/* Ligne toujours présente : le verdict arrive avec l'agrégat local, il ne pousse pas la liste (CLS). */}
      <p className="mt-0.5 min-h-[1.3125rem] text-sm text-phu-sa">{line.total > 0 ? t(`profile.skill.level.${line.level}` as MessageKey) : ""}</p>
    </li>
  );
}

function Identity({ name, onName, status, email, verified, memberSince }: {
  name: string | null;
  onName: (value: string | null) => void;
  status: string;
  email: string | null;
  verified: boolean | undefined;
  memberSince: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void saveDisplayName(draft).then((saved) => {
      onName(saved || null);
      setEditing(false);
    });
  };

  const line =
    status === "guest"
      ? t("profile.account.guest")
      : status === "expired"
        ? t("profile.account.expired")
        : verified === false
          ? t("profile.account.unverified")
          : t("profile.account.signedIn", { email: email ?? "" });

  return (
    <section className="flex flex-col gap-3 pb-5" data-testid="profile-identity">
      <div className="flex items-center gap-4">
        <span data-testid="profile-avatar">
          <Avatar name={name} size="lg" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-serif text-2xl" data-testid="profile-name">{name ?? t("dashboard.guest")}</p>
          <p className="truncate text-sm text-phu-sa">{line}</p>
        </div>
      </div>
      {/* Ligne toujours présente, sur toute la largeur : elle arrive d'IndexedDB et ne pousse rien (CLS). */}
      <p className="min-h-[1.3125rem] text-sm text-phu-sa">{memberSince ? t("profile.memberSince", { date: memberSince }) : ""}</p>

      {editing ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm text-phu-sa">{t("profile.name.label")}</span>
            <input
              autoFocus
              value={draft}
              maxLength={MAX_DISPLAY_NAME}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("profile.name.placeholder")}
              className="min-h-12 rounded-xl border-2 border-phu-sa/20 bg-white px-4 text-lg"
            />
          </label>
          <button type="submit" className="min-h-12 rounded-xl bg-ngoc px-4 font-semibold text-nuoc" data-testid="profile-name-save">{t("profile.name.save")}</button>
        </form>
      ) : (
        <button
          type="button"
          data-testid="profile-name-edit"
          className="min-h-11 self-start font-semibold text-ngoc"
          onClick={() => {
            setDraft(name ?? "");
            setEditing(true);
          }}
        >
          {t("profile.name.edit")}
        </button>
      )}

      {status === "guest" && (
        <div className="flex flex-col gap-1 border-l-4 border-nghe pl-3">
          <p className="text-sm text-phu-sa">{t("profile.guestHint")}</p>
          <Link to="/compte" className="min-h-11 self-start py-2 font-semibold text-ngoc" data-testid="profile-account-cta">{t("profile.guestCta")}</Link>
        </div>
      )}
    </section>
  );
}

