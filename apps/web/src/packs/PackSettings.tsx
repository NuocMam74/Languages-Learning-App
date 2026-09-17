import { useState } from "react";
import { l, t } from "../i18n/index.ts";
import { activePackCode } from "./active.ts";
import { isOnboarded, switchPack } from "./switch.ts";
import { usePackChoices } from "./use-packs.ts";

/** Réglages : langue apprise (ADR 0006). Changer recharge l'app sur le pack choisi. */
export function PackSettings() {
  const choices = usePackChoices();
  const active = activePackCode();
  const [busy, setBusy] = useState(false);

  const choose = async (code: string) => {
    if (code === active || busy) return;
    setBusy(true);
    try {
      await switchPack(code);
      window.location.assign((await isOnboarded(code)) ? "/apprendre" : "/onboarding");
    } catch {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Grille à 2 colonnes sur téléphone : hauteur stable quand la police arrive (CLS). */}
      <div role="radiogroup" aria-label={t("packs.settings.title")} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {choices.map((choice) => (
          <button
            key={choice.code}
            type="button"
            role="radio"
            aria-checked={choice.code === active}
            data-pack={choice.code}
            disabled={busy || (!choice.name && choice.code !== active)}
            onClick={() => void choose(choice.code)}
            className={`min-h-11 rounded-xl border-2 px-4 ${choice.code === active ? "border-ngoc bg-ngoc-sang font-semibold" : "border-phu-sa/15 bg-white/70"}`}
          >
            {choice.name ? l(choice.name) : choice.code}
          </button>
        ))}
      </div>
      <p className="text-sm text-phu-sa">{busy ? t("packs.switching") : t("packs.settings.hint")}</p>
    </>
  );
}
