import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useAccount } from "../account.ts";
import { useAccountsPossible } from "../api-status.ts";
import { ApiError } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { Card, Chip, EmptyState, FloatingMarket, Icon, Illustration, PageHeader, ProgressBar, SectionTitle, Skeleton } from "../design/index.ts";
import { getLocale, t } from "../i18n/index.ts";
import { useOnline } from "../use-online.ts";
import { createFriendChallenge, getFriendChallenges, joinFriendChallenge, type FriendChallengeCreated, type FriendChallengeDto, type FriendParticipant } from "./social-api.ts";

/**
 * Défis entre amis (spec §5.2, contrat phase3 §3) : défi de 7 jours sur l'XP,
 * lien d'invitation, comparaison des participant·es. Pas de chat (§14) : prénoms seulement.
 */

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long" });

/** Un lien d'action discret : cible de 44 px, jamais une flèche collée au texte. */
const LINK_ACTION = "flex min-h-11 items-center gap-1.5 self-start rounded-chip px-2 py-2 font-semibold text-ngoc hover:bg-ngoc/8";
const PRIMARY_LINK =
  "flex min-h-14 w-full items-center justify-center rounded-card bg-ngoc px-6 text-lg font-semibold text-nuoc shadow-card transition-[background-color,transform] hover:bg-ngoc/90 motion-safe:active:scale-[.98]";

