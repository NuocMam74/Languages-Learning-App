import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAccount } from "../account.ts";
import { BackHeader } from "../exams/BackHeader.tsx";
import { Button, Screen } from "../components/ui.tsx";
import { t } from "../i18n/index.ts";
import { getProfile } from "../learner.ts";
import { useOnline } from "../use-online.ts";
import { defaultHour, disableReminders, enableReminders, getReminderState, markRemindersAsked, pushSupport, shouldOfferReminders, type ReminderState } from "./push.ts";

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 h → 22 h

function HourSelect({ value, onChange, disabled }: { value: number; onChange: (h: number) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>{t("notif.settings.hour")}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 rounded-xl border-2 border-phu-sa/15 bg-white/70 px-3"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>{t("notif.settings.hourValue", { h })}</option>
        ))}
      </select>
    </label>
  );
}

/** Lecture locale de l'état des rappels (profil → heure par défaut). */
export const loadReminderState = () => getProfile().then((p) => getReminderState(defaultHour(p.reminder)));

function useReminderState(initial: ReminderState | null = null) {
  const [state, setState] = useState<ReminderState | null>(initial);
  useEffect(() => {
    if (initial) return;
    void loadReminderState().then(setState);
  }, []);
  return [state, setState] as const;
}

/** Section « Rappels » des réglages. */
export function ReminderSettings({ initial = null }: { initial?: ReminderState | null } = {}) {
  const status = useAccount((s) => s.status);
  const online = useOnline();
  // État préchargé par les Réglages : la section s'affiche d'emblée à sa hauteur finale (CLS).
  const [state, setState] = useReminderState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();

  if (!state) return null;

  const blocked =
    status !== "signed_in" ? t("notif.settings.account")
    : support === "unsupported" ? t("notif.settings.unsupported")
    : support === "denied" ? t("notif.settings.denied")
    : support === "ios_install" ? t("notif.ios.body")
    : !online ? t("notif.settings.offline")
    : null;

  const apply = async (enabled: boolean, hour: number) => {
    setBusy(true);
    setError(null);
    try {
      setState(enabled ? await enableReminders(hour) : await disableReminders());
    } catch {
      setError(Notification.permission === "denied" ? t("notif.settings.denied") : t("notif.settings.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="reminder-settings">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p>{t("notif.settings.toggle")}</p>
          <p className="text-sm text-phu-sa">{t("notif.settings.hint")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label={t("notif.settings.toggle")}
          disabled={busy || (blocked !== null && !state.enabled)}
          onClick={() => void apply(!state.enabled, state.hour)}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors before:absolute before:-inset-2 disabled:opacity-50 ${state.enabled ? "bg-ngoc" : "bg-phu-sa/30"}`}
        >
          <span className={`absolute top-1 left-1 size-6 rounded-full bg-white transition-transform ${state.enabled ? "translate-x-6" : ""}`} />
        </button>
      </div>
      <HourSelect
        value={state.hour}
        disabled={busy}
        onChange={(hour) => (state.enabled ? void apply(true, hour) : setState({ ...state, hour }))}
      />
      {blocked && !state.enabled && <p className="text-sm text-phu-sa">{blocked}</p>}
      {error && <p role="alert" className="text-sm text-son-mai">{error}</p>}
    </div>
  );
}

/** Invitation discrète sur le hub, après la 3e séance terminée. */
export function ReminderPrompt() {
  const status = useAccount((s) => s.status);
  const [show, setShow] = useState(false);

  useEffect(() => {
    void shouldOfferReminders(status === "signed_in").then(setShow);
  }, [status]);

  if (!show) return null;
  return (
    <aside className="mb-5 flex flex-col gap-2 border-l-4 border-ngoc py-1 pl-4" data-testid="reminder-prompt">
      <p className="font-semibold">{t("notif.prompt.title")}</p>
      <p className="text-sm text-phu-sa">{t("notif.prompt.body")}</p>
      <div className="flex gap-4">
        <Link to="/rappels" className="grid min-h-11 place-items-center rounded-xl bg-ngoc px-4 font-semibold text-nuoc">{t("notif.prompt.yes")}</Link>
        <button type="button" className="min-h-11 text-ngoc" onClick={() => void markRemindersAsked().then(() => setShow(false))}>{t("notif.prompt.no")}</button>
      </div>
    </aside>
  );
}

/** Écran d'explication avant la demande de permission (/rappels). */
export function RemindersPage() {
  const navigate = useNavigate();
  const [state, setState] = useReminderState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();

  if (!state) return <Screen><div /></Screen>;

  if (support === "ios_install") {
    return (
      <Screen top={<BackHeader title={t("notif.settings.title")} />} action={<Button onClick={() => void markRemindersAsked().then(() => navigate("/"))}>{t("notif.page.later")}</Button>}>
        <div className="flex flex-col gap-4 pt-4">
          <h2 className="font-serif text-2xl">{t("notif.ios.title")}</h2>
          <p className="text-lg">{t("notif.ios.body")}</p>
        </div>
      </Screen>
    );
  }

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await enableReminders(state.hour));
    } catch {
      setError("Notification" in window && Notification.permission === "denied" ? t("notif.settings.denied") : t("notif.settings.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      top={<BackHeader title={t("notif.settings.title")} />}
      action={
        state.enabled ? (
          <Button onClick={() => navigate("/")}>{t("exams.result.home")}</Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button disabled={busy || support !== "ok"} onClick={() => void enable()}>{busy ? t("notif.page.enabling") : t("notif.page.enable")}</Button>
            <Button variant="quiet" onClick={() => void markRemindersAsked().then(() => navigate("/"))}>{t("notif.page.later")}</Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5 pt-4">
        <h2 className="font-serif text-2xl">{t("notif.page.title")}</h2>
        <p>{t("notif.page.body")}</p>
        <p className="border-l-4 border-nghe pl-3 italic">
          <span className="font-semibold not-italic">{t("tutor.name")} : </span>
          {t("notif.page.example")}
        </p>
        {state.enabled ? (
          <p role="status" className="font-semibold text-ngoc">{t("notif.page.done", { h: state.hour })}</p>
        ) : (
          <HourSelect value={state.hour} onChange={(hour) => setState({ ...state, hour })} disabled={busy} />
        )}
        {support === "unsupported" && <p className="text-sm text-phu-sa">{t("notif.settings.unsupported")}</p>}
        {support === "denied" && <p className="text-sm text-phu-sa">{t("notif.settings.denied")}</p>}
        {error && <p role="alert" className="text-sm text-son-mai">{error}</p>}
      </div>
    </Screen>
  );
}
