/**
 * Pack actif (langue apprise) et portée des données locales par pack (ADR 0006).
 * Module sans dépendance (importé par db.ts) : l'état vit en mémoire, il est lu depuis
 * IndexedDB au démarrage par `loadActivePack` (packs/switch.ts).
 */

declare const __PACKS__: Record<string, number>;

/**
 * Configuration produit, pas du moteur : pack proposé par défaut à la première ouverture,
 * et propriétaire des données locales écrites avant la Phase 3 (app mono-pack).
 */
export const DEFAULT_PACK = "vi-south";

let active = DEFAULT_PACK;

export function activePackCode(): string {
  return active;
}

export function setActivePackCode(code: string): void {
  active = code;
}

let activeLang: string | null = null;

/** Code BCP 47 de la langue cible du pack actif (attribut `lang` du texte appris), connu une fois le pack chargé. */
export function activePackLang(): string | null {
  return activeLang;
}

export function setActivePackLang(lang: string | null): void {
  activeLang = lang;
}

/** Packs embarqués dans ce build (manifeste injecté par Vite), le pack par défaut en tête. */
export function availablePacks(): string[] {
  const codes = Object.keys(__PACKS__);
  return [...codes.filter((c) => c === DEFAULT_PACK), ...codes.filter((c) => c !== DEFAULT_PACK).sort()];
}

export function isAvailablePack(code: unknown): code is string {
  return typeof code === "string" && Object.hasOwn(__PACKS__, code);
}

/** Clés `kv` propres à une langue : profil (onboarding), totaux, badges, placement, records… */
const PACK_SCOPED_KEYS: ReadonlySet<string> = new Set(["profile", "totals", "badges", "placement", "toneLog", "southLog", "cultureCards"]);
const PACK_SCOPED_PREFIXES = ["games.", "karaoke.", "exams."] as const;

export function isPackScopedKey(key: string): boolean {
  return PACK_SCOPED_KEYS.has(key) || PACK_SCOPED_PREFIXES.some((p) => key.startsWith(p));
}

/** `totals` → `es:totals` pour une clé propre au pack ; les clés globales (compte, préférences) restent telles quelles. */
export function scopedKey(key: string, pack: string = active): string {
  return isPackScopedKey(key) ? `${pack}:${key}` : key;
}

/** Pack d'une leçon : les ids de leçon commencent par le code du pack (vérifié par content:validate). */
export function packOfLesson(lessonId: string): string {
  return lessonId.slice(0, Math.max(0, lessonId.indexOf("."))) || active;
}
