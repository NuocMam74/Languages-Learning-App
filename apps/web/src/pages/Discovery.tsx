import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import {
  BlankPage,
  DeltaDawn,
  FloatingMarket,
  Icon,
  Illustration,
  Lanterns,
  Notebook,
  ProgressBar,
  Sampan,
  staggerStyle,
} from "../design/index.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { DEFAULT_DAILY_GOAL_MIN, getProfile } from "../learner.ts";
import { usePrefs } from "../prefs.ts";

/**
 * Visite guidée du premier lancement (contrat phase23 §3), juste après le test de niveau.
 *
 * Ce qu'elle répare : l'onboarding posait cinq questions puis lâchait l'apprenant **dans une
 * leçon**. Il apprenait à répondre à des exercices sans jamais avoir vu la maison — ni le fleuve
 * du parcours, ni la bibliothèque de révision, ni ses chiffres, ni ses fiches. Tout cela se
 * découvrait par accident, ou jamais.
 *
 * Six écrans, une idée par écran, et **rien à faire** : on avance, on ne répond pas. C'est une
 * visite, pas un sixième questionnaire — l'apprenant vient d'en finir un, et il a déjà passé un
 * test. Elle se passe d'un bouton, et elle se revoit depuis les Réglages.
 *
 * Elle ne se termine pas sur une leçon : on arrive sur le parcours, d'où **on choisit** de
 * commencer. La différence est petite et elle compte — c'est la première fois que l'apprenant
 * décide quelque chose.
 */

interface Step {
  key: string;
  title: MessageKey;
  body: MessageKey;
  art: typeof Sampan;
  /** Ce que l'écran montre du doigt : le libellé apparaît sous le dessin. */
  destination?: { icon: Parameters<typeof Icon>[0]["name"]; label: MessageKey };
}

const STEPS: Step[] = [
  { key: "path", title: "discovery.path.title", body: "discovery.path.body", art: Sampan, destination: { icon: "boat", label: "nav.learn" } },
  { key: "session", title: "discovery.session.title", body: "discovery.session.body", art: DeltaDawn },
  { key: "review", title: "discovery.review.title", body: "discovery.review.body", art: Notebook, destination: { icon: "book", label: "nav.review" } },
  { key: "memo", title: "discovery.memo.title", body: "discovery.memo.body", art: BlankPage, destination: { icon: "notebook", label: "memo.title" } },
  { key: "stats", title: "discovery.stats.title", body: "discovery.stats.body", art: Lanterns, destination: { icon: "chart", label: "nav.stats" } },
  { key: "offline", title: "discovery.offline.title", body: "discovery.offline.body", art: FloatingMarket },
];

export default function Discovery() {
  const navigate = useNavigate();
  const setDiscovered = usePrefs((s) => s.setDiscovered);
  const [index, setIndex] = useState(0);
  // Un seul chiffre vient du profil : l'objectif que l'apprenant vient de choisir. La visite lui
  // parle de **sa** séance, pas d'une séance en général.
  const [goal, setGoal] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void getProfile().then((profile) => live && setGoal(profile.dailyGoalMin));
    return () => {
      live = false;
    };
  }, []);

  const step = STEPS[index];
  if (!step) return null;
  const last = index === STEPS.length - 1;

  const leave = () => {
    setDiscovered(new Date().toISOString());
    // Le parcours de la langue, pas une leçon : c'est à l'apprenant de lancer sa première séance.
    navigate("/apprendre", { replace: true });
  };

  const Art = step.art;

  return (
    <Screen
      top={
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => setIndex(index - 1)}
                  className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-phu-sa transition-[background-color,transform] hover:bg-phu-sa/8 motion-safe:active:scale-[.98]"
                  aria-label={t("discovery.back")}
                >
                  <Icon name="chevronLeft" />
                </button>
              )}
              <span className="text-sm text-phu-sa">{t("discovery.step", { i: index + 1, n: STEPS.length })}</span>
            </span>
            {/* Passer reste offert à chaque écran : une visite dont on ne peut pas sortir est une prison. */}
            <button type="button" onClick={leave} data-testid="discovery-skip" className="min-h-11 px-1 text-sm font-semibold text-ngoc">
              {t("discovery.skip")}
            </button>
          </div>
          <ProgressBar value={index + 1} max={STEPS.length} size="sm" label={t("discovery.step", { i: index + 1, n: STEPS.length })} />
        </div>
      }
      action={
        <Button onClick={() => (last ? leave() : setIndex(index + 1))} data-testid="discovery-next">
          {t(last ? "discovery.done" : "discovery.next")}
        </Button>
      }
    >
      {/* `key` : chaque écran rejoue son entrée, le précédent ne traîne pas derrière. */}
      <div key={step.key} className="flex flex-1 flex-col justify-center gap-6" data-testid="discovery-step" data-step={step.key}>
        <Illustration className="mx-auto max-w-[17rem] motion-safe:parlo-enter">
          <Art />
        </Illustration>
        <div className="flex flex-col gap-3">
          <h1 className="font-serif text-2xl text-balance motion-safe:parlo-enter" style={staggerStyle(1)}>
            {t(step.title)}
          </h1>
          <p className="text-lg text-balance motion-safe:parlo-enter" style={staggerStyle(2)}>
            {/* Seul écran à porter un chiffre : l'objectif quotidien que l'apprenant vient de choisir. */}
            {step.key === "session" ? t(step.body, { n: goal ?? DEFAULT_DAILY_GOAL_MIN }) : t(step.body)}
          </p>
          {step.destination && (
            <p className="flex items-center gap-2 text-phu-sa motion-safe:parlo-enter" style={staggerStyle(3)}>
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ngoc-sang text-ngoc">
                <Icon name={step.destination.icon} size={18} />
              </span>
              {t(step.destination.label)}
            </p>
          )}
        </div>
      </div>
    </Screen>
  );
}
