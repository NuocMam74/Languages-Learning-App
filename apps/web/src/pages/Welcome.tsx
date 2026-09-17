import type { ContentIndex } from "@parlo/core";
import { useNavigate } from "react-router";
import { playPath } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { Card, DeltaDawn, Icon, Illustration, staggerStyle } from "../design/index.ts";
import { getLocale, l, t } from "../i18n/index.ts";
import { usePrefs } from "../prefs.ts";

/**
 * Première ouverture (spec §4.1.1) : ce qu'est Parlo en trois phrases, la langue entendue
 * tout de suite, puis le choix de la langue à apprendre. L'interface est en français par
 * défaut ; la bascule vers l'anglais est offerte ici, avant tout le reste.
 *
 * Le delta au lever du jour ouvre l'écran (contrat phase8 §1) : c'est la promesse en une image,
 * avant la première phrase. Ratio fixe — le dessin ne décale rien en arrivant (CLS).
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
            className="min-h-11 rounded-chip px-3 text-sm font-semibold text-ngoc underline-offset-4 transition-transform hover:underline motion-safe:active:scale-[.98]"
          >
            {locale === "fr" ? t("welcome.locale.switch") : t("welcome.locale.back")}
          </button>
        </div>
      }
      action={<Button onClick={() => navigate("/langue")}>{t("welcome.start")}</Button>}
    >
      <div className="flex flex-1 flex-col justify-center gap-6">
        {/* Seule animation orchestrée de l'écran : le delta se pose, puis le titre, puis l'écoute. */}
        <Illustration className="mx-auto max-w-[20rem] motion-safe:parlo-enter">
          <DeltaDawn />
        </Illustration>

        <header className="flex flex-col gap-1 text-center motion-safe:parlo-enter" style={staggerStyle(1)}>
          <h1 className="font-serif text-2xl leading-none text-ngoc">Parlo</h1>
          <p className="text-lg text-balance">{t("welcome.tagline")}</p>
        </header>

        {/* L'oreille avant l'œil (spec §4.1.1) : la langue s'entend avant toute explication. */}
        {welcome && (
          <Card tone="raised" as="section" className="flex flex-col items-center gap-3 motion-safe:parlo-enter" data-testid="welcome-listen">
            <p className="text-sm text-phu-sa">{t("welcome.listen")}</p>
            {/* Lecture auto bloquée par les navigateurs sans geste : le bouton est l'invitation. */}
            <AudioButton play={() => playPath(content, welcome.audio, welcome.vi, true)} autoPlay={false} withSlow={false} large={false} />
            <div className="flex flex-col gap-1 text-center">
              <Vi size="2xl">{welcome.vi}</Vi>
              <p className="text-sm text-phu-sa">{l(welcome.translation)}</p>
            </div>
          </Card>
        )}

        <ul className="flex flex-col gap-2.5">
          {[...promises, t("welcome.noAlphabet")].map((promise, i) => (
            <li key={promise} className="flex items-start gap-3 text-sm motion-safe:parlo-enter" style={staggerStyle(i + 2)}>
              {/* Pastille jade : la coche se lit comme une promesse tenue, pas comme une case à cocher. */}
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ngoc-sang text-ngoc">
                <Icon name="check" size={13} strokeWidth={3} />
              </span>
              <span>{promise}</span>
            </li>
          ))}
        </ul>
      </div>
    </Screen>
  );
}
