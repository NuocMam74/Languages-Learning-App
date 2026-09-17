import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { ApiError, getServerExport } from "../api.ts";
import { Slot } from "../components/Slot.tsx";
import { Screen } from "../components/ui.tsx";
import { db, type Profile } from "../db.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { deleteLocalData, exportLocalData, getProfile, saveProfile } from "../learner.ts";
import { clearPrefs, usePrefs } from "../prefs.ts";
import { syncInterfaceLocale, syncProfileChange } from "../profile-sync.ts";
import { loadReminderState, ReminderSettings } from "../notifications/Reminders.tsx";
import type { ReminderState } from "../notifications/push.ts";
import { getLeaguesEnabled } from "../leagues/league-store.ts";
import { LeagueSettings } from "../leagues/LeagueWidgets.tsx";
import { PackSettings } from "../packs/PackSettings.tsx";
import { preloadPackChoices } from "../packs/use-packs.ts";
import { ClassesSettings } from "../classes/ClassesSettings.tsx";
import { StudioLink } from "../studio/StudioLink.tsx";
import { OfflineSettings } from "../offline/OfflineSettings.tsx";

/** Réglages (spec §4.1.6, §13, §14) : profil, affichage, compte, données. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-phu-sa/10 py-5 first:border-t-0">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    // Grille à 2 colonnes sur téléphone : le nombre de lignes ne dépend pas de la largeur du texte,
    // donc l'arrivée de la police (swap) ne décale plus la page (CLS, audit mobile P1 #4).
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 rounded-xl border-2 px-4 ${value === o.value ? "border-ngoc bg-ngoc-sang font-semibold" : "border-phu-sa/15 bg-white/70"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p>{label}</p>
        {hint && <p className="text-sm text-phu-sa">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors before:absolute before:-inset-2 ${checked ? "bg-ngoc" : "bg-phu-sa/30"}`}
      >
        <span className={`absolute top-1 left-1 size-6 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : ""}`} />
      </button>
    </div>
  );
}

function download(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Settings() {
  const navigate = useNavigate();
  const { status, account, signOut } = useAccount();
  const { locale, silent, dictation, setLocale, setSilent, setDictation } = usePrefs();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Sections dont l'état est lu en local (rappels, ligue) : préchargées avec le profil, la page
  // s'affiche en une fois à sa hauteur finale (CLS mesuré à 0,55 quand elles arrivaient après coup).
  const [preloaded, setPreloaded] = useState<{ reminder: ReminderState; leagues: boolean } | null>(null);

  useEffect(() => {
    void getProfile().then(async (p) => {
      // Noms des packs compris : la liste « Langue apprise » ne gagne pas une ligne après coup (CLS).
      const [reminder, leagues] = await Promise.all([
        loadReminderState(),
        getLeaguesEnabled({ motivation: p.motivation }),
        preloadPackChoices().catch(() => undefined),
      ]);
      setProfile(p);
      setPreloaded({ reminder, leagues });
    });
  }, []);

  const update = (patch: Partial<Profile>) => {
    if (!profile) return;
    const next = { ...profile, ...patch };
    setProfile(next);
    // Chaque changement part au serveur (contrat phase5 §4), hors ligne compris (file).
    void saveProfile(next).then(() => syncProfileChange(profile, next));
  };

  const changeLocale = (value: "fr" | "en" | null) => {
    setLocale(value);
    void syncInterfaceLocale(value);
  };

  const signedIn = status === "signed_in" || status === "expired";
  const [exportError, setExportError] = useState(false);
  const exportData = async () => {
    setExportError(false);
    const device = await exportLocalData();
    let account: unknown = null;
    if (status === "signed_in") {
      try {
        account = await getServerExport();
      } catch {
        setExportError(true);
      }
    }
    download(`parlo-export-${device.exportedAt.slice(0, 10)}.json`, account ? { app: "parlo", exportedAt: device.exportedAt, account, device } : device);
  };

  const wipe = async () => {
    await signOut();
    await deleteLocalData();
    clearPrefs();
    window.location.assign("/");
  };

  const reminders: NonNullable<Profile["reminder"]>[] = ["morning", "noon", "evening", "none"];
  const motivations: NonNullable<Profile["motivation"]>[] = ["family", "roots", "travel", "work", "curiosity"];

  const header = (
    <div className="flex items-center gap-3 pt-2">
      <button type="button" onClick={() => navigate("/")} className="grid size-11 shrink-0 place-items-center text-phu-sa" aria-label={t("common.back")}>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1 className="font-serif text-2xl">{t("settings.title")}</h1>
    </div>
  );
  if (!profile || !preloaded || status === "loading") return <Screen top={header}><div data-testid="settings-loading" /></Screen>;

  return (
    <Screen top={header}>
      <Section title={t("packs.settings.title")}>
        <PackSettings />
      </Section>

      <Section title={t("settings.profile")}>
        {/* Identité, niveau, compétences, badges : c'est le profil (contrat phase7 §3) ; ici, les réglages. */}
        <Link to="/profil" className="flex min-h-12 items-center justify-between font-semibold text-ngoc" data-testid="settings-profile-link">
          <span>{t("profile.title")}</span>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M9 5l7 7-7 7" /></svg>
        </Link>
        <p className="text-sm text-phu-sa">{t("settings.goal")}</p>
        <Segmented label={t("settings.goal")} value={profile.dailyGoalMin} options={([5, 10, 15, 20] as const).map((n) => ({ value: n, label: t("onboarding.minutes.value", { n }) }))} onChange={(v) => update({ dailyGoalMin: v })} />
        <p className="text-sm text-phu-sa">{t("settings.reminder")}</p>
        <Segmented label={t("settings.reminder")} value={profile.reminder} options={reminders.map((r) => ({ value: r, label: t(`onboarding.reminder.${r}` as MessageKey) }))} onChange={(v) => update({ reminder: v })} />
        <p className="text-sm text-phu-sa">{t("settings.path")}</p>
        <Segmented label={t("settings.path")} value={profile.motivation} options={motivations.map((m) => ({ value: m, label: t(`onboarding.why.${m}` as MessageKey) }))} onChange={(v) => update({ motivation: v })} />
      </Section>

      <Section title={t("notif.settings.title")}>
        <ReminderSettings initial={preloaded.reminder} />
      </Section>

      <Section title={t("league.settings.title")}>
        <LeagueSettings motivation={profile.motivation} initialEnabled={preloaded.leagues} />
      </Section>

      <Section title={t("settings.display")}>
        <p className="text-sm text-phu-sa">{t("settings.locale")}</p>
        <Segmented label={t("settings.locale")} value={locale ?? "auto"} options={[{ value: "auto", label: t("settings.locale.auto") }, { value: "fr", label: "Français" }, { value: "en", label: "English" }]} onChange={(v) => changeLocale(v === "fr" || v === "en" ? v : null)} />
        <Switch label={t("settings.silent")} hint={t("settings.silent.hint")} checked={silent} onChange={setSilent} />
        <Switch label={t("tutor.dictation.setting")} hint={t("tutor.dictation.hint")} checked={dictation} onChange={setDictation} />
      </Section>

      <Section title={t("settings.account")}>
        {status === "signed_in" || status === "expired" ? (
          <>
            <p>{t("settings.account.signedIn", { name: account?.displayName ?? "", email: account?.email ?? "" })}</p>
            {status === "expired" && (
              <Link to="/connexion" className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("settings.account.relogin")}</Link>
            )}
            <LogoutControl onSignOut={async () => {
              await signOut();
              window.location.assign("/");
            }} />
          </>
        ) : (
          <>
            <p className="text-sm text-phu-sa">{t("account.offer.guestWarning")}</p>
            <div className="flex flex-wrap gap-x-6">
              <Link to="/compte" className="min-h-11 py-2 font-semibold text-ngoc">{t("account.offer.cta")}</Link>
              <Link to="/connexion" className="min-h-11 py-2 font-semibold text-ngoc">{t("account.login.title")}</Link>
            </div>
          </>
        )}
      </Section>

      {/* Sections réseau (rôles, classes) : emplacements réservés à la hauteur de la dernière visite. */}
      <Slot id={`settings-classes-${status}`}>
        <ClassesSettings />
      </Slot>

      <Slot id={`settings-studio-${status}`}>
        <StudioLink />
      </Slot>

      <Section title={t("settings.data")}>
        <button type="button" className="min-h-11 self-start font-semibold text-ngoc" data-testid="export-data" onClick={() => void exportData()}>
          {t(signedIn ? "journey.export.account" : "journey.export.device")}
        </button>
        <p className="text-sm text-phu-sa">{t("journey.export.note")}</p>
        {exportError && <p role="alert" className="text-sm text-son-mai">{t("journey.export.error")}</p>}
        {signedIn && <DeleteAccount />}
        {!confirmDelete ? (
          <button type="button" className="min-h-11 self-start font-semibold text-son-mai" onClick={() => setConfirmDelete(true)}>
            {t("settings.delete")}
          </button>
        ) : (
          <div className="flex flex-col gap-3 border-l-4 border-son-mai pl-3" role="alertdialog" aria-labelledby="delete-title">
            <p id="delete-title" className="font-semibold">{t("settings.delete.confirmTitle")}</p>
            <p className="text-sm">{t("settings.delete.confirmBody")}</p>
            <div className="flex gap-4">
              <button type="button" className="min-h-11 rounded-xl bg-son-mai px-4 font-semibold text-white" onClick={() => void wipe()}>
                {t("settings.delete.confirm")}
              </button>
              <button type="button" className="min-h-11 text-ngoc" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
            </div>
          </div>
        )}
      </Section>

      {/*
        Hors ligne en dernier : la liste des unités arrive après coup (pack découpé, estimation de
        stockage) et passe de « Chargement… » à ~2 400 px. En bas de page, rien ne se décale (CLS).
      */}
      <Section title={t("offline.title")}>
        <OfflineSettings />
      </Section>
    </Screen>
  );
}

