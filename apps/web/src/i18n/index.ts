import type { Localized, Tone } from "@parlo/core";
import { localize } from "@parlo/core";
import { usePrefs } from "../prefs.ts";
import { modules } from "./messages/index.ts";

/**
 * Chaînes d'interface uniquement. Le contenu pédagogique vient des packs
 * (ADR 0002) ; rien ici ne doit enseigner la langue.
 */

type Module = (typeof modules)[number];
type FrOf<M> = M extends { fr: infer F } ? F : never;
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type Fr = UnionToIntersection<FrOf<Module>>;

export type MessageKey = keyof Fr & string;

const fr = Object.assign({}, ...modules.map((m) => m.fr)) as Record<MessageKey, string>;
const en = Object.assign({}, ...modules.map((m) => ("en" in m ? m.en : {}))) as Partial<Record<MessageKey, string>>;

const dictionaries: Record<string, Partial<Record<MessageKey, string>>> = { fr, en };

export function getLocale(): "fr" | "en" {
  const chosen = usePrefs.getState().locale;
  if (chosen) return chosen;
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : navigator.language ? "en" : "fr";
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}, locale = getLocale()): string {
  const template = dictionaries[locale]?.[key] ?? fr[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function plural(key: MessageKey, pluralKey: MessageKey, n: number): string {
  return t(n > 1 ? pluralKey : key, { n });
}

export function toneLabel(tones: readonly Tone[]): string {
  if (tones.length === 2 && tones.includes("hoi") && tones.includes("nga")) return t("tone.hoi_nga");
  return tones.map((tone) => t(`tone.${tone}` as MessageKey)).join(" / ");
}

export function l(text: Localized | null | undefined): string {
  return text ? localize(text, getLocale()) : "";
}
