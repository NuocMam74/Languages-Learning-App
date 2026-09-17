import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError, getOAuthProviders, NetworkError, oauthStartUrl, type OAuthProvider } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { getLocale, t, type MessageKey } from "../i18n/index.ts";

/**
 * Création de compte et connexion (spec §4.1.6, §14). Email + mot de passe ; boutons OAuth
 * seulement pour les fournisseurs configurés côté serveur (contrat phase5 §4). L'invité peut
 * continuer sans compte.
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

/** Fournisseurs OAuth configurés (`GET /auth/oauth/providers`) ; aucun bouton sinon. */
function ProviderButtons({ next }: { next: string | null }) {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  useEffect(() => {
    let live = true;
    if (!navigator.onLine) return;
    void getOAuthProviders().then(
      (list) => live && setProviders(Array.isArray(list) ? list.filter((p) => p && (p.id === "google" || p.id === "apple")) : []),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (providers.length === 0) return null;
  // Retour sur /compte?oauth=ok&next=… : le cookie de refresh est posé par le serveur.
  const back = `/compte${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <div className="flex flex-col gap-2" data-testid="oauth-providers">
      <p className="text-center text-sm text-phu-sa">{t("journey.oauth.or")}</p>
      {providers.map((p) => (
        <a key={p.id} href={oauthStartUrl(p.id, next ?? "/")} data-return={back} className="grid min-h-12 place-items-center rounded-2xl border-2 border-ngoc px-5 font-semibold text-ngoc">
          {t("journey.oauth.continue", { name: p.name })}
        </a>
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
  const { createAccount, signIn, completeOAuth } = useAccount();
  const oauth = params.get("oauth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [locale, setLocale] = useState<"fr" | "en">(getLocale());
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);

  // Retour d'un fournisseur OAuth : /compte?oauth=ok&next=… (contrat phase5 §4).
  useEffect(() => {
    if (!oauth) return;
    if (oauth !== "ok") {
      setError("journey.oauth.failed" as MessageKey);
      return;
    }
    setBusy(true);
    void completeOAuth().then((ok) => {
      setBusy(false);
      if (!ok) setError("journey.oauth.failed" as MessageKey);
      // Progression restaurée : rechargement pour relire profil et parcours.
      else if (next) window.location.assign(next);
      else setDone(true);
    });
  }, [oauth]);

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
      // Connexion : la progression du compte vient d'être restaurée, l'app se recharge pour la relire.
      if (next) {
        if (mode === "login") window.location.assign(next);
        else navigate(next, { replace: true });
      } else setDone(true);
    } catch (err) {
      setError(errorKey(err, mode));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen action={<Button onClick={() => (mode === "login" || oauth ? window.location.assign("/apprendre") : navigate("/apprendre", { replace: true }))}>{t("recap.next")}</Button>}>
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
      // Action principale dans la barre collante du bas : visible sans défiler, même clavier ouvert.
      action={
        <Button type="submit" form="account-form" disabled={busy}>
          {busy ? t("account.busy") : t(register ? "account.register.submit" : "account.login.submit")}
        </Button>
      }
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

      <form id="account-form" onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-5" noValidate={false}>
        {register && (
          <Field id="acc-name" label={t("account.field.name")}>
            <input id="acc-name" className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} autoComplete="nickname" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
          </Field>
        )}
        <Field id="acc-email" label={t("account.field.email")}>
          <input id="acc-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete={register ? "email" : "username"} inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
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
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint={register ? "next" : "go"}
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
      </form>

      {!register && (
        <Link to="/compte/mot-de-passe-oublie" className="mt-3 grid min-h-11 place-items-center font-semibold text-ngoc">{t("journey.forgot.link")}</Link>
      )}

      <div className="mt-6 flex flex-col gap-4">
        <ProviderButtons next={next} />
        {register ? (
          <>
            <Link to={withNext("/connexion")} className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("account.toLogin")}</Link>
            <div className="border-t border-phu-sa/10 pt-4">
              <Link to="/apprendre" className="grid min-h-11 place-items-center font-semibold text-ngoc">{t("account.guest.continue")}</Link>
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
