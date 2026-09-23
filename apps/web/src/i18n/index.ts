import type { Localized, Tone } from "@parlo/core";
import { localize } from "@parlo/core";
import { usePrefs } from "../prefs.ts";
import type { modules } from "./messages/index.ts";

/**
 * Chaînes d'interface uniquement. Le contenu pédagogique vient des packs
 * (ADR 0002) ; rien ici ne doit enseigner la langue.
 *
 * Chargement découpé (audit mobile P1 #6) : chaque fichier de messages/ est importé par langue
 * (`?lang=fr` / `?lang=en`, vite-plugin-i18n.ts n'en garde qu'une). Les domaines du premier
 * affichage (accueil, hub, séance) sont en français dans le bundle initial ; les autres domaines,
 * et l'anglais, arrivent par `ensureMessages()` avant d'afficher l'écran qui les utilise.
 * `t()` reste synchrone.
 */

type Module = (typeof modules)[number];
type FrOf<M> = M extends { fr: infer F } ? F : never;
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type Fr = UnionToIntersection<FrOf<Module>>;

export type MessageKey = keyof Fr & string;
export type AppLocale = "fr" | "en";
type Table = Partial<Record<MessageKey, string>>;

// Premier affichage : Welcome, Onboarding, accueil, Hub (et ses cartes), séance. Liste littérale (import.meta.glob).
const bootFr = import.meta.glob(
  [
    "./messages/base.ts",
    "./messages/dashboard.ts",
    "./messages/session.ts",
    "./messages/journey.ts",
    "./messages/badges.ts",
    "./messages/exams.ts",
    "./messages/packs.ts",
    "./messages/settings.ts",
    "./messages/social.ts",
    "./messages/tutor.ts",
    "./messages/notifications.ts",
    "./messages/challenges.ts",
    "./messages/missions.ts",
    "./messages/mobile.ts",
    "./messages/offline.ts",
    // Le parcours porte désormais la carte des chiffres (`stats`) et la visite en bulles
    // (`discovery`) — contrat phase26 §7 et §8. Le hub se rend dès le démarrage, avant que
    // `ensureMessages("all")` n'ait fini, et rien ne le re-rend ensuite : chargées à la demande,
    // ces chaînes restaient vides (titre et lien de la carte, bulles, nom du bouton « ? »).
    "./messages/stats.ts",
    "./messages/discovery.ts",
  ],
  { eager: true, query: { lang: "fr" }, import: "fr" },
) as Record<string, Table>;

const lazyFr = import.meta.glob(
  [
    "./messages/*.ts",
    "!./messages/index.ts",
    "!./messages/studio.ts",
    "!./messages/base.ts",
    "!./messages/dashboard.ts",
    "!./messages/session.ts",
    "!./messages/journey.ts",
    "!./messages/badges.ts",
    "!./messages/exams.ts",
    "!./messages/packs.ts",
    "!./messages/settings.ts",
    "!./messages/social.ts",
    "!./messages/tutor.ts",
    "!./messages/notifications.ts",
    "!./messages/challenges.ts",
    "!./messages/missions.ts",
    "!./messages/mobile.ts",
    "!./messages/offline.ts",
    "!./messages/stats.ts",
    "!./messages/discovery.ts",
  ],
  { query: { lang: "fr" }, import: "fr" },
) as Record<string, () => Promise<Table>>;

const lazyEn = import.meta.glob(["./messages/*.ts", "!./messages/index.ts", "!./messages/studio.ts"], { query: { lang: "en" }, import: "en" }) as Record<
  string,
  () => Promise<Table | undefined>
>;

const domainOf = (path: string) => path.replace(/^.*\/([^/]+)\.ts$/, "$1");

const fr: Table = Object.assign({}, ...Object.values(bootFr));
const en: Table = {};
const dictionaries: Record<AppLocale, Table> = { fr, en };
/** Domaines chargés par langue. */
const ready: Record<AppLocale, Set<string>> = { fr: new Set(Object.keys(bootFr).map(domainOf)), en: new Set() };
const inflight = new Map<string, Promise<void>>();

function loadDomain(locale: AppLocale, path: string): Promise<void> {
  const domain = domainOf(path);
  if (ready[locale].has(domain)) return Promise.resolve();
  const key = `${locale}:${domain}`;
  const running = inflight.get(key);
  if (running) return running;
  const loader = locale === "fr" ? lazyFr[path] : lazyEn[path];
  if (!loader) return Promise.resolve();
  const task = loader()
    .then((table) => {
      Object.assign(dictionaries[locale], table ?? {});
      ready[locale].add(domain);
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/** Domaines de l'écran d'accueil et du hub (chargés en anglais avant le premier rendu si besoin). */
const BOOT_PATHS = Object.keys(bootFr);

/**
 * Charge les chaînes d'une langue : `"boot"` (premier affichage) ou `"all"` (tout écran chargé à la
 * demande). Le français, langue de repli, est toujours complété aussi.
 */
export function ensureMessages(scope: "boot" | "all" = "all", locale: AppLocale = getLocale()): Promise<void> {
  const enPaths = scope === "boot" ? Object.keys(lazyEn).filter((p) => BOOT_PATHS.includes(p)) : Object.keys(lazyEn);
  const frPaths = scope === "boot" ? [] : Object.keys(lazyFr);
  return Promise.all([...frPaths.map((p) => loadDomain("fr", p)), ...(locale === "en" ? enPaths.map((p) => loadDomain("en", p)) : [])]).then(() => undefined);
}

/** Les chaînes nécessaires sont-elles déjà là (pas d'attente, pas de clignotement) ? */
export function messagesReady(scope: "boot" | "all" = "all", locale: AppLocale = getLocale()): boolean {
  const frOk = scope === "boot" || Object.keys(lazyFr).every((p) => ready.fr.has(domainOf(p)));
  const enOk = locale !== "en" || (scope === "boot" ? BOOT_PATHS : Object.keys(lazyEn)).every((p) => ready.en.has(domainOf(p)));
  return frOk && enOk;
}

export function getLocale(): AppLocale {
  const chosen = usePrefs.getState().locale;
  if (chosen) return chosen;
  // Français par défaut, quelle que soit la langue de l'appareil (public visé : francophone).
  // L'anglais ne s'active que par choix explicite (bascule de l'accueil ou réglages), mémorisé.
  return "fr";
}

/**
 * Langue du document = langue d'interface (lecteurs d'écran : voix anglaise en anglais). index.html fixe
 * `lang="fr"` ; appliqué au démarrage et à chaque changement de langue. Le texte appris garde son propre `lang`.
 */
function applyDocumentLocale(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const locale = getLocale();
  if (root.lang !== locale) root.lang = locale;
  if (root.dir !== "ltr") root.dir = "ltr";
}
applyDocumentLocale();
usePrefs.subscribe(applyDocumentLocale);

let warned = false;

export function t(key: MessageKey, vars: Record<string, string | number> = {}, locale = getLocale()): string {
  const template = dictionaries[locale]?.[key] ?? fr[key];
  if (template === undefined) {
    // Domaine pas encore chargé : jamais la clé brute à l'écran ; tout est chargé pour la suite.
    void ensureMessages("all", locale);
    if (import.meta.env.DEV && !warned) {
      warned = true;
      console.warn(`[i18n] « ${key} » affichée avant le chargement de son domaine : appeler ensureMessages() avant l'écran.`);
    }
    return "";
  }
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
