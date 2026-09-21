import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { useApiStatus } from "../api-status.ts";
import { ApiError, getServerExport } from "../api.ts";
import { Slot } from "../components/Slot.tsx";
import { Screen } from "../components/ui.tsx";
import { Card, Icon, PageHeader, SectionTitle, Skeleton, type IconName } from "../design/index.ts";
import { db, type Profile } from "../db.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { DAILY_GOAL_CHOICES, deleteLocalData, exportLocalData, getProfile, saveProfile } from "../learner.ts";
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

/**
 * Réglages (spec §4.1.6, §13, §14) : profil, affichage, compte, données.
 *
 * Mise en page (contrat phase8 §1) : plus une longue liste de lignes nues, mais des **groupes**
 * — un titre à icône, une carte, des rangées d'au moins 44 px. Ce qui détruit (effacer, supprimer,
 * se déconnecter) vit à part, en laque, dans une carte d'alerte : on ne l'atteint pas par erreur.
 */

/** Groupe de réglages : son titre serif à icône, puis sa ou ses cartes. */
function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 pb-5">
      <SectionTitle tone="strong" icon={icon}>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** Rangée d'un groupe : l'icône à gauche, le libellé, puis la commande (en dessous si elle est large). */
function Row({ icon, label, hint, children, control }: { icon: IconName; label: string; hint?: string | undefined; children?: ReactNode; control?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3.5 first:border-t-0 first:pt-0">
      <div className="flex min-h-11 items-center gap-3">
        <Icon name={icon} size={20} className="shrink-0 text-ngoc" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{label}</p>
          {hint && <p className="text-sm text-phu-sa">{hint}</p>}
        </div>
        {control}
      </div>
      {children}
    </div>
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
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-field border px-4 transition-[background-color,border-color,transform] motion-safe:active:scale-[.98] ${
            value === o.value ? "border-ngoc bg-ngoc-sang font-semibold text-ngoc" : "border-line-strong bg-surface-2 text-phu-sa"
          }`}
        >
          {value === o.value && <Icon name="check" size={16} strokeWidth={2.5} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ icon, label, checked, onChange, hint }: { icon: IconName; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Row
      icon={icon}
      label={label}
      hint={hint}
      control={
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
          // `before:-inset-2` : la pastille mesure 32 px, sa cible tactile 48 px (WCAG 2.5.8).
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors before:absolute before:-inset-2 ${checked ? "bg-ngoc" : "bg-phu-sa/30"}`}
        >
          <span className={`absolute top-1 left-1 size-6 rounded-full bg-surface shadow-card transition-transform ${checked ? "translate-x-6" : ""}`} />
        </button>
      }
    />
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

