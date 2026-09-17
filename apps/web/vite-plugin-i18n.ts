import type { Plugin } from "vite";

/**
 * Découpage des chaînes d'interface par langue (audit mobile P1 #6). Un fichier de
 * src/i18n/messages/ exporte `fr` et `en` ; importé avec `?lang=fr` (ou `?lang=en`), ce module
 * distinct ne garde que l'export demandé : l'autre devient une constante inutilisée, retirée par
 * le tree-shaking. Le français n'embarque donc plus l'anglais, et inversement.
 */
export function i18nLocalePlugin(): Plugin {
  return {
    name: "parlo-i18n-locale",
    enforce: "pre",
    transform(code, id) {
      const match = /[\\/]i18n[\\/]messages[\\/][^\\/?]+\.ts\?(?:[^#]*&)?lang=(fr|en)(?:&|$)/.exec(id);
      if (!match) return null;
      const drop = match[1] === "fr" ? "en" : "fr";
      const pattern = new RegExp(`^export const ${drop}\\b`, "m");
      if (!pattern.test(code)) return null;
      return { code: code.replace(pattern, `const ${drop}`), map: null };
    },
  };
}
