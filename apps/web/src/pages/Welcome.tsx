import type { ContentIndex } from "@parlo/core";
import { useNavigate } from "react-router";
import { playPath } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { l, t } from "../i18n.ts";

/** Première ouverture : on entend la langue avant tout (spec §4.1.1). */
export function Welcome({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const welcome = content.pack.welcome;

  return (
    <Screen action={<Button onClick={() => navigate("/onboarding")}>{t("welcome.start")}</Button>}>
      <div className="flex flex-1 flex-col justify-center gap-10">
        {welcome && (
          <>
            {/* Lecture auto bloquée par les navigateurs sans geste : le bouton est l'invitation. */}
            <AudioButton play={() => playPath(content, welcome.audio, welcome.vi, true)} autoPlay={false} withSlow={false} />
            <div className="flex flex-col gap-4 text-center">
              <Vi size="vi">{welcome.vi}</Vi>
              <p className="text-lg text-phu-sa">{l(welcome.translation)}</p>
            </div>
          </>
        )}
        <p className="text-center text-phu-sa">{t("welcome.noAlphabet")}</p>
      </div>
    </Screen>
  );
}
