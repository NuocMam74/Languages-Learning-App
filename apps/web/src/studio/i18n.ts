import { getLocale } from "../i18n/index.ts";
import { en, fr } from "../i18n/messages/studio.ts";

/**
 * Chaînes du studio. Volontairement hors du registre global (i18n/messages/index.ts) : le dictionnaire
 * n'est chargé qu'avec le studio (et la page Réglages pour le lien), pas dans le bundle de l'apprenant.
 */

export type StudioKey = keyof typeof fr;

export function st(key: StudioKey, vars: Record<string, string | number> = {}): string {
  const template = (getLocale() === "en" ? en[key] : undefined) ?? fr[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
