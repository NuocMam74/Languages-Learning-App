import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError, NetworkError } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { getLocale, t, type MessageKey } from "../i18n/index.ts";

/**
 * Création de compte et connexion (spec §4.1.6, §14). Email + mot de passe ;
 * Google et Apple annoncés, pas encore actifs. L'invité peut continuer sans compte.
 */

export const PASSWORD_MIN = 10;

function errorKey(error: unknown, mode: "register" | "login"): MessageKey {
  if (error instanceof NetworkError) return "account.error.network";
  if (error instanceof ApiError) {
    if (mode === "register" && error.status === 409) return "account.error.exists";
    if (mode === "login" && error.status === 401) return "account.error.credentials";
    if (error.status === 422) return "account.error.invalid";
    if (error.status === 429) return "account.error.rateLimit";
  }
  return "account.error.generic";
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-sm text-phu-sa">{hint}</p>}
    </div>
  );
}

const inputClass = "min-h-12 rounded-xl border-2 border-phu-sa/20 bg-white px-4 text-lg focus:border-ngoc focus:outline-none";

function ProviderButtons() {
  return (
    <div className="flex flex-col gap-2">
      {(["google", "apple"] as const).map((p) => (
        <button key={p} type="button" disabled className="min-h-12 rounded-2xl border-2 border-phu-sa/15 px-5 text-phu-sa">
          {t(`account.provider.${p}`)} · {t("account.provider.soon")}
        </button>
      ))}
    </div>
  );
}

export default function AccountPage({ mode }: { mode: "register" | "login" }) {
  const navigate = useNavigate();
  // Retour après création de compte / connexion (ex. invitation /defi/:code) : chemin interne seulement.
  const [params] = useSearchParams();
  const rawNext = params.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;
  const withNext = (path: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);
  const { createAccount, signIn } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [locale, setLocale] = useState<"fr" | "en">(getLocale());
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register" && !ageOk) {
      setError("account.error.age");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") await createAccount({ email: email.trim(), password, displayName: displayName.trim(), locale });
      else await signIn(email.trim(), password);
      if (next) navigate(next, { replace: true });
      else setDone(true);
    } catch (err) {
      setError(errorKey(err, mode));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen action={<Button onClick={() => navigate("/", { replace: true })}>{t("recap.next")}</Button>}>
        <div className="flex flex-1 flex-col justify-center gap-3" role="status">
          <h1 className="font-serif text-2xl">{t(mode === "register" ? "account.done.register" : "account.done.login")}</h1>
          <p className="text-phu-sa">{t("account.done.synced")}</p>
        </div>
      </Screen>
    );
  }

  const register = mode === "register";
  return (
    <Screen
      top={
        <div className="pt-2">
          <button type="button" onClick={() => navigate(-1)} className="grid size-11 place-items-center text-phu-sa" aria-label={t("common.back")}>
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </button>
        </div>
      }
    >
      <h1 className="mt-2 font-serif text-2xl">{t(register ? "account.register.title" : "account.login.title")}</h1>
      {register && <p className="mt-2 text-phu-sa">{t("account.register.why")}</p>}

      <form onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-5" noValidate={false}>
        {register && (
          <Field id="acc-name" label={t("account.field.name")}>
            <input id="acc-name" className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} autoComplete="nickname" />
          </Field>
        )}
        <Field id="acc-email" label={t("account.field.email")}>
          <input id="acc-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
        </Field>
        <Field id="acc-password" label={t("account.field.password")} {...(register ? { hint: t("account.field.passwordHint", { n: PASSWORD_MIN }) } : {})}>
          <input
            id="acc-password"
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={register ? PASSWORD_MIN : 1}
            autoComplete={register ? "new-password" : "current-password"}
            aria-describedby={register ? "acc-password-hint" : undefined}
          />
        </Field>
        {register && (
          <>
            <Field id="acc-locale" label={t("account.field.locale")}>
              <select id="acc-locale" className={inputClass} value={locale} onChange={(e) => setLocale(e.target.value === "en" ? "en" : "fr")}>
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </Field>
            <label className="flex min-h-11 items-start gap-3">
              <input type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} className="mt-1 size-6 shrink-0 accent-ngoc" />
              <span>{t("account.field.age")}</span>
            </label>
            <p className="text-sm text-phu-sa">{t("account.privacy")}</p>
          </>
        )}

        {error && <p role="alert" className="font-medium text-son-mai">{t(error)}</p>}

        <Button type="submit" disabled={busy}>
          {busy ? t("account.busy") : t(register ? "account.register.submit" : "account.login.submit")}
        </Button>
      </form>

      <div className="mt-6 flex flex-col gap-4">
        <ProviderButtons />
        {register ? (
          <>
            <Link to={withNext("/connexion")} className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("account.toLogin")}</Link>
            <div className="border-t border-phu-sa/10 pt-4">
              <Link to="/" className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("account.guest.continue")}</Link>
              <p className="text-center text-sm text-phu-sa">{t("account.offer.guestWarning")}</p>
            </div>
          </>
        ) : (
          <Link to={withNext("/compte")} className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("account.toRegister")}</Link>
        )}
      </div>
    </Screen>
  );
}
