import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError, forgotPassword, NetworkError, resetPassword, verifyEmail } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { setKv } from "../db.ts";
import { Card, Icon, Skeleton } from "../design/index.ts";
import { ACCOUNT_KEY } from "../sync.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { PASSWORD_MIN } from "./Account.tsx";

/**
 * Mot de passe oublié, réinitialisation et vérification d'email (contrat phase5 §4).
 *
 * Trois écrans courts et centrés (contrat phase8 §1) : un champ dans une carte, un médaillon jade
 * quand c'est fait, une carte en laque diluée quand ça ne l'est pas. Aucun rouge nu sur du blanc.
 */

const inputClass = "min-h-12 rounded-field border border-line-strong bg-surface px-4 text-lg focus:border-ngoc focus:outline-none";

function Back() {
  const navigate = useNavigate();
  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => navigate("/connexion")}
        className="-ml-2 grid size-11 place-items-center rounded-full text-phu-sa transition-[background-color,transform] hover:bg-phu-sa/8 motion-safe:active:scale-[.98]"
        aria-label={t("common.back")}
      >
        <Icon name="chevronLeft" />
      </button>
    </div>
  );
}

/** Erreur : carte en laque diluée, icône à gauche, le message reste le `role="alert"`. */
function FormError({ children }: { children: ReactNode }) {
  return (
    <Card tone="alert" className="flex items-start gap-3">
      <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-son-mai" />
      <p role="alert" className="min-w-0 flex-1 font-medium text-son-mai">{children}</p>
    </Card>
  );
}

/** Médaillon de réussite : le seul objet fort de ces écrans, et leur seul mouvement. */
function Medallion() {
  return (
    <span className="grid size-16 place-items-center rounded-full bg-ngoc-sang text-ngoc motion-safe:parlo-flame">
      <Icon name="check" size={32} strokeWidth={2.5} />
    </span>
  );
}

const networkOr = (error: unknown, fallback: MessageKey): MessageKey => (error instanceof NetworkError ? "account.error.network" : fallback);

/** /compte/mot-de-passe-oublie : toujours la même réponse (le serveur répond 204, compte ou non). */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "account.error.rateLimit" : networkOr(err, "account.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      top={<Back />}
      action={sent ? undefined : <Button type="submit" form="forgot-form" disabled={busy || !email.includes("@")}>{busy ? t("account.busy") : t("journey.forgot.submit")}</Button>}
    >
      <h1 className="mt-2 font-serif text-2xl text-balance">{t("journey.forgot.title")}</h1>
      {sent ? (
        <div className="mt-8 flex flex-col items-center gap-4 text-center" role="status" data-testid="forgot-sent">
          <Medallion />
          <p className="text-lg text-balance">{t("journey.forgot.sent")}</p>
        </div>
      ) : (
        <form id="forgot-form" onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-4">
          <p className="text-phu-sa text-balance">{t("journey.forgot.body")}</p>
          <Card tone="raised" className="flex flex-col gap-1">
            <label htmlFor="forgot-email" className="font-medium">{t("account.field.email")}</label>
            <input id="forgot-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" />
          </Card>
          {error && <FormError>{t(error)}</FormError>}
        </form>
      )}
      <Link to="/connexion" className="mt-6 grid min-h-11 place-items-center font-semibold text-ngoc">{t("account.login.title")}</Link>
    </Screen>
  );
}

/** /compte/reinitialiser?token= : nouveau mot de passe (jeton 1 h, usage unique, sessions révoquées). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<MessageKey | null>(token ? null : "journey.reset.missing");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError("account.error.invalid");
      else if (err instanceof ApiError && err.status >= 400 && err.status < 500) setError("journey.reset.invalid");
      else setError(networkOr(err, "account.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      top={<Back />}
      action={done ? undefined : <Button type="submit" form="reset-form" disabled={busy || !token || password.length < PASSWORD_MIN}>{busy ? t("account.busy") : t("journey.reset.submit")}</Button>}
    >
      <h1 className="mt-2 font-serif text-2xl text-balance">{t("journey.reset.title")}</h1>
      {done ? (
        <div className="mt-8 flex flex-col items-center gap-4 text-center" role="status" data-testid="reset-done">
          <Medallion />
          <p className="text-lg text-balance">{t("journey.reset.done")}</p>
          <Link to="/connexion" className="grid min-h-14 w-full place-items-center rounded-card bg-ngoc px-5 text-lg font-semibold text-nuoc shadow-card transition-[background-color,transform] motion-safe:active:scale-[.98]">
            {t("account.login.title")}
          </Link>
        </div>
      ) : (
        <form id="reset-form" onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-4">
          <Card tone="raised" className="flex flex-col gap-1">
            <label htmlFor="reset-password" className="font-medium">{t("journey.reset.field")}</label>
            <input
              id="reset-password"
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={PASSWORD_MIN}
              required
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby="reset-hint"
            />
            <p id="reset-hint" className="text-sm text-phu-sa">{t("account.field.passwordHint", { n: PASSWORD_MIN })}</p>
          </Card>
          {error && <FormError>{t(error)}</FormError>}
          {error === "journey.reset.invalid" && (
            <Link to="/compte/mot-de-passe-oublie" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-ngoc">
              {t("journey.forgot.submit")}
              <Icon name="chevronRight" size={18} />
            </Link>
          )}
        </form>
      )}
    </Screen>
  );
}

/** /compte/verifier?token= : vérification de l'email, puis retour au parcours. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"busy" | "done" | "invalid" | "error">(token ? "busy" : "invalid");
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    verifyEmail(token).then(
      async () => {
        setState("done");
        const account = useAccount.getState();
        if (account.account) {
          await setKv(ACCOUNT_KEY, { ...account.account, emailVerified: true });
          await account.reload();
        }
      },
      (err: unknown) => setState(err instanceof ApiError && err.status >= 400 && err.status < 500 ? "invalid" : "error"),
    );
  }, [token]);

  const text: MessageKey = state === "busy" ? "journey.verify.busy" : state === "done" ? "journey.verify.done" : state === "invalid" ? "journey.verify.invalid" : "account.error.generic";
  return (
    <Screen action={state !== "busy" ? <Button onClick={() => navigate("/", { replace: true })}>{t("recap.next")}</Button> : undefined}>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" data-testid="verify-email" data-state={state}>
        <h1 className="font-serif text-2xl text-balance">{t("journey.verify.title")}</h1>
        {/* Une place tenue par un squelette pendant l'appel : l'écran ne reste jamais nu. */}
        {state === "busy" && <Skeleton className="size-16" />}
        {state === "done" && <Medallion />}
        {state === "done" || state === "busy" ? (
          <p className="text-lg text-balance" role="status">{t(text)}</p>
        ) : (
          <Card tone="alert" className="flex w-full items-start gap-3 text-left">
            <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-son-mai" />
            <p className="min-w-0 flex-1 text-son-mai" role="status">{t(text)}</p>
          </Card>
        )}
      </div>
    </Screen>
  );
}
