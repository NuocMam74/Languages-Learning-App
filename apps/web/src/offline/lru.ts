/**
 * Quota des unités hors ligne (spec §8.1) : au-delà, les unités utilisées le moins récemment
 * sont retirées, jamais l'unité en cours. Logique pure (testée), appliquée par downloads.ts.
 */

export const DEFAULT_OFFLINE_QUOTA_BYTES = 200 * 1024 * 1024;

export interface LruEntry {
  key: string;
  bytes: number;
  lastUsedAt: string;
}

/**
 * Clés à purger pour revenir sous `quotaBytes` : du plus ancien au plus récent usage, en sautant
 * les clés protégées (unité en cours, téléchargement qui vient de finir). Si les seules unités
 * restantes sont protégées, le quota peut rester dépassé.
 */
export function selectLruPurge(entries: readonly LruEntry[], quotaBytes: number, protectedKeys: ReadonlySet<string> = new Set()): string[] {
  let total = entries.reduce((sum, e) => sum + Math.max(0, e.bytes), 0);
  if (total <= quotaBytes) return [];
  const candidates = entries
    .filter((e) => !protectedKeys.has(e.key))
    .sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt) || a.key.localeCompare(b.key));
  const purge: string[] = [];
  for (const entry of candidates) {
    if (total <= quotaBytes) break;
    purge.push(entry.key);
    total -= Math.max(0, entry.bytes);
  }
  return purge;
}

/** « ≈ 2,4 Mo » / « ≈ 2.4 MB » : taille lisible (Ko en dessous de 1 Mo, jamais 0). */
export function formatBytes(bytes: number, locale: "fr" | "en"): string {
  const units = locale === "fr" ? ["Ko", "Mo", "Go"] : ["KB", "MB", "GB"];
  let value = Math.max(bytes, 0) / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  const shown = Math.max(value, unit === 0 ? 1 : 0.1);
  return `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(shown)} ${units[unit]}`;
}
