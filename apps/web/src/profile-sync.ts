import type { ProfilePatch } from "./api.ts";
import type { Profile } from "./db.ts";
import { getLocale } from "./i18n/index.ts";
import { defaultHour } from "./notifications/push.ts";
import { usePrefs } from "./prefs.ts";
import { queueProfilePatch } from "./sync.ts";

/**
 * Réponses d'onboarding et réglages envoyés au serveur (contrat phase5 §4) : motivation, entourage,
 * niveau déclaré, objectif, rappel, langue d'interface. La dictée reste locale.
 * `leaguesEnabled` n'est envoyé que sur choix explicite (sinon le serveur suit la motivation).
 */

type SyncedField = "motivation" | "entourage" | "selfLevel" | "dailyGoalMin" | "reminder";
const ALL_FIELDS: readonly SyncedField[] = ["motivation", "entourage", "selfLevel", "dailyGoalMin", "reminder"];

export function reminderHourOf(reminder: Profile["reminder"]): number | null {
  return reminder === null || reminder === "none" ? null : defaultHour(reminder);
}

export function profilePatchFrom(profile: Profile, fields: readonly SyncedField[] = ALL_FIELDS): ProfilePatch {
  const patch: ProfilePatch = {};
  for (const field of fields) {
    switch (field) {
      case "motivation":
        patch.motivation = profile.motivation;
        if (profile.motivation) patch.pathVariant = profile.motivation;
        break;
      case "entourage":
        patch.entourage = profile.entourage;
        break;
      case "selfLevel":
        patch.selfLevel = profile.selfLevel;
        break;
      case "dailyGoalMin":
        patch.dailyGoalMin = profile.dailyGoalMin;
        break;
      case "reminder":
        patch.reminderHour = reminderHourOf(profile.reminder);
        break;
    }
  }
  if (fields.length === ALL_FIELDS.length) patch.interfaceLocale = usePrefs.getState().locale ?? getLocale();
  return patch;
}

/** Changement de réglage : seuls les champs modifiés partent (file hors ligne comprise). */
export function syncProfileChange(previous: Profile | null, next: Profile): Promise<void> {
  const fields = ALL_FIELDS.filter((f) => previous?.[f] !== next[f]);
  if (fields.length === 0) return Promise.resolve();
  return queueProfilePatch(profilePatchFrom(next, fields));
}

export function syncInterfaceLocale(locale: "fr" | "en" | null): Promise<void> {
  return queueProfilePatch({ interfaceLocale: locale ?? getLocale() });
}