/** Lien d'invitation : celui du serveur s'il est absolu, sinon construit sur l'origine courante. */
export function inviteLink(created: Pick<FriendChallengeCreated, "inviteCode"> & { inviteUrl?: string }): string {
  if (created.inviteUrl && /^https?:\/\//.test(created.inviteUrl)) return created.inviteUrl;
  return `${window.location.origin}/defi/${encodeURIComponent(created.inviteCode)}`;
}

/** Retour après création de compte : chemin interne uniquement. */
export function accountPath(kind: "register" | "login", next: string): string {
  return `${kind === "register" ? "/compte" : "/connexion"}?next=${encodeURIComponent(next)}`;
}

export function ChallengesPage() {
  return (
    <Screen top={<PageHeader title={t("social.challenges.title")} back="/" backLabel={t("common.back")} />}>
      {/* Le défi express est l'invitation de l'écran : marché flottant, jade, un seul bouton plein. */}
      <section className="flex flex-col gap-3 pb-6" aria-labelledby="express-title">
        <Card tone="feature" className="flex flex-col gap-3">
          <Illustration className="mx-auto max-w-[13rem]"><FloatingMarket /></Illustration>
          <SectionTitle tone="strong" id="express-title" icon="flame">{t("social.express.title")}</SectionTitle>
          <p className="text-phu-sa">{t("social.express.tagline")}</p>
          <Link to="/express" className={PRIMARY_LINK}>{t("social.express.entry")}</Link>
        </Card>
      </section>
      <FriendsSection />
    </Screen>
  );
}

function FriendsSection() {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [list, setList] = useState<FriendChallengeDto[] | null>(null);
  const [created, setCreated] = useState<FriendChallengeCreated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const signedIn = status === "signed_in" || status === "expired";

  const load = () => getFriendChallenges().then(setList, () => setError(true));

  useEffect(() => {
    if (status === "signed_in" && online) void load();
  }, [status, online]);

  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const next = await createFriendChallenge();
      setCreated(next);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (status === "loading") body = <Skeleton className="h-14 w-full" rounded="card" />;
  else if (!signedIn) {
    body = (
      <EmptyState
        art="lanterns"
        title={t("social.friends.guest")}
        action={<Link to={accountPath("register", "/defis")} className={LINK_ACTION}>{t("social.account.cta")}</Link>}
      />
    );
  } else if (!online) body = <EmptyState art="boat" title={t("social.friends.offline")} />;
  else {
    body = (
      <>
        {created ? (
          <InvitePanel link={inviteLink(created)} />
        ) : (
          <Button onClick={() => void create()} disabled={busy}>
            {busy ? t("social.friends.creating") : t("social.friends.create")}
          </Button>
        )}
        {error && <p role="alert" className="text-sm text-son-mai">{t("social.error")}</p>}
        {list === null && !created && <Skeleton className="h-24 w-full" rounded="card" />}
        {list && list.length === 0 && !created && <EmptyState art="lanterns" compact title={t("social.friends.empty")} />}
        {list && list.length > 0 && (
          <ul className="flex flex-col gap-3">
            {list.map((challenge, i) => (
              // Un seul défi en avant (le plus récent) : deux cartes identiques empilées sont interdites.
              <Card key={challenge.id} as="li" tone={i === 0 ? "raised" : "plain"} {...(i < 6 ? { stagger: i } : {})} data-testid="friend-challenge">
                <ChallengeStandings endsAt={challenge.endsAt} participants={challenge.participants} />
              </Card>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6" aria-labelledby="friends-title">
      <SectionTitle tone="strong" id="friends-title" icon="users">{t("social.friends.title")}</SectionTitle>
      <p className="text-phu-sa">{t("social.friends.intro")}</p>
      {body}
    </section>
  );
}

function InvitePanel({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === "function";

  const share = async () => {
    try {
      await navigator.share({ title: "Parlo", text: t("social.friends.shareText", { url: link }), url: link });
    } catch {
      // Partage annulé : rien à faire.
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : sélection + copie classique.
      const area = document.createElement("textarea");
      area.value = link;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      setCopied(document.execCommand("copy"));
      area.remove();
    }
  };

  return (
    <Card tone="notice" className="flex flex-col gap-2" data-testid="invite">
      <p className="text-sm text-phu-sa">{t("social.friends.invite")}</p>
      <p className="rounded-field bg-surface px-3 py-2 font-semibold break-all select-all" data-testid="invite-link">{link}</p>
      <div className="flex flex-wrap gap-x-4">
        {canShare && (
          <button type="button" onClick={() => void share()} className={LINK_ACTION}>
            <Icon name="share" size={18} />
            {t("social.friends.share")}
          </button>
        )}
        <button type="button" onClick={() => void copy()} className={LINK_ACTION}>
          <Icon name="copy" size={18} />
          {t("social.friends.copy")}
        </button>
      </div>
      <p role="status" className="min-h-6 text-sm text-ngoc">{copied ? t("social.friends.copied") : ""}</p>
    </Card>
  );
}

/** Comparaison sur 7 jours : participant·es par XP, moi en évidence. */
export function ChallengeStandings({ endsAt, participants }: { endsAt: string; participants: FriendParticipant[] }) {
  const ended = Date.parse(endsAt) <= Date.now();
  const rows = [...participants].sort((a, b) => b.xp - a.xp);
  const max = Math.max(1, ...rows.map((r) => r.xp));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={ended ? "neutral" : "ngoc"} icon="calendar">
          {t(ended ? "social.friends.ended" : "social.friends.endsOn", { date: formatDate(endsAt) })}
        </Chip>
        <Chip tone="outline" icon="users">{t("social.friends.participants", { n: rows.length })}</Chip>
      </div>
      <ol className="flex flex-col gap-2">
        {rows.map((p, i) => (
          <li key={`${i}:${p.displayName}`} className={`flex flex-col gap-1 ${p.isMe ? "font-semibold" : ""}`} data-me={p.isMe ? "true" : undefined} aria-current={p.isMe ? "true" : undefined}>
            <span className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{p.displayName}{p.isMe && <span className="font-normal text-phu-sa"> · {t("league.me")}</span>}</span>
              <span className="shrink-0 tabular-nums">{t("league.xp", { n: p.xp })}</span>
            </span>
            <ProgressBar value={p.xp} max={max} size="sm" tone={p.isMe ? "nghe" : "ngoc"} label={`${p.displayName} — ${t("league.xp", { n: p.xp })}`} />
          </li>
        ))}
      </ol>
    </div>
  );
}

type JoinState =
  | { kind: "idle" }
  | { kind: "joining" }
  | { kind: "joined"; endsAt: string; participants: FriendParticipant[] }
  | { kind: "notFound" }
  | { kind: "full" }
  | { kind: "error" };

/** /defi/:code : rejoindre un défi (compte requis → création de compte puis retour ici). */
export function JoinChallengePage() {
  // Rejoindre un défi passe par le serveur : sans lui, on ne propose pas de compte.
  const accounts = useAccountsPossible();
  const { code = "" } = useParams();
  const status = useAccount((s) => s.status);
  const online = useOnline();
  const [state, setState] = useState<JoinState>({ kind: "idle" });
  const attempted = useRef(false);
  const here = `/defi/${encodeURIComponent(code)}`;

  const join = async () => {
    attempted.current = true;
    setState({ kind: "joining" });
    try {
      const joined = await joinFriendChallenge(code);
      setState({ kind: "joined", endsAt: joined.endsAt, participants: joined.participants });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 410)) setState({ kind: "notFound" });
      else if (error instanceof ApiError && error.status === 409) setState({ kind: "full" });
      else setState({ kind: "error" });
    }
  };

  useEffect(() => {
    if (status === "signed_in" && online && !attempted.current) void join();
  }, [status, online]);

  let body: ReactNode;
  if (status === "loading") body = <Skeleton className="h-14 w-full" rounded="card" />;
  else if (status !== "signed_in" && status !== "expired") {
    body = (
      <>
        <Card tone="quiet"><p className="text-lg">{t("social.join.guest")}</p></Card>
        {accounts ? (
          <>
            <Link to={accountPath("register", here)} className={PRIMARY_LINK}>{t("social.join.register")}</Link>
            <Link to={accountPath("login", here)} className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("social.join.login")}</Link>
          </>
        ) : (
          <p className="text-sm text-phu-sa">{t("account.noServer.feature")}</p>
        )}
      </>
    );
  } else if (status === "expired") {
    body = accounts
      ? <Link to={accountPath("login", here)} className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("social.join.login")}</Link>
      : <p className="text-sm text-phu-sa">{t("account.noServer.feature")}</p>;
  } else if (!online && state.kind !== "joined") body = <EmptyState art="boat" title={t("social.join.offline")} />;
  else {
    switch (state.kind) {
      case "idle":
      case "joining":
        body = (
          <>
            <p className="text-phu-sa" role="status">{t("social.join.joining")}</p>
            <Skeleton className="h-24 w-full" rounded="card" />
          </>
        );
        break;
      case "joined":
        body = (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-ngoc" role="status">
              <Icon name="check" size={20} />
              {t("social.join.done")}
            </p>
            <Card tone="raised">
              <ChallengeStandings endsAt={state.endsAt} participants={state.participants} />
            </Card>
            <Link to="/defis" className={LINK_ACTION}>{t("social.join.toChallenges")}</Link>
          </>
        );
        break;
      case "notFound":
        body = <EmptyState art="page" title={t("social.join.notFound")} />;
        break;
      case "full":
        body = <EmptyState art="lanterns" title={t("social.join.full")} />;
        break;
      case "error":
        body = (
          <>
            <p role="alert">{t("social.error")}</p>
            <button type="button" onClick={() => void join()} className={LINK_ACTION}>
              <Icon name="refresh" size={18} />
              {t("social.retry")}
            </button>
          </>
        );
        break;
    }
  }

  return (
    <Screen top={<PageHeader title={t("social.join.title")} back="/" backLabel={t("common.back")} />}>
      <div className="flex flex-col gap-4" data-testid="join-challenge" data-state={state.kind}>
        <p className="text-phu-sa">{t("social.join.intro")}</p>
        {body}
      </div>
    </Screen>
  );
}
