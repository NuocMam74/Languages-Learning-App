import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { Screen } from "../components/ui.tsx";
import type { Profile } from "../db.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { deleteLocalData, exportLocalData, getProfile, saveProfile } from "../learner.ts";
import { clearPrefs, usePrefs } from "../prefs.ts";
import { ReminderSettings } from "../notifications/Reminders.tsx";
import { LeagueSettings } from "../leagues/LeagueWidgets.tsx";
import { PackSettings } from "../packs/PackSettings.tsx";

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
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
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

  useEffect(() => {
    void getProfile().then(setProfile);
  }, []);

  const update = (patch: Partial<Profile>) => {
    if (!profile) return;
    const next = { ...profile, ...patch };
    setProfile(next);
    void saveProfile(next);
  };

  const wipe = async () => {
    await signOut();
    await deleteLocalData();
    clearPrefs();
    window.location.assign("/");
  };

  const reminders: NonNullable<Profile["reminder"]>[] = ["morning", "noon", "evening", "none"];
  const motivations: NonNullable<Profile["motivation"]>[] = ["family", "roots", "travel", "work", "curiosity"];

  return (
    <Screen
      top={
        <div className="flex items-center gap-3 pt-2">
          <button type="button" onClick={() => navigate("/")} className="grid size-11 place-items-center text-phu-sa" aria-label={t("common.back")}>
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1 className="font-serif text-2xl">{t("settings.title")}</h1>
        </div>
      }
    >
      <Section title={t("packs.settings.title")}>
        <PackSettings />
      </Section>

      {profile && (
        <Section title={t("settings.profile")}>
          <p className="text-sm text-phu-sa">{t("settings.goal")}</p>
          <Segmented label={t("settings.goal")} value={profile.dailyGoalMin} options={([5, 10, 15, 20] as const).map((n) => ({ value: n, label: t("onboarding.minutes.value", { n }) }))} onChange={(v) => update({ dailyGoalMin: v })} />
          <p className="text-sm text-phu-sa">{t("settings.reminder")}</p>
          <Segmented label={t("settings.reminder")} value={profile.reminder} options={reminders.map((r) => ({ value: r, label: t(`onboarding.reminder.${r}` as MessageKey) }))} onChange={(v) => update({ reminder: v })} />
          <p className="text-sm text-phu-sa">{t("settings.path")}</p>
          <Segmented label={t("settings.path")} value={profile.motivation} options={motivations.map((m) => ({ value: m, label: t(`onboarding.why.${m}` as MessageKey) }))} onChange={(v) => update({ motivation: v })} />
        </Section>
      )}

      <Section title={t("notif.settings.title")}>
        <ReminderSettings />
      </Section>

      <Section title={t("league.settings.title")}>
        <LeagueSettings motivation={profile?.motivation ?? null} />
      </Section>

      <Section title={t("settings.display")}>
        <p className="text-sm text-phu-sa">{t("settings.locale")}</p>
        <Segmented label={t("settings.locale")} value={locale ?? "auto"} options={[{ value: "auto", label: t("settings.locale.auto") }, { value: "fr", label: "Français" }, { value: "en", label: "English" }]} onChange={(v) => setLocale(v === "fr" || v === "en" ? v : null)} />
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
            <button type="button" onClick={() => void signOut()} className="min-h-11 self-start font-semibold text-ngoc">{t("settings.account.logout")}</button>
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

      <Section title={t("settings.data")}>
        <button type="button" className="min-h-11 self-start font-semibold text-ngoc" onClick={() => void exportLocalData().then((data) => download(`parlo-export-${data.exportedAt.slice(0, 10)}.json`, data))}>
          {t("settings.export")}
        </button>
        <p className="text-sm text-phu-sa">{t("settings.export.note")}</p>
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
    </Screen>
  );
}
