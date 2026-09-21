import type { ChestTier } from "./collection.ts";
import type { CountersJournal, Period } from "./counters.ts";

/**
 * La quête de la semaine (contrat phase24 §4).
 *
 * Les missions hebdomadaires existantes demandent du **volume** (« 60 items », « 5 parties »). On
 * peut les boucler en une seule très longue séance le dimanche soir — donc elles ne donnent aucune
 * raison d'ouvrir l'application un mardi.
 *
 * La quête demande autre chose, et une seule : **des jours**. Trois paliers, trois, cinq, sept
 * jours de présence dans la semaine. C'est la seule mesure qui ne se rattrape pas, et c'est
 * exactement celle qui fait apprendre une langue — la fréquence bat la durée.
 *
 * Trois garde-fous, parce qu'une mécanique qui pousse à revenir peut vite devenir une mécanique
 * qui culpabilise (spec §5.8) :
 *
 *  - **un palier manqué ne retire rien.** Les paliers atteints restent réclamables jusqu'à la fin
 *    de la semaine ; ce qui n'est pas atteint est simplement absent, sans message ;
 *  - **le septième jour n'est pas obligatoire.** Le gros de la récompense est au cinquième : on
 *    récompense une habitude, pas l'absence de repos ;
 *  - **une journée compte dès qu'on a fait quelque chose**, pas dès qu'on a fait son objectif.
 *    Trois minutes dans le métro comptent comme une heure au calme.
 */

export interface QuestStep {
  /** `2026-W38:q5` — stable dans la semaine, différent d'une semaine à l'autre. */
  id: string;
  /** Jours de présence exigés dans la semaine. */
  days: number;
  coins: number;
  chest: ChestTier | null;
}

/**
 * Les trois paliers. Le **plus gros saut est celui du cinquième jour** (+90 xu, et le coffre), pas
 * celui du septième (+60) : c'est au cinquième que l'habitude est prise. Récompenser le sans-faute
 * hebdomadaire plus fort que la régularité reviendrait à punir un jour de repos.
 */
const STEPS: readonly { days: number; coins: number; chest: ChestTier | null }[] = [
  { days: 3, coins: 40, chest: null },
  { days: 5, coins: 130, chest: "lacquer" },
  { days: 7, coins: 190, chest: "jade" },
];

export const QUEST_TARGET_DAYS = STEPS.map((step) => step.days);

export function questSteps(period: Period): QuestStep[] {
  return STEPS.map((step) => ({ id: `${period.key}:q${step.days}`, ...step }));
}

/**
 * Jours de la période où quelque chose a été fait. « Quelque chose » = au moins un item répondu ou
 * une partie jouée : lire une fiche ne compte pas, répondre compte.
 */
export function activeDaysIn(journal: CountersJournal, period: Period): string[] {
  return period.days.filter((day) => {
    const counters = journal[day];
    if (!counters) return false;
    return (counters.items ?? 0) > 0 || (counters.games ?? 0) > 0;
  });
}

export interface QuestView {
  step: QuestStep;
  done: boolean;
  claimedAt: string | null;
}

export interface QuestProgress {
  period: Period;
  /** Jours travaillés cette semaine, du plus ancien au plus récent. */
  days: string[];
  steps: QuestView[];
  /** Prochain palier non atteint, `null` quand tout est fait. */
  next: QuestStep | null;
}

export function questProgress(journal: CountersJournal, period: Period, claims: Record<string, string>): QuestProgress {
  const days = activeDaysIn(journal, period);
  const steps = questSteps(period).map((step) => ({
    step,
    done: days.length >= step.days,
    claimedAt: claims[step.id] ?? null,
  }));
  return { period, days, steps, next: steps.find((view) => !view.done)?.step ?? null };
}

/** Paliers atteints et pas encore réclamés : ce que la pastille de l'accueil compte. */
export function claimableSteps(progress: QuestProgress): QuestStep[] {
  return progress.steps.filter((view) => view.done && view.claimedAt === null).map((view) => view.step);
}
