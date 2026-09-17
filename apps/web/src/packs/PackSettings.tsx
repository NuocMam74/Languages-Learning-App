import { useState } from "react";
import { Icon } from "../design/index.ts";
import { l, t } from "../i18n/index.ts";
import { activePackCode } from "./active.ts";
import { isOnboarded, switchPack } from "./switch.ts";
import { usePackChoices } from "./use-packs.ts";

/**
 * Réglages : langue apprise (ADR 0006). Changer recharge l'app sur le pack choisi.
 *
 * La langue active n'est pas signalée par un simple liseré : fond jade clair et coche, pour qu'on
 * voie d'un coup d'œil sur quoi on travaille (contrat phase8 §1).
 */
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
    <div className="flex flex-col gap-3">
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
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-field border px-4 transition-[background-color,border-color,transform] motion-safe:active:scale-[.98] disabled:opacity-50 ${
              choice.code === active ? "border-ngoc bg-ngoc-sang font-semibold text-ngoc" : "border-line-strong bg-surface-2 text-phu-sa"
            }`}
          >
            {choice.code === active && <Icon name="check" size={16} strokeWidth={2.5} />}
            {choice.name ? l(choice.name) : choice.code}
          </button>
        ))}
      </div>
      <p className="text-sm text-phu-sa">{busy ? t("packs.switching") : t("packs.settings.hint")}</p>
    </div>
  );
}