/** Message d'erreur : jamais du rouge nu sur du blanc — une carte en laque diluée, avec son icône. */
function Alert({ children }: { children: ReactNode }) {
  return (
    <Card tone="alert" className="flex items-start gap-3">
      <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-son-mai" />
      {children}
    </Card>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { status, account, signOut } = useAccount();
  const accountsPossible = useApiStatus((s) => s.accountsPossible);
  const { locale, theme, feedbackSounds, silent, dictation, setLocale, setTheme, setFeedbackSounds, setSilent, setDictation } = usePrefs();
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

  const header = <PageHeader title={t("settings.title")} back="/" backLabel={t("common.back")} />;
  if (!profile || !preloaded || status === "loading") {
    return (
      <Screen top={header}>
        {/* Jamais d'écran vide pendant la lecture d'IndexedDB : la page se dessine en creux. */}
        <div className="flex flex-col gap-5" data-testid="settings-loading" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-28 w-full" rounded="card" />
            </div>
          ))}
        </div>
      </Screen>
    );
  }

  return (
    <Screen top={header}>
      <Section title={t("packs.settings.title")} icon="globe">
        <Card>
          <PackSettings />
        </Card>
      </Section>

      <Section title={t("settings.profile")} icon="user">
        <Card className="flex flex-col gap-3.5">
          {/* Identité, niveau, compétences, badges : c'est le profil (contrat phase7 §3) ; ici, les réglages. */}
          <Link to="/profil" className="flex min-h-12 items-center gap-3 font-semibold text-ngoc" data-testid="settings-profile-link">
            <Icon name="user" size={20} />
            <span className="min-w-0 flex-1">{t("profile.title")}</span>
            <Icon name="chevronRight" size={18} className="text-phu-sa" />
          </Link>
          <Row icon="target" label={t("settings.goal")}>
            <Segmented label={t("settings.goal")} value={profile.dailyGoalMin} options={DAILY_GOAL_CHOICES.map((n) => ({ value: n, label: t("onboarding.minutes.value", { n }) }))} onChange={(v) => update({ dailyGoalMin: v })} />
          </Row>
          <Row icon="clock" label={t("settings.reminder")}>
            <Segmented label={t("settings.reminder")} value={profile.reminder} options={reminders.map((r) => ({ value: r, label: t(`onboarding.reminder.${r}` as MessageKey) }))} onChange={(v) => update({ reminder: v })} />
          </Row>
          <Row icon="boat" label={t("settings.path")}>
            <Segmented label={t("settings.path")} value={profile.motivation} options={motivations.map((m) => ({ value: m, label: t(`onboarding.why.${m}` as MessageKey) }))} onChange={(v) => update({ motivation: v })} />
          </Row>
          {/* La visite du premier lancement se revoit (contrat phase23 §3) : six écrans qu'on a
              souvent traversés trop vite, et dont on se souvient trois jours plus tard qu'ils
              parlaient de quelque chose d'utile. */}
          <Link
            to="/decouverte"
            className="flex min-h-12 items-center gap-3 font-semibold text-ngoc"
            data-testid="settings-discovery"
          >
            <Icon name="boat" size={20} />
            <span className="min-w-0 flex-1">
              {t("discovery.replay")}
              <span className="block text-sm font-normal text-phu-sa">{t("discovery.replay.hint")}</span>
            </span>
            <Icon name="chevronRight" size={18} className="text-phu-sa" />
          </Link>
        </Card>
      </Section>

      <Section title={t("notif.settings.title")} icon="bell">
        {/* `empty:hidden` : ces deux réglages se retirent d'eux-mêmes (invité, support absent). */}
        <Card className="empty:hidden">
          <ReminderSettings initial={preloaded.reminder} />
        </Card>
      </Section>

      <Section title={t("league.settings.title")} icon="trophy">
        <Card className="empty:hidden">
          <LeagueSettings motivation={profile.motivation} initialEnabled={preloaded.leagues} />
        </Card>
      </Section>

      <Section title={t("settings.display")} icon="settings">
        <Card className="flex flex-col gap-3.5">
          <Row icon="globe" label={t("settings.locale")}>
            <Segmented label={t("settings.locale")} value={locale ?? "auto"} options={[{ value: "auto", label: t("settings.locale.auto") }, { value: "fr", label: "Français" }, { value: "en", label: "English" }]} onChange={(v) => changeLocale(v === "fr" || v === "en" ? v : null)} />
          </Row>
          {/* Thème (contrat phase9 §8) : « système » par défaut, appliqué avant le premier rendu. */}
          <Row icon="lantern" label={t("settings.theme")} hint={t("settings.theme.hint")}>
            <Segmented
              label={t("settings.theme")}
              value={theme}
              options={[
                { value: "system" as const, label: t("settings.theme.system") },
                { value: "light" as const, label: t("settings.theme.light") },
                { value: "dark" as const, label: t("settings.theme.dark") },
              ]}
              onChange={setTheme}
            />
          </Row>
          <Switch icon="mute" label={t("settings.silent")} hint={t("settings.silent.hint")} checked={silent} onChange={setSilent} />
          {/* Le mode silencieux reste le maître : le dire, plutôt que de décocher l'interrupteur tout seul. */}
          <Switch icon="sound" label={t("settings.sounds")} hint={t(silent ? "settings.sounds.silent" : "settings.sounds.hint")} checked={feedbackSounds} onChange={setFeedbackSounds} />
          <Switch icon="mic" label={t("tutor.dictation.setting")} hint={t("tutor.dictation.hint")} checked={dictation} onChange={setDictation} />
        </Card>
      </Section>

      <Section title={t("settings.account")} icon="lock">
        {status === "signed_in" || status === "expired" ? (
          <>
            <Card className="flex flex-col gap-3">
              <p className="flex items-start gap-3">
                <Icon name="user" size={20} className="mt-0.5 shrink-0 text-ngoc" />
                <span className="min-w-0 flex-1">{t("settings.account.signedIn", { name: account?.displayName ?? "", email: account?.email ?? "" })}</span>
              </p>
              {status === "expired" && (
                <Link to="/connexion" className="flex min-h-11 items-center gap-2 font-semibold text-ngoc">
                  <Icon name="refresh" size={18} />
                  {t("settings.account.relogin")}
                </Link>
              )}
            </Card>
            <LogoutControl onSignOut={async () => {
              await signOut();
              window.location.assign("/");
            }} />
          </>
        ) : (
          <Card tone="notice" className="flex flex-col gap-2">
            <p className="flex items-start gap-3 text-sm">
              <Icon name="info" size={20} className="mt-0.5 shrink-0 text-nghe" />
              <span className="min-w-0 flex-1">{t("account.offer.guestWarning")}</span>
            </p>
            {/* Sans API : ni compte ni connexion à proposer — seulement la porte qui s'ouvre. */}
            {accountsPossible() ? (
              <div className="flex flex-wrap gap-x-6">
                <Link to="/compte" className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc">
                  {t("account.offer.cta")}
                  <Icon name="chevronRight" size={18} />
                </Link>
                <Link to="/connexion" className="flex min-h-11 items-center font-semibold text-ngoc">{t("account.login.title")}</Link>
              </div>
            ) : (
              <>
                <p className="text-sm text-phu-sa">{t("account.offer.noServer")}</p>
                <Link to="/reglages/appareil" className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc">
                  {t("transfer.title")}
                  <Icon name="chevronRight" size={18} />
                </Link>
              </>
            )}
          </Card>
        )}
      </Section>

      {/* Sections réseau (rôles, classes) : emplacements réservés à la hauteur de la dernière visite. */}
      <Slot id={`settings-classes-${status}`}>
        <ClassesSettings />
      </Slot>

      <Slot id={`settings-studio-${status}`}>
        <StudioLink />
      </Slot>

      <Section title={t("settings.data")} icon="download">
        {/* Changer d'appareil vient **avant** l'export RGPD : c'est le geste qu'on cherche ici, et
            les deux fichiers ne servent pas à la même chose (contrat phase17 §2). */}
        <Card className="flex flex-col gap-2">
          <Link to="/reglages/appareil" className="flex min-h-12 items-center gap-3 font-semibold text-ngoc" data-testid="settings-transfer">
            <Icon name="share" size={20} />
            <span className="min-w-0 flex-1 text-left">{t("settings.transfer")}</span>
            <Icon name="chevronRight" size={20} className="text-phu-sa" />
          </Link>
          <p className="text-sm text-phu-sa">{t("settings.transfer.hint")}</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <button type="button" className="flex min-h-12 items-center gap-3 font-semibold text-ngoc" data-testid="export-data" onClick={() => void exportData()}>
            <Icon name="download" size={20} />
            <span className="min-w-0 flex-1 text-left">{t(signedIn ? "journey.export.account" : "journey.export.device")}</span>
          </button>
          <p className="text-sm text-phu-sa">{t("journey.export.note")}</p>
        </Card>
        {exportError && (
          <Alert>
            <p role="alert" className="min-w-0 flex-1 text-sm text-son-mai">{t("journey.export.error")}</p>
          </Alert>
        )}

        {/* Ce qui efface vit ensemble, en laque : une carte à part, jamais au fil de la liste. */}
        <Card tone="alert" className="flex flex-col gap-3">
          {signedIn && <DeleteAccount />}
          {!confirmDelete ? (
            <button type="button" className="flex min-h-12 items-center gap-3 font-semibold text-son-mai" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={20} />
              <span className="min-w-0 flex-1 text-left">{t("settings.delete")}</span>
            </button>
          ) : (
            <div className="flex flex-col gap-3" role="alertdialog" aria-labelledby="delete-title">
              <p id="delete-title" className="flex items-center gap-2 font-semibold text-son-mai">
                <Icon name="alert" size={20} />
                {t("settings.delete.confirmTitle")}
              </p>
              <p className="text-sm">{t("settings.delete.confirmBody")}</p>
              <div className="flex flex-wrap items-center gap-4">
                <button type="button" className="min-h-12 rounded-field bg-son-mai px-5 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98]" onClick={() => void wipe()}>
                  {t("settings.delete.confirm")}
                </button>
                <button type="button" className="min-h-12 px-1 font-semibold text-ngoc" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
              </div>
            </div>
          )}
        </Card>
      </Section>

      {/*
        Hors ligne en dernier : la liste des unités arrive après coup (pack découpé, estimation de
        stockage) et passe de « Chargement… » à ~2 400 px. En bas de page, rien ne se décale (CLS).
      */}
      <Section title={t("offline.title")} icon="offline">
        <Card>
          <OfflineSettings />
        </Card>
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
    return (
      <Card tone="alert">
        <button type="button" onClick={() => void open()} className="flex min-h-12 w-full items-center gap-3 font-semibold text-son-mai">
          <Icon name="logout" size={20} />
          <span className="min-w-0 flex-1 text-left">{t("settings.account.logout")}</span>
        </button>
      </Card>
    );
  }
  return (
    <Card tone="alert" data-testid="logout-confirm">
      <div className="flex flex-col gap-3" role="alertdialog" aria-labelledby="logout-title">
        <p id="logout-title" className="flex items-center gap-2 font-semibold text-son-mai">
          <Icon name="alert" size={20} />
          {t("journey.logout.confirmTitle")}
        </p>
        <p className="text-sm">{t("journey.logout.confirmBody")}</p>
        {pending > 0 && <p className="text-sm font-medium text-son-mai">{t("journey.logout.pending", { n: pending })}</p>}
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            disabled={busy}
            className="min-h-12 rounded-field bg-ngoc px-5 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98] disabled:bg-phu-sa/25 disabled:text-phu-sa/60"
            onClick={() => {
              setBusy(true);
              void onSignOut().finally(() => setBusy(false));
            }}
          >
            {busy ? t("journey.logout.busy") : t("journey.logout.confirm")}
          </button>
          <button type="button" className="min-h-12 px-1 font-semibold text-ngoc" onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
        </div>
      </div>
    </Card>
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

  const field = "min-h-12 rounded-field border border-son-mai/30 bg-surface px-4 text-lg focus:border-son-mai focus:outline-none";
  if (!open) {
    return (
      <button type="button" className="flex min-h-12 items-center gap-3 border-b border-son-mai/20 pb-3 font-semibold text-son-mai" onClick={() => setOpen(true)}>
        <Icon name="userMinus" size={20} />
        <span className="min-w-0 flex-1 text-left">{t("journey.deleteAccount")}</span>
      </button>
    );
  }
  const ready = mode === "password" ? password.length > 0 : typed.trim() === t("journey.deleteAccount.word");
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 border-b border-son-mai/20 pb-4" data-testid="delete-account">
      <p className="flex items-center gap-2 font-semibold text-son-mai">
        <Icon name="alert" size={20} />
        {t("journey.deleteAccount")}
      </p>
      <p className="text-sm">{t("journey.deleteAccount.body")}</p>
      {mode === "password" ? (
        <label className="flex flex-col gap-1">
          <span className="font-medium">{t("journey.deleteAccount.password")}</span>
          <input type="password" autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="font-medium">{t("journey.deleteAccount.typeLabel")}</span>
          <span className="text-sm text-phu-sa">{t("journey.deleteAccount.typeHint")}</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" className={field} />
        </label>
      )}
      {mode === "password" && (
        <button type="button" className="min-h-11 self-start text-sm font-semibold text-ngoc" onClick={() => setMode("typed")}>{t("journey.deleteAccount.typeHint")}</button>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-2 font-medium text-son-mai">
          <Icon name="alert" size={18} />
          {t(error)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={!ready || busy} className="min-h-12 rounded-field bg-son-mai px-5 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98] disabled:opacity-50">
          {t("journey.deleteAccount.submit")}
        </button>
        <button type="button" className="min-h-12 px-1 font-semibold text-ngoc" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
