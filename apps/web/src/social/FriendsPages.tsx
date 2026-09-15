import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { BackHeader } from "../exams/BackHeader.tsx";
import { getLocale, t } from "../i18n/index.ts";
import { useOnline } from "../use-online.ts";
import { createFriendChallenge, getFriendChallenges, joinFriendChallenge, type FriendChallengeCreated, type FriendChallengeDto, type FriendParticipant } from "./social-api.ts";

/**
 * Défis entre amis (spec §5.2, contrat phase3 §3) : défi de 7 jours sur l'XP,
 * lien d'invitation, comparaison des participant·es. Pas de chat (§14) : prénoms seulement.
 */

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long" });

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
    <Screen top={<BackHeader title={t("social.challenges.title")} />}>
      <section className="flex flex-col gap-3 pb-6" aria-labelledby="express-title">
        <h2 id="express-title" className="font-serif text-2xl">{t("social.express.title")}</h2>
        <p className="text-phu-sa">{t("social.express.tagline")}</p>
        <Link to="/express" className="grid min-h-14 place-items-center rounded-2xl bg-ngoc px-6 text-lg font-semibold text-nuoc">
          {t("social.express.entry")}
        </Link>
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
  if (status === "loading") body = null;
  else if (!signedIn) {
    body = (
      <>
        <p>{t("social.friends.guest")}</p>
        <Link to={accountPath("register", "/defis")} className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("social.account.cta")}</Link>
      </>
    );
  } else if (!online) body = <p className="text-phu-sa">{t("social.friends.offline")}</p>;
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
        {list && list.length === 0 && !created && <p className="text-phu-sa">{t("social.friends.empty")}</p>}
        {list && list.length > 0 && (
          <ul className="flex flex-col">
            {list.map((challenge) => (
              <li key={challenge.id} className="border-t border-phu-sa/10 py-4" data-testid="friend-challenge">
                <ChallengeStandings endsAt={challenge.endsAt} participants={challenge.participants} />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <section className="flex flex-col gap-3 border-t border-phu-sa/10 pt-6" aria-labelledby="friends-title">
      <h2 id="friends-title" className="font-serif text-2xl">{t("social.friends.title")}</h2>
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
    <div className="flex flex-col gap-2 border-l-4 border-nghe pl-4" data-testid="invite">
      <p className="text-sm text-phu-sa">{t("social.friends.invite")}</p>
      <p className="font-semibold break-all select-all" data-testid="invite-link">{link}</p>
      <div className="flex flex-wrap gap-x-6">
        {canShare && (
          <button type="button" onClick={() => void share()} className="min-h-11 font-semibold text-ngoc">{t("social.friends.share")}</button>
        )}
        <button type="button" onClick={() => void copy()} className="min-h-11 font-semibold text-ngoc">{t("social.friends.copy")}</button>
      </div>
      <p role="status" className="min-h-6 text-sm text-ngoc">{copied ? t("social.friends.copied") : ""}</p>
    </div>
  );
}

/** Comparaison sur 7 jours : participant·es par XP, moi en évidence. */
export function ChallengeStandings({ endsAt, participants }: { endsAt: string; participants: FriendParticipant[] }) {
  const ended = Date.parse(endsAt) <= Date.now();
  const rows = [...participants].sort((a, b) => b.xp - a.xp);
  const max = Math.max(1, ...rows.map((r) => r.xp));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-phu-sa">
        {t(ended ? "social.friends.ended" : "social.friends.endsOn", { date: formatDate(endsAt) })} · {t("social.friends.participants", { n: rows.length })}
      </p>
      <ol className="flex flex-col gap-2">
        {rows.map((p, i) => (
          <li key={`${i}:${p.displayName}`} className={`flex flex-col gap-1 ${p.isMe ? "font-semibold" : ""}`} data-me={p.isMe ? "true" : undefined} aria-current={p.isMe ? "true" : undefined}>
            <span className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{p.displayName}{p.isMe && <span className="font-normal text-phu-sa"> · {t("league.me")}</span>}</span>
              <span className="shrink-0 tabular-nums">{t("league.xp", { n: p.xp })}</span>
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-phu-sa/10" aria-hidden>
              <span className={`block h-full rounded-full ${p.isMe ? "bg-nghe" : "bg-ngoc"}`} style={{ width: `${(p.xp / max) * 100}%` }} />
            </span>
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
  if (status === "loading") body = null;
  else if (status !== "signed_in" && status !== "expired") {
    body = (
      <>
        <p>{t("social.join.guest")}</p>
        <Link to={accountPath("register", here)} className="grid min-h-14 place-items-center rounded-2xl bg-ngoc px-6 text-lg font-semibold text-nuoc">
          {t("social.join.register")}
        </Link>
        <Link to={accountPath("login", here)} className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("social.join.login")}</Link>
      </>
    );
  } else if (status === "expired") {
    body = <Link to={accountPath("login", here)} className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("social.join.login")}</Link>;
  } else if (!online && state.kind !== "joined") body = <p className="text-phu-sa">{t("social.join.offline")}</p>;
  else {
    switch (state.kind) {
      case "idle":
      case "joining":
        body = <p className="text-phu-sa" role="status">{t("social.join.joining")}</p>;
        break;
      case "joined":
        body = (
          <>
            <p className="text-lg font-semibold text-ngoc" role="status">{t("social.join.done")}</p>
            <ChallengeStandings endsAt={state.endsAt} participants={state.participants} />
            <Link to="/defis" className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("social.join.toChallenges")}</Link>
          </>
        );
        break;
      case "notFound":
        body = <p className="border-l-4 border-phu-sa/30 pl-3">{t("social.join.notFound")}</p>;
        break;
      case "full":
        body = <p className="border-l-4 border-phu-sa/30 pl-3">{t("social.join.full")}</p>;
        break;
      case "error":
        body = (
          <>
            <p role="alert">{t("social.error")}</p>
            <button type="button" onClick={() => void join()} className="min-h-11 self-start font-semibold text-ngoc">{t("social.retry")}</button>
          </>
        );
        break;
    }
  }

  return (
    <Screen top={<BackHeader title={t("social.join.title")} />}>
      <div className="flex flex-col gap-4" data-testid="join-challenge" data-state={state.kind}>
        <p className="text-phu-sa">{t("social.join.intro")}</p>
        {body}
      </div>
    </Screen>
  );
}
