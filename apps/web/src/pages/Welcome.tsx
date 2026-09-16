import type { ContentIndex } from "@parlo/core";
import { useNavigate } from "react-router";
import { playPath } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { getLocale, l, t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";

/**
 * Première ouverture (spec §4.1.1) : ce qu'est Parlo en trois phrases, la langue entendue
 * tout de suite, puis le choix de la langue à apprendre. L'interface est en français par
 * défaut ; la bascule vers l'anglais est offerte ici, avant tout le reste.
 */
export function Welcome({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const welcome = content.pack.welcome;
  const setLocale = usePrefs((s) => s.setLocale);
  const locale = getLocale();

  const promises = [t("welcome.promise.works"), t("welcome.promise.short"), t("welcome.promise.south")];

  return (
    <Screen
      top={
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
            className="min-h-11 rounded-xl px-3 text-sm font-semibold text-ngoc underline-offset-4 hover:underline"
          >
            {locale === "fr" ? t("welcome.locale.switch") : t("welcome.locale.back")}
          </button>
        </div>
      }
      action={<Button onClick={() => navigate("/langue")}>{t("welcome.start")}</Button>}
    >
      <div className="flex flex-1 flex-col justify-center gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl leading-none text-ngoc">Parlo</h1>
          <p className="text-lg">{t("welcome.tagline")}</p>
        </header>

        {/* L'oreille avant l'œil (spec §4.1.1) : la langue s'entend avant toute explication. */}
        {welcome && (
          <section className="flex flex-col items-center gap-3">
            <p className="text-sm text-phu-sa">{t("welcome.listen")}</p>
            {/* Lecture auto bloquée par les navigateurs sans geste : le bouton est l'invitation. */}
            <AudioButton play={() => playPath(content, welcome.audio, welcome.vi, true)} autoPlay={false} withSlow={false} large={false} />
            <div className="flex flex-col gap-1 text-center">
              <Vi size="2xl">{welcome.vi}</Vi>
              <p className="text-sm text-phu-sa">{l(welcome.translation)}</p>
            </div>
          </section>
        )}

        <ul className="flex flex-col gap-2 border-t border-phu-sa/10 pt-5">
          {[...promises, t("welcome.noAlphabet")].map((promise) => (
            <li key={promise} className="flex gap-3 text-sm">
              <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0 text-nghe" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>{promise}</span>
            </li>
          ))}
        </ul>
      </div>
    </Screen>
  );
}
