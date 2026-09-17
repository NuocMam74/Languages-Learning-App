import type { ContentIndex } from "@parlo/core";
import { nextLesson } from "@parlo/core";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Screen } from "../components/ui.tsx";
import type { Profile } from "../db.ts";
import { Icon, ProgressBar, staggerStyle } from "../design/index.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { DEFAULT_PROFILE, saveProfile } from "../learner.ts";
import { playablePlacementFor } from "../packs/placement.ts";
import { syncProfileChange } from "../profile-sync.ts";

/**
 * 5 questions, une par écran, réponses en gros boutons (spec §4.1.3).
 *
 * C'est la première impression (contrat phase8 §1) : une question en serif, des réponses assez
 * grandes pour le pouce, et une barre qui avance d'une question à l'autre — le seul mouvement
 * héroïque de l'écran. Les réponses restent les **premiers boutons de la page** : rien ne
 * s'intercale entre la question et le geste.
 */

interface Question<K extends keyof Profile> {
  field: K;
  title: MessageKey;
  options: { value: NonNullable<Profile[K]>; label: string }[];
}

const q = <K extends keyof Profile>(field: K, title: MessageKey, values: NonNullable<Profile[K]>[], label: (v: NonNullable<Profile[K]>) => string): Question<K> => ({
  field,
  title,
  options: values.map((value) => ({ value, label: label(value) })),
});

const QUESTIONS = [
  q("motivation", "onboarding.why", ["family", "travel", "work", "roots", "curiosity"], (v) => t(`onboarding.why.${v}` as MessageKey)),
  q("entourage", "onboarding.who", ["nobody", "partner", "parents", "colleagues"], (v) => t(`onboarding.who.${v}` as MessageKey)),
  q("selfLevel", "onboarding.level", ["none", "words", "understand", "speak"], (v) => t(`onboarding.level.${v}` as MessageKey)),
  q("dailyGoalMin", "onboarding.minutes", [5, 10, 15, 20], (v) => t("onboarding.minutes.value", { n: v })),
  q("reminder", "onboarding.reminder", ["morning", "noon", "evening", "none"], (v) => t(`onboarding.reminder.${v}` as MessageKey)),
];

export function Onboarding({ content, onDone }: { content: ContentIndex; onDone: (profile: Profile) => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const question = QUESTIONS[index];
  if (!question) return null;

  const choose = async (value: unknown) => {
    const updated = { ...profile, [question.field]: value } as Profile;
    if (index < QUESTIONS.length - 1) {
      setProfile(updated);
      setIndex(index + 1);
      return;
    }
    const final = { ...updated, onboardedAt: new Date().toISOString() };
    await saveProfile(final);
    // Compte déjà connecté (autre langue, nouvel appareil) : réponses envoyées au serveur (contrat phase5 §4).
    void syncProfileChange(null, final).catch(() => undefined);
    onDone(final);
    // Mini-test de placement optionnel (spec §4.1.4), puis première leçon avant tout compte (§4.1.5).
    // Seulement si le pack fournit un placement.json avec au moins 6 items jouables (contrat phase5 §1).
    const placement = playablePlacementFor(content) !== null && content.lessons.size > 0;
    const first = nextLesson(content.curriculum, content.lessons, new Set(), final.motivation);
    navigate(placement ? "/placement" : first ? `/lecon/${first.id}` : "/", { replace: true });
  };

  return (
    <Screen
      top={
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex min-h-11 items-center gap-3">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-phu-sa transition-[background-color,transform] hover:bg-phu-sa/8 motion-safe:active:scale-[.98]"
                aria-label={t("common.back")}
              >
                <Icon name="chevronLeft" />
              </button>
            )}
            <p className="text-sm text-phu-sa">{t("onboarding.step", { i: index + 1, n: QUESTIONS.length })}</p>
          </div>
          {/* La barre avance d'un cran par question : on voit combien il reste, sans compter. */}
          <ProgressBar value={index + 1} max={QUESTIONS.length} size="sm" label={t("onboarding.step", { i: index + 1, n: QUESTIONS.length })} />
        </div>
      }
    >
      {/* `key` sur la question : chaque écran rejoue son entrée, la précédente ne traîne pas. */}
      <div key={index} className="flex flex-1 flex-col">
        <h1 className="mt-6 font-serif text-2xl text-balance motion-safe:parlo-enter">{t(question.title)}</h1>
        <div className="mt-auto flex flex-col gap-2.5 pb-6">
          {question.options.map((option, i) => {
            const chosen = profile[question.field] === option.value;
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => void choose(option.value)}
                style={staggerStyle(i)}
                className={`flex min-h-16 w-full items-center gap-3 rounded-card border px-5 py-3 text-left text-lg transition-[background-color,border-color,transform] motion-safe:parlo-enter motion-safe:active:scale-[.99] ${
                  chosen ? "border-2 border-ngoc bg-ngoc-sang font-semibold" : "border-line bg-surface shadow-card hover:border-ngoc/40"
                }`}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {chosen && <Icon name="check" size={20} className="text-ngoc" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}
