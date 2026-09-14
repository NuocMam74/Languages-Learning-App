import type { ContentIndex } from "@parlo/core";
import { nextLesson } from "@parlo/core";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Screen } from "../components/ui.tsx";
import type { Profile } from "../db.ts";
import { t, type MessageKey } from "../i18n.ts";
import { DEFAULT_PROFILE, saveProfile } from "../learner.ts";

/** 5 questions, une par écran, réponses en gros boutons (spec §4.1.3). */

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
    onDone(final);
    // Première leçon immédiatement, avant toute création de compte (spec §4.1.5).
    const first = nextLesson(content.curriculum, content.lessons, new Set(), final.motivation);
    navigate(first ? `/lecon/${first.id}` : "/", { replace: true });
  };

  return (
    <Screen
      top={
        <div className="flex items-center gap-3 pt-2">
          {index > 0 && (
            <button type="button" onClick={() => setIndex(index - 1)} className="grid size-11 place-items-center text-phu-sa" aria-label={t("common.back")}>
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
            </button>
          )}
          <p className="text-sm text-phu-sa">{t("onboarding.step", { i: index + 1, n: QUESTIONS.length })}</p>
        </div>
      }
    >
      <h1 className="mt-6 font-serif text-2xl">{t(question.title)}</h1>
      <div className="mt-auto flex flex-col gap-3 pb-6">
        {question.options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => void choose(option.value)}
            className={`min-h-16 rounded-2xl border-2 px-5 text-left text-lg transition-colors ${
              profile[question.field] === option.value ? "border-ngoc bg-ngoc-sang" : "border-phu-sa/15 bg-white/70 hover:border-ngoc/40"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Screen>
  );
}
