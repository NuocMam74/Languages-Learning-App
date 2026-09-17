import type { ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { Card, Chip, Icon, SectionTitle, staggerStyle } from "../design/index.ts";
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
 *
 * Deuxième écran de la découverte (contrat phase8 §1) : le nom de la langue est l'objet visuel,
 * en serif et en grand. Ce qui n'est pas encore là se lit « bientôt », jamais comme une panne.
 */
// Langues annoncées (signal produit). L'espagnol reste une preuve d'extensibilité interne : pas annoncé.
const ANNOUNCED = ["vi-north", "th", "km"] as const;

export default function LanguageChoice({ content }: { content: ContentIndex }) {
  const navigate = useNavigate();
  const choices = usePackChoices(content.pack);
  const [selected, setSelected] = useState(content.pack.code);
  const [busy, setBusy] = useState(false);
  const [interest, setInterest] = useState<Record<string, boolean>>({});
  // Pack en préparation masqué (contrat phase5 §5) : il reste annoncé « bientôt ».
  const comingSoon = ANNOUNCED.filter((code) => !isAvailablePack(code) || !choices.some((c) => c.code === code));

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
        navigate(onboarded ? "/apprendre" : "/onboarding");
      } else {
        // Nouveau contenu, nouvelles données : on repart d'un démarrage propre (marche hors ligne, service worker).
        window.location.assign(onboarded ? "/apprendre" : "/onboarding");
      }
    } catch {
      setBusy(false);
    }
  };

  return (
    <Screen action={<Button disabled={busy} onClick={() => void proceed()}>{busy ? t("packs.switching") : t("language.continue")}</Button>}>
      <h1 className="mt-6 flex items-center gap-3 font-serif text-2xl text-balance">
        <Icon name="globe" size={28} className="shrink-0 text-ngoc" />
        {t("chooseLang.title")}
      </h1>

      <div className="mt-8 flex flex-col gap-2">
        <div role="radiogroup" aria-label={t("chooseLang.title")} className="flex flex-col gap-2.5">
          {choices.map((choice, i) => {
            const checked = choice.code === selected;
            return (
              <button
                key={choice.code}
                type="button"
                role="radio"
                aria-checked={checked}
                data-pack={choice.code}
                onClick={() => setSelected(choice.code)}
                style={staggerStyle(i)}
                className={`flex min-h-[4.5rem] w-full items-center justify-between gap-4 rounded-card px-5 py-3 text-left transition-[background-color,border-color,transform] motion-safe:parlo-enter motion-safe:active:scale-[.99] ${
                  checked ? "border-2 border-ngoc bg-ngoc-sang shadow-card" : "border border-line bg-surface shadow-card"
                }`}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-serif text-lg">{choice.name ? l(choice.name) : choice.code}</span>
                  {!choice.name && <span className="text-sm text-phu-sa">{t("packs.unavailableOffline")}</span>}
                </span>
                {/* Pastille jade pleine : le choix se lit de loin, pas seulement au liseré. */}
                <span className={`grid size-7 shrink-0 place-items-center rounded-full ${checked ? "bg-ngoc text-nuoc" : "border border-line-strong"}`}>
                  {checked && <Icon name="check" size={16} strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>

        {comingSoon.length > 0 && (
          <section aria-labelledby="lang-soon" className="mt-8 flex flex-col gap-2">
            <SectionTitle id="lang-soon" icon="clock">{t("language.soonTitle")}</SectionTitle>
            <Card tone="quiet">
              <ul className="flex flex-col divide-y divide-line">
                {comingSoon.map((code) => (
                  <li key={code} className="flex min-h-14 items-center justify-between gap-4 py-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-serif text-lg text-phu-sa">{t(`language.name.${code}` as MessageKey)}</span>
                      <Chip tone="nghe">{t("chooseLang.soon")}</Chip>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={interest[code] === true}
                      onClick={() => toggle(code)}
                      className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-[background-color,border-color,transform] motion-safe:active:scale-[.98] ${
                        interest[code] ? "border-ngoc bg-ngoc text-nuoc" : "border-line-strong bg-surface text-ngoc"
                      }`}
                    >
                      {interest[code] && <Icon name="check" size={14} strokeWidth={3} />}
                      {interest[code] ? t("language.notifyOn") : t("language.notify")}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>
    </Screen>
  );
}
