import type { ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { getLanguageInterest, setLanguageInterest } from "../learner.ts";
import { isAvailablePack } from "../packs/active.ts";
import { isOnboarded, switchPack } from "../packs/switch.ts";
import { usePackChoices } from "../packs/use-packs.ts";

/**
 * Choix de la langue à apprendre (spec §4.1.2, ADR 0006). Tous les packs du build sont
 * sélectionnables ; changer de pack recharge l'app sur le contenu du nouveau pack
 * (onboarding propre à ce pack s'il n'a pas encore été fait). Les langues annoncées
 * sans pack restent « bientôt » avec « Me prévenir », stocké localement.
 */
const ANNOUNCED = ["vi-north", "th", "km", "es"] as const;

export default function LanguageChoice({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const choices = usePackChoices(content.pack);
  const [selected, setSelected] = useState(content.pack.code);
  const [busy, setBusy] = useState(false);
  const [interest, setInterest] = useState<Record<string, boolean>>({});
  const comingSoon = ANNOUNCED.filter((code) => !isAvailablePack(code));

  useEffect(() => {
    void getLanguageInterest().then(setInterest);
  }, []);

  const toggle = (code: string) => {
    const next = { ...interest, [code]: !interest[code] };
    setInterest(next);
    void setLanguageInterest(next);
  };

  const proceed = async () => {
    setBusy(true);
    try {
      // Premier choix ou changement : pack_switched part dans l'outbox (sans effet si rien ne change).
      await switchPack(selected);
      const onboarded = await isOnboarded(selected);
      if (selected === content.pack.code) {
        navigate(onboarded ? "/" : "/onboarding");
      } else {
        // Nouveau contenu, nouvelles données : on repart d'un démarrage propre (marche hors ligne, service worker).
        window.location.assign(onboarded ? "/" : "/onboarding");
      }
    } catch {
      setBusy(false);
    }
  };

  return (
    <Screen action={<Button disabled={busy} onClick={() => void proceed()}>{busy ? t("packs.switching") : t("language.continue")}</Button>}>
      <h1 className="mt-6 font-serif text-2xl">{t("chooseLang.title")}</h1>

      <div className="mt-8 flex flex-col gap-2">
        <div role="radiogroup" aria-label={t("chooseLang.title")} className="flex flex-col gap-2">
          {choices.map((choice) => {
            const checked = choice.code === selected;
            return (
              <button
                key={choice.code}
                type="button"
                role="radio"
                aria-checked={checked}
                data-pack={choice.code}
                onClick={() => setSelected(choice.code)}
                className={`flex min-h-16 w-full items-center justify-between rounded-2xl border-2 px-5 text-left text-lg ${checked ? "border-ngoc bg-ngoc-sang" : "border-phu-sa/15 bg-white/70"}`}
              >
                <span className="flex flex-col">
                  <span className="font-semibold">{choice.name ? l(choice.name) : choice.code}</span>
                  {!choice.name && <span className="text-sm text-phu-sa">{t("packs.unavailableOffline")}</span>}
                </span>
                {checked && (
                  <svg viewBox="0 0 24 24" className="size-6 text-ngoc" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {comingSoon.length > 0 && (
          <>
            <h2 className="mt-8 text-phu-sa">{t("language.soonTitle")}</h2>
            <ul className="flex flex-col">
              {comingSoon.map((code) => (
                <li key={code} className="flex min-h-14 items-center justify-between gap-4 border-b border-phu-sa/10 py-2">
                  <span>
                    {t(`language.name.${code}` as MessageKey)} <span className="text-sm text-phu-sa">· {t("chooseLang.soon")}</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={interest[code] === true}
                    onClick={() => toggle(code)}
                    className={`min-h-11 shrink-0 rounded-full border-2 px-4 text-sm font-semibold ${interest[code] ? "border-ngoc bg-ngoc text-nuoc" : "border-phu-sa/20 text-ngoc"}`}
                  >
                    {interest[code] ? t("language.notifyOn") : t("language.notify")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Screen>
  );
}
