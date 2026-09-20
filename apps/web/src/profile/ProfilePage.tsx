import { badgeCodesFor, isChallengeBadge, levelForXp, levelName, MARK_MAX, SKILLS, type ContentIndex, type GameBest, type GameId, type SkillSummary, type ThemeMark } from "@parlo/core";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { useApiStatus } from "../api-status.ts";
import { BadgeIcon } from "../components/BadgeIcon.tsx";
import { Screen } from "../components/ui.tsx";
import { allPackSummaries, type PackSummary } from "../dashboard/summary.ts";
import { Card, Chip, Icon, Illustration, Lanterns, PageHeader, ProgressBar, ProgressRing, SectionTitle, Skeleton, staggerStyle, Stat, type IconName } from "../design/index.ts";
import { getLocale, l, plural, t, type MessageKey } from "../i18n/index.ts";
import { getProfile, type EarnedBadge } from "../learner.ts";
import { activePackCode } from "../packs/active.ts";
import { isOnboarded, switchPack } from "../packs/switch.ts";
import { usePackChoices } from "../packs/use-packs.ts";
import { acquired, certificateCount, earnedBadges, gameBests, languageSkills, streakView, type AcquiredCounts, type StreakView } from "./data.ts";
import { packMarks, type MarksView } from "./marks.ts";
import { RewardsBlock } from "../rewards/RewardsBlock.tsx";
import { Avatar } from "./Avatar.tsx";
import { MAX_DISPLAY_NAME, readDisplayName, saveDisplayName } from "./identity.ts";