function LogoutControl({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setPending(await db().outbox.count());
    setConfirming(true);
  };

  if (!confirming) {
    return <button type="button" onClick={() => void open()} className="min-h-11 self-start font-semibold text-ngoc">{t("settings.account.logout")}</button>;
  }
  return (
    <div className="flex flex-col gap-3 border-l-4 border-nghe pl-3" role="alertdialog" aria-labelledby="logout-title" data-testid="logout-confirm">
      <p id="logout-title" className="font-semibold">{t("journey.logout.confirmTitle")}</p>
      <p className="text-sm">{t("journey.logout.confirmBody")}</p>
      {pending > 0 && <p className="text-sm text-son-mai">{t("journey.logout.pending", { n: pending })}</p>}
      <div className="flex flex-wrap gap-4">
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-xl bg-ngoc px-4 font-semibold text-nuoc"
          onClick={() => {
            setBusy(true);
            void onSignOut().finally(() => setBusy(false));
          }}
        >
          {busy ? t("journey.logout.busy") : t("journey.logout.confirm")}
        </button>
        <button type="button" className="min-h-11 text-ngoc" onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

/** Suppression du compte (RGPD, contrat phase5 §4) : mot de passe, ou « SUPPRIMER » pour un compte sans mot de passe. */
function DeleteAccount() {
  const deleteAccount = useAccount((s) => s.deleteAccount);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"password" | "typed">("password");
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(mode === "password" ? { password } : { confirm: "SUPPRIMER" });
      clearPrefs();
      window.location.assign("/");
    } catch (err) {
      // Compte OAuth sans mot de passe : le serveur demande la confirmation écrite.
      if (err instanceof ApiError && (err.status === 400 || err.status === 422) && mode === "password" && /confirm/i.test(err.detail)) {
        setMode("typed");
      } else if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setError("journey.deleteAccount.wrongPassword");
      } else {
        setError("journey.deleteAccount.error");
      }
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="min-h-11 self-start font-semibold text-son-mai" onClick={() => setOpen(true)}>
        {t("journey.deleteAccount")}
      </button>
    );
  }
  const ready = mode === "password" ? password.length > 0 : typed.trim() === t("journey.deleteAccount.word");
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 border-l-4 border-son-mai pl-3" data-testid="delete-account">
      <p className="font-semibold">{t("journey.deleteAccount")}</p>
      <p className="text-sm">{t("journey.deleteAccount.body")}</p>
      {mode === "password" ? (
        <label className="flex flex-col gap-1">
          <span className="font-medium">{t("journey.deleteAccount.password")}</span>
          <input type="password" autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} className="min-h-12 rounded-xl border-2 border-phu-sa/20 bg-white px-4 text-lg" />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="font-medium">{t("journey.deleteAccount.typeLabel")}</span>
          <span className="text-sm text-phu-sa">{t("journey.deleteAccount.typeHint")}</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" className="min-h-12 rounded-xl border-2 border-phu-sa/20 bg-white px-4 text-lg" />
        </label>
      )}
      {mode === "password" && (
        <button type="button" className="min-h-11 self-start text-sm text-ngoc" onClick={() => setMode("typed")}>{t("journey.deleteAccount.typeHint")}</button>
      )}
      {error && <p role="alert" className="text-son-mai">{t(error)}</p>}
      <div className="flex flex-wrap gap-4">
        <button type="submit" disabled={!ready || busy} className="min-h-11 rounded-xl bg-son-mai px-4 font-semibold text-white disabled:opacity-50">
          {t("journey.deleteAccount.submit")}
        </button>
        <button type="button" className="min-h-11 text-ngoc" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
