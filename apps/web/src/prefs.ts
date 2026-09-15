import { create } from "zustand";

/**
 * Préférences d'affichage propres à l'appareil (langue d'interface, mode
 * silencieux). Lues de façon synchrone par l'i18n, donc en localStorage.
 */

export type InterfaceLocale = "fr" | "en";

interface PrefsValue {
  locale: InterfaceLocale | null;
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
  setSilent: (silent: boolean) => void;
  setDictation: (dictation: boolean) => void;
}

const KEY = "parlo.prefs";

function read(): PrefsValue {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<PrefsValue>) : {};
    return {
      locale: parsed.locale === "fr" || parsed.locale === "en" ? parsed.locale : null,
      silent: parsed.silent === true,
      dictation: parsed.dictation === true,
    };
  } catch {
    return { locale: null, silent: false, dictation: false };
  }
}

function write(value: PrefsValue): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Stockage indisponible (navigation privée) : la préférence vaut pour la session.
  }
}

const pick = ({ locale, silent, dictation }: PrefsValue): PrefsValue => ({ locale, silent, dictation });

export const usePrefs = create<PrefsState>((set, get) => ({
  ...read(),
  setLocale(locale) {
    set({ locale });
    write({ ...pick(get()), locale });
  },
  setSilent(silent) {
    set({ silent });
    write({ ...pick(get()), silent });
  },
  setDictation(dictation) {
    set({ dictation });
    write({ ...pick(get()), dictation });
  },
}));

export function clearPrefs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // rien à effacer
  }
  usePrefs.setState({ locale: null, silent: false, dictation: false });
}