/**
 * Profil (contrat phase7 §3) : qui tu es, où tu en es, ce que tu sais faire. Entièrement lisible
 * en mode invité et hors ligne — un compte ne fait qu'ajouter la sauvegarde et la vérification.
 *
 * Mise en page (contrat phase8 §1) : une **étagère à trophées**, pas un formulaire. Une carte
 * héroïque porte l'identité, l'anneau de niveau et les quatre chiffres qui comptent ; les sections
 * suivantes entrent en cascade (≤ 6 × 40 ms). Toutes les hauteurs qui attendent IndexedDB sont
 * réservées d'avance : le profil est mesuré à CLS ≤ 0,05.
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
  const [marks, setMarks] = useState<MarksView | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [display, packs, streakNow, allBadges, records, profile] = await Promise.all([
        readDisplayName(), allPackSummaries(codes), streakView(), earnedBadges(), gameBests(), getProfile(),
      ]);
      const acquis = await acquired(content, await certificateCount());
      const bulletin = await packMarks(content);
      if (!live) return;
      setMarks(bulletin);
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
    <Screen top={<PageHeader title={t("profile.title")} back="/" backLabel={t("common.back")} />}>
      <Identity
        name={name}
        onName={setName}
        status={status}
        email={account?.email ?? null}
        verified={account?.emailVerified}
        memberSince={memberSince ? dateOf(memberSince) : null}
        level={level}
        tier={tier ? l(tier) : null}
        xp={totalXp}
        streak={streak?.current ?? 0}
        counts={counts}
        loading={summaries === null}
      />

      {/* Récompenses (contrat phase9) : ce qu'on a gagné, ce qu'il reste à réclamer, et l'atelier. */}
      <Block index={1} id="profile-rewards-title" icon="trophy" title={t("rewards.title")}>
        <RewardsBlock pack={content.pack} />
      </Block>

      <Block index={2} id="profile-streak-title" icon="flame" title={t("profile.streak.title")}>
        {/* Les lanternes vivent ici : la série est la seule chose de l'écran qui se gagne jour après jour. */}
        <Card tone="notice" className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="flex flex-col gap-0.5" data-testid="profile-streak">
              <span className="font-serif text-lg text-son-mai">
                {streak && streak.current > 0 ? plural("profile.streak.current", "profile.streak.current.plural", streak.current) : t("profile.streak.none")}
              </span>
              <span className="text-sm text-phu-sa">{plural("profile.streak.longest", "profile.streak.longest.plural", longest)}</span>
              <span className="text-sm text-phu-sa">{plural("profile.streak.freezes", "profile.streak.freezes.plural", streak?.freezesAvailable ?? 0)}</span>
            </p>
            {/* Ligne toujours présente : le gel arrive avec la lecture locale et ne pousse rien (CLS). */}
            <p className="min-h-[1.3125rem] text-sm text-phu-sa">
              {streak?.frozen && streak.frozenUntil ? t("profile.streak.frozen", { date: dateOf(`${streak.frozenUntil}T12:00:00`) }) : ""}
            </p>
          </div>
          <Illustration className="max-w-[6.5rem]">
            <Lanterns />
          </Illustration>
        </Card>
      </Block>

      {/* Bulletin (contrat phase21 §4) : la moyenne, puis les thèmes — c'est l'écran qui répond à
          « sur quoi je bute ? ». Il vient avant les compétences : le thème dit quoi refaire
          (« les chiffres »), la compétence dit comment on apprend (« l'oreille »). */}
      <Block index={3} id="profile-marks-title" icon="chart" title={t("profile.marks.title")}>
        <MarksBlock marks={marks} />
      </Block>

      <Block index={4} id="profile-skills-title" icon="chart" title={t("profile.skills.title")}>
        <Card className="flex flex-col gap-4">
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
                  className={`min-h-11 rounded-field border px-4 transition-[background-color,border-color,transform] motion-safe:active:scale-[.98] ${
                    choice.code === skillPack ? "border-ngoc bg-ngoc-sang font-semibold text-ngoc" : "border-line-strong bg-surface-2 text-phu-sa"
                  }`}
                >
                  {choice.name ? l(choice.name) : choice.code}
                </button>
              ))}
            </div>
          )}
          <ul className="flex flex-col gap-3.5" data-testid="profile-skills">
            {(skills ?? SKILLS.map((skill) => ({ skill, correct: 0, total: 0, ratio: null, level: "none" as const, lifetime: 0 }))).map((line) => (
              <SkillRow key={line.skill} line={line} />
            ))}
          </ul>
          <p className="text-sm text-phu-sa">{t("profile.skills.window")}</p>
        </Card>
      </Block>

      <Block index={5} id="profile-acquired-title" icon="target" title={t("profile.acquired.title")}>
        <Card className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3" data-testid="profile-acquired">
            <Count label={t("profile.acquired.structures")} value={counts?.structures} />
            <Count label={t("profile.acquired.units")} value={counts?.units} />
            <Count label={t("profile.acquired.speaking")} value={counts?.speaking} />
            <Count label={t("profile.acquired.activeDays")} value={counts?.activeDays} />
            <Count label={t("profile.acquired.certificates")} value={counts?.certificates} />
          </dl>
          {bests.length > 0 && (
            <div className="flex flex-col">
              <h3 className="pb-1 text-sm font-semibold text-phu-sa">{t("profile.games.title")}</h3>
              <ul className="flex flex-col">
                {bests.map(({ game, best }) => (
                  <li key={game} className="flex items-baseline justify-between gap-3 border-t border-line py-2 first:border-t-0">
                    <span>{t(`game.${game}` as MessageKey)}</span>
                    <span className="text-sm font-semibold tabular-nums">{t("profile.games.best", { correct: best.correct, total: best.total })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col">
            <RowLink to="/examens" icon="diploma">{t("profile.exams.link")}</RowLink>
            <RowLink to="/certificats" icon="trophy">{t("cert.title")}</RowLink>
          </div>
        </Card>
      </Block>

      <Block
        index={6}
        id="profile-badges-title"
        icon="star"
        title={t("profile.badges.title")}
        action={<Chip tone="ngoc">{t("profile.badges.count", { n: earnedCount, total: applicable.length })}</Chip>}
      >
        <Card className="flex flex-col gap-4">
          <ul className="grid grid-cols-3 gap-2" data-testid="profile-badges">
            {applicable.map((code) => {
              const badge = byCode.get(code);
              return (
                <li
                  key={code}
                  // L'obtenu se pose sur une surface, le reste flotte : la différence se voit d'un coup d'œil.
                  className={`flex flex-col items-center gap-1 rounded-card px-2 py-3 text-center ${badge ? "bg-surface-nghe" : "opacity-70"}`}
                  data-earned={badge ? "true" : "false"}
                  data-code={code}
                >
                  <BadgeIcon code={code} earned={badge !== undefined} size={56} />
                  <p className={`text-sm font-semibold ${badge ? "" : "text-phu-sa"}`}>{t(`badges.${code}.name` as MessageKey)}</p>
                  <p className="text-sm text-phu-sa">{badge ? t("badges.earnedOn", { date: dateOf(badge.earnedAt) }) : t(`badges.${code}.desc` as MessageKey)}</p>
                </li>
              );
            })}
          </ul>
          {(badges ?? []).some((b) => isChallengeBadge(b.code)) && <RowLink to="/badges" icon="chevronRight">{t("dashboard.badges.all")}</RowLink>}
        </Card>
      </Block>

      <Block index={7} id="profile-languages-title" icon="globe" title={t("profile.languages.title")}>
        <ul className="flex flex-col gap-2" data-testid="profile-languages">
          {choices.map((choice) => {
            const summary = summaries?.find((s) => s.code === choice.code) ?? null;
            return (
              <li key={choice.code}>
                <button
                  type="button"
                  onClick={() => void openLanguage(choice.code)}
                  data-pack={choice.code}
                  className={`flex min-h-[4.5rem] w-full items-center gap-3 rounded-card border px-5 py-3 text-left transition-[background-color,border-color,transform] motion-safe:active:scale-[.99] ${
                    choice.code === active ? "border-ngoc/30 bg-surface shadow-card" : "border-line bg-surface"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-serif text-lg">{choice.name ? l(choice.name) : choice.code}</span>
                    {summary ? (
                      <span className="truncate text-sm text-phu-sa">
                        {t("dashboard.lang.lessons", { done: summary.lessonsDone, total: summary.lessonsTotal })} · {t("dashboard.xp", { n: summary.xp })}
                      </span>
                    ) : (
                      // Hauteur de la ligne réservée : les compteurs arrivent d'IndexedDB (CLS).
                      <span className="flex h-[1.3125rem] items-center" aria-label={t("profile.loading")}>
                        <Skeleton className="h-3 w-40" />
                      </span>
                    )}
                    <span className="text-sm font-semibold text-ngoc">{t("profile.languages.continue")}</span>
                  </span>
                  <Icon name="chevronRight" size={20} className="text-phu-sa" />
                </button>
              </li>
            );
          })}
        </ul>
      </Block>
    </Screen>
  );
}

/** Section du profil : un titre serif à icône, puis son contenu, entrée en cascade (≤ 6 × 40 ms). */
function Block({ title, icon, id, index, action, children }: { title: string; icon: IconName; id: string; index: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="pb-5 motion-safe:parlo-enter" style={staggerStyle(index)}>
      <SectionTitle id={id} tone="strong" icon={icon} action={action} className="pb-2">
        {title}
      </SectionTitle>
      {children}
    </section>
  );
}

/** Lien de rangée : pleine largeur, 48 px, chevron à droite — le même geste partout. */
function RowLink({ to, icon, children }: { to: string; icon: IconName; children: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-12 items-center gap-3 border-t border-line font-semibold text-ngoc first:border-t-0">
      <Icon name={icon} size={20} />
      <span className="min-w-0 flex-1">{children}</span>
      <Icon name="chevronRight" size={18} className="text-phu-sa" />
    </Link>
  );
}

function Count({ label, value, testid }: { label: string; value: number | undefined; testid?: string }) {
  return (
    <div className="flex flex-col" data-testid={testid}>
      <dt className="text-sm text-phu-sa">{label}</dt>
      {/* Hauteur réservée : le chiffre arrive d'IndexedDB sans faire grandir la grille. */}
      <dd className="text-lg font-semibold tabular-nums">{value ?? 0}</dd>
    </div>
  );
}

function MarksBlock({ marks }: { marks: MarksView | null }) {
  const started = marks?.themes.filter((theme) => theme.mark !== null) ?? [];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4" data-testid="profile-overall-mark" data-mark={marks?.overall.mark ?? ""}>
        <span className="font-medium">{t("profile.marks.overall")}</span>
        {/* Hauteur réservée : la moyenne arrive d'IndexedDB et ne doit pousser personne (CLS). */}
        <span className="flex min-h-[2.75rem] flex-col items-end justify-center">
          {marks === null || marks.overall.mark === null ? (
            <span className="text-sm text-phu-sa">{marks === null ? "" : t("profile.marks.empty")}</span>
          ) : (
            <>
              <span className="text-vi font-semibold tabular-nums">{t("profile.marks.value", { mark: marks.overall.mark, max: MARK_MAX })}</span>
              <span className="text-sm text-phu-sa">
                {plural("profile.marks.overall.on", "profile.marks.overall.on.plural", marks.overall.levels)}
              </span>
            </>
          )}
        </span>
      </div>

      {/* Les thèmes qui résistent, nommés, avec le niveau exact à refaire : sans ce lien, le
          diagnostic laisse l'apprenant devant une liste et rien à faire. Le lien mène au niveau
          **normal**, pas à l'entraînement — seul le premier enregistre une nouvelle note. */}
      {(marks?.weak.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2 rounded-card bg-surface-nghe p-3" data-testid="profile-weak-themes">
          <h3 className="font-semibold">{t("profile.marks.weak.title")}</h3>
          <ul className="flex flex-col">
            {marks?.weak.map((theme) => (
              <li key={theme.unit} data-unit={theme.unit}>
                {theme.weakest && (
                  <Link
                    to={`/lecon/${encodeURIComponent(theme.weakest.lessonId)}`}
                    className="flex min-h-11 items-center justify-between gap-3 font-semibold text-ngoc"
                  >
                    <span className="min-w-0 truncate">{t("profile.marks.weak.redo", { title: l(theme.weakest.title) })}</span>
                    <span className="tabular-nums">{t("profile.marks.value", { mark: theme.weakest.mark, max: MARK_MAX })}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="flex flex-col gap-3.5" data-testid="profile-themes">
        {started.map((theme) => (
          <ThemeRow key={theme.unit} theme={theme} />
        ))}
      </ul>
      <p className="text-sm text-phu-sa">{t("profile.marks.note")}</p>
    </Card>
  );
}

function ThemeRow({ theme }: { theme: ThemeMark }) {
  const mark = theme.mark ?? 0;
  const tone = theme.level === "fragile" ? "son-mai" : theme.level === "strong" ? "ngoc" : "nghe";
  return (
    <li data-testid="profile-theme" data-unit={theme.unit} data-level={theme.level ?? "none"}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{l(theme.title)}</span>
        <span className="text-sm text-phu-sa tabular-nums">{t("profile.marks.value", { mark, max: MARK_MAX })}</span>
      </div>
      <ProgressBar value={mark} max={MARK_MAX} size="sm" tone={tone} label={l(theme.title)} />
      <p className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-sm text-phu-sa">
        <span>{theme.level ? t(`profile.marks.level.${theme.level}` as MessageKey) : t("profile.marks.untouched")}</span>
        <span>{t(theme.done > 1 ? "profile.marks.progress.plural" : "profile.marks.progress", { n: theme.done, total: theme.total })}</span>
      </p>
    </li>
  );
}

function SkillRow({ line }: { line: SkillSummary }) {
  const percent = line.ratio === null ? 0 : Math.round(line.ratio * 100);
  const tone = line.level === "fragile" ? "son-mai" : line.level === "strong" || line.level === "solid" ? "ngoc" : "nghe";
  return (
    <li data-testid="profile-skill" data-skill={line.skill} data-level={line.level}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{t(`profile.skill.${line.skill}` as MessageKey)}</span>
        <span className="text-sm text-phu-sa tabular-nums">
          {line.total > 0 ? t("profile.skill.ratio", { percent, correct: line.correct, total: line.total }) : t(`profile.skill.level.${line.level}` as MessageKey)}
        </span>
      </div>
      <ProgressBar value={percent} max={100} size="sm" tone={tone} label={t(`profile.skill.${line.skill}` as MessageKey)} />
      {/* Ligne toujours présente : le verdict arrive avec l'agrégat local, il ne pousse pas la liste (CLS). */}
      <p className="mt-0.5 min-h-[1.3125rem] text-sm text-phu-sa">{line.total > 0 ? t(`profile.skill.level.${line.level}` as MessageKey) : ""}</p>
    </li>
  );
}

function Identity({ name, onName, status, email, verified, memberSince, level, tier, xp, streak, counts, loading }: {
  name: string | null;
  onName: (value: string | null) => void;
  status: string;
  email: string | null;
  verified: boolean | undefined;
  memberSince: string | null;
  level: { value: number; xpIntoLevel: number; xpForNext: number };
  tier: string | null;
  xp: number;
  streak: number;
  counts: AcquiredCounts | null;
  loading: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Sans API, « crée un compte » mène à un mur : on renvoie vers « Changer d'appareil ».
  const accounts = useApiStatus((s) => s.accountsPossible)();

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
    <>
      <Card tone="raised" as="section" stagger={0} className="mb-5 flex flex-col gap-5" data-testid="profile-identity">
        <div className="flex items-center gap-4">
          <span data-testid="profile-avatar">
            <Avatar name={name} size="lg" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-2xl" data-testid="profile-name">{name ?? t("dashboard.guest")}</p>
            {/* Deux lignes réservées : l'état du compte passe de « en cours » à invité/connecté sans pousser (CLS). */}
            <p className="min-h-[2.625rem] text-sm text-phu-sa">{line}</p>
          </div>
          {!editing && (
            <button
              type="button"
              data-testid="profile-name-edit"
              aria-label={t("profile.name.edit")}
              title={t("profile.name.edit")}
              onClick={() => {
                setDraft(name ?? "");
                setEditing(true);
              }}
              className="grid size-11 shrink-0 place-items-center rounded-full text-phu-sa transition-[background-color,transform] hover:bg-phu-sa/8 motion-safe:active:scale-[.98]"
            >
              <Icon name="pencil" size={20} />
            </button>
          )}
        </div>

        {/* Ligne toujours présente : elle arrive d'IndexedDB et ne pousse rien (CLS). */}
        <p className="-mt-3 min-h-[1.3125rem] text-sm text-phu-sa">{memberSince ? t("profile.memberSince", { date: memberSince }) : ""}</p>

        {editing && (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm text-phu-sa">{t("profile.name.label")}</span>
              <input
                autoFocus
                value={draft}
                maxLength={MAX_DISPLAY_NAME}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("profile.name.placeholder")}
                className="min-h-12 rounded-field border border-line-strong bg-surface px-4 text-lg focus:border-ngoc focus:outline-none"
              />
            </label>
            <button type="submit" className="min-h-12 rounded-field bg-ngoc px-5 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98]" data-testid="profile-name-save">
              {t("profile.name.save")}
            </button>
          </form>
        )}

        {/* L'anneau est le seul moment héroïque de l'écran : il se remplit une fois, à l'arrivée de l'XP. */}
        <div className="flex items-center gap-4" data-testid="profile-level" data-level={level.value} data-tier={tier ?? undefined}>
          <ProgressRing
            value={level.xpForNext > 0 ? level.xpIntoLevel : 1}
            max={Math.max(1, level.xpForNext)}
            size={76}
            tone="nghe"
            label={t("journey.level.label", { n: level.value })}
          >
            <span className="font-serif text-2xl leading-none tabular-nums">{level.value}</span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-lg">{tier ?? t("journey.level.label", { n: level.value })}</p>
            <p className="text-sm text-phu-sa">
              {level.xpForNext > 0 ? t("journey.level.progress", { done: level.xpIntoLevel, total: level.xpForNext, next: level.value + 1 }) : t("journey.level.max")}
            </p>
          </div>
        </div>

        {/* Les quatre chiffres de l'étagère. Hauteur fixe : ils arrivent après le premier rendu (CLS). */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
          <Stat tone="ngoc" icon="star" value={loading ? <Skeleton className="inline-block h-4 w-10 align-middle" /> : xp} label={t("profile.stat.xp")} />
          <Stat tone="son-mai" icon="flame" value={streak} label={t("profile.streak.title")} />
          <Stat icon="cards" value={counts?.words ?? 0} label={t("profile.acquired.words")} data-testid="acquired-words" />
          <Stat icon="book" value={counts?.lessons ?? 0} label={t("profile.acquired.lessons")} data-testid="acquired-lessons" />
        </div>
      </Card>

      {status === "guest" && (
        <Card tone="notice" className="mb-5 flex items-start gap-3">
          <Icon name="info" size={20} className="mt-0.5 shrink-0 text-nghe" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">{t(accounts ? "profile.guestHint" : "account.offer.noServer")}</p>
            <Link
              to={accounts ? "/compte" : "/reglages/appareil"}
              className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc"
              data-testid="profile-account-cta"
            >
              {t(accounts ? "profile.guestCta" : "transfer.title")}
              <Icon name="chevronRight" size={18} />
            </Link>
          </div>
        </Card>
      )}
    </>
  );
}
