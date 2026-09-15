import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError, forgotPassword, NetworkError, resetPassword, verifyEmail } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { setKv } from "../db.ts";
import { ACCOUNT_KEY } from "../sync.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { PASSWORD_MIN } from "./Account.tsx";

/** Mot de passe oublié, réinitialisation et vérification d'email (contrat phase5 §4). */

const inputClass = "min-h-12 rounded-xl border-2 border-phu-sa/20 bg-white px-4 text-lg focus:border-ngoc focus:outline-none";

function Back() {
  const navigate = useNavigate();
  return (
    <div className="pt-2">
      <button type="button" onClick={() => navigate("/connexion")} className="grid size-11 place-items-center text-phu-sa" aria-label={t("common.back")}>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
      </button>
    </div>
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
    <Screen top={<Back />}>
      <h1 className="mt-2 font-serif text-2xl">{t("journey.forgot.title")}</h1>
      {sent ? (
        <p className="mt-6 text-lg" role="status" data-testid="forgot-sent">{t("journey.forgot.sent")}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-5">
          <p className="text-phu-sa">{t("journey.forgot.body")}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor="forgot-email" className="font-medium">{t("account.field.email")}</label>
            <input id="forgot-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
          </div>
          {error && <p role="alert" className="font-medium text-son-mai">{t(error)}</p>}
          <Button type="submit" disabled={busy || !email.includes("@")}>{busy ? t("account.busy") : t("journey.forgot.submit")}</Button>
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
    <Screen top={<Back />}>
      <h1 className="mt-2 font-serif text-2xl">{t("journey.reset.title")}</h1>
      {done ? (
        <div className="mt-6 flex flex-col gap-4" role="status" data-testid="reset-done">
          <p className="text-lg">{t("journey.reset.done")}</p>
          <Link to="/connexion" className="grid min-h-12 place-items-center rounded-2xl bg-ngoc px-5 text-lg font-semibold text-nuoc">{t("account.login.title")}</Link>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-5">
          <div className="flex flex-col gap-1">
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
              aria-describedby="reset-hint"
            />
            <p id="reset-hint" className="text-sm text-phu-sa">{t("account.field.passwordHint", { n: PASSWORD_MIN })}</p>
          </div>
          {error && <p role="alert" className="font-medium text-son-mai">{t(error)}</p>}
          {error === "journey.reset.invalid" && <Link to="/compte/mot-de-passe-oublie" className="min-h-11 font-semibold text-ngoc">{t("journey.forgot.submit")}</Link>}
          <Button type="submit" disabled={busy || !token || password.length < PASSWORD_MIN}>{busy ? t("account.busy") : t("journey.reset.submit")}</Button>
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
      <div className="flex flex-1 flex-col justify-center gap-4" data-testid="verify-email" data-state={state}>
        <h1 className="font-serif text-2xl">{t("journey.verify.title")}</h1>
        <p className="text-lg" role="status">{t(text)}</p>
      </div>
    </Screen>
  );
}
