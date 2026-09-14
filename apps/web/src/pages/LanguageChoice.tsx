import type { ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { getLanguageInterest, setLanguageInterest } from "../learner.ts";

/**
 * Choix de la langue à apprendre (spec §4.1.2). Seul le pack chargé est actif ;
 * les autres sont annoncés « bientôt » avec « Me prévenir », stocké localement
 * comme signal produit (envoyé plus tard).
 */
const COMING_SOON = ["vi-north", "th", "km", "es"] as const;

export default function LanguageChoice({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const [interest, setInterest] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void getLanguageInterest().then(setInterest);
  }, []);

  const toggle = (code: string) => {
    const next = { ...interest, [code]: !interest[code] };
    setInterest(next);
    void setLanguageInterest(next);
  };

  return (
    <Screen action={<Button onClick={() => navigate("/onboarding")}>{t("language.continue")}</Button>}>
      <h1 className="mt-6 font-serif text-2xl">{t("chooseLang.title")}</h1>

      <div className="mt-8 flex flex-col gap-2">
        <div role="radiogroup" aria-label={t("chooseLang.title")}>
          <button
            type="button"
            role="radio"
            aria-checked
            className="flex min-h-16 w-full items-center justify-between rounded-2xl border-2 border-ngoc bg-ngoc-sang px-5 text-left text-lg"
          >
            <span className="font-semibold">{l(content.pack.name)}</span>
            <svg viewBox="0 0 24 24" className="size-6 text-ngoc" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        </div>

        <h2 className="mt-8 text-phu-sa">{t("language.soonTitle")}</h2>
        <ul className="flex flex-col">
          {COMING_SOON.map((code) => (
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
      </div>
    </Screen>
  );
}
