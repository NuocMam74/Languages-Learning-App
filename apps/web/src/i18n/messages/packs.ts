/** Plusieurs langues apprises (spec §9, ADR 0006). Les noms de langues viennent des pack.json. */
export const fr = {
  "packs.available": "Disponibles",
  "packs.change": "Changer de langue apprise",
  "packs.settings.title": "Langue apprise",
  "packs.settings.hint": "Chaque langue garde sa propre progression, sa série et ses badges sur cet appareil.",
  "packs.unavailableOffline": "Connecte-toi une fois pour télécharger cette langue.",
  "packs.switching": "Changement de langue…",
} as const;

export const en: Partial<Record<keyof typeof fr, string>> = {
  "packs.available": "Available",
  "packs.change": "Change the language you're learning",
  "packs.settings.title": "Language you're learning",
  "packs.settings.hint": "Each language keeps its own progress, streak and badges on this device.",
  "packs.unavailableOffline": "Go online once to download this language.",
  "packs.switching": "Switching language…",
};
