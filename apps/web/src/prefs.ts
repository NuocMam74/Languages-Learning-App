import { create } from "zustand";

/**
 * Préférences d'affichage propres à l'appareil (langue d'interface, mode
 * silencieux). Lues de façon synchrone par l'i18n, donc en localStorage.
 */

export type InterfaceLocale = "fr" | "en";

/** Thème d'affichage (contrat phase9 §8) : « system » suit le réglage de l'appareil. */
export type ThemeChoice = "system" | "light" | "dark";

export interface PrefsValue {
  locale: InterfaceLocale | null;
  theme: ThemeChoice;
  /**
   * Sons de retour des exercices et des récompenses (contrat phase9 §5). Le mode silencieux les
   * coupe aussi : c'est le maître, celui-ci ne fait que les refuser séparément de la voix.
   */
  feedbackSounds: boolean;
  /** Mode silencieux : pas de lecture automatique, transcriptions affichées (spec §13). */
  silent: boolean;
  /**
   * Dictée vocale du navigateur pour parler à Cô Mai. Désactivée par défaut : la reconnaissance
   * vocale des navigateurs peut envoyer l'audio au service en ligne de leur éditeur (spec §14).
   */
  dictation: boolean;
}

interface PrefsState extends PrefsValue {
  setLocale: (locale: InterfaceLocale | null) => void;
  setTheme: (theme: ThemeChoice) => void;
  setFeedbackSounds: (on: boolean) => void;
  setSilent: (silent: boolean) => void;
  setDictation: (dictation: boolean) => void;
}

const KEY = "parlo.prefs";

/** Lues telles quelles : le transfert vers un autre appareil les emporte (contrat phase17 §1). */
export function readPrefs(): PrefsValue {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<PrefsValue>) : {};
    return {
      locale: parsed.locale === "fr" || parsed.locale === "en" ? parsed.locale : null,
      theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
      // Les sons accompagnent l'app depuis toujours : ils restent allumés tant qu'on ne les coupe pas.
      feedbackSounds: parsed.feedbackSounds !== false,
      silent: parsed.silent === true,
      dictation: parsed.dictation === true,
    };
  } catch {
    return { locale: null, theme: "system", feedbackSounds: true, silent: false, dictation: false };
  }
}

/** Écrites telles quelles, à l'import d'un transfert. Le store React se relit au prochain rendu. */
export function writePrefs(value: PrefsValue): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Stockage indisponible (navigation privée) : la préférence vaut pour la session.
  }
}

const pick = ({ locale, theme, feedbackSounds, silent, dictation }: PrefsValue): PrefsValue => ({ locale, theme, feedbackSounds, silent, dictation });

export const usePrefs = create<PrefsState>((set, get) => ({
  ...readPrefs(),
  setLocale(locale) {
    set({ locale });
    writePrefs({ ...pick(get()), locale });
  },
  setTheme(theme) {
    set({ theme });
    writePrefs({ ...pick(get()), theme });
  },
  setFeedbackSounds(feedbackSounds) {
    set({ feedbackSounds });
    writePrefs({ ...pick(get()), feedbackSounds });
  },
  setSilent(silent) {
    set({ silent });
    writePrefs({ ...pick(get()), silent });
  },
  setDictation(dictation) {
    set({ dictation });
    writePrefs({ ...pick(get()), dictation });
  },
}));

export function clearPrefs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // rien à effacer
  }
  usePrefs.setState({ locale: null, theme: "system", feedbackSounds: true, silent: false, dictation: false });
}
