import { currentWorld, worldStates, type ContentIndex, type WorldState } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { RiverPath } from "../components/RiverPath.tsx";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, Icon, PageHeader, ProgressBar, ProgressRing, SectionTitle, Skeleton } from "../design/index.ts";
import { l, plural, t } from "../i18n/index.ts";
import { getProfile, planning, type Planning } from "../learner.ts";

/**
 * Les mondes (contrat phase11 §2) : la carte du cursus lue comme une carte de jeu.
 *
 * Six mondes, ceux du cursus (`curriculum.blocks`), avec leur avancement et leur cadenas. On entre
 * dans un monde pour y trouver le chemin de ses leçons. Les trois mondes qui portent un certificat
 * l'annoncent : c'est l'examen qui les referme.
 *
 * Rien de nouveau côté règles : le déverrouillage reste celui du graphe d'unités et de la maîtrise
 * des leçons (contrat phase10 §3). Un monde fermé ne se touche pas — ni lien, ni leçon accessible.
 */

function useJourney(content: ContentIndex) {
  const [plan, setPlan] = useState<Planning | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const profile = await getProfile();
      const next = await planning(content, profile);
      if (live) setPlan(next);
    })();
    return () => {
      live = false;
    };
  }, [content]);
  return plan;
}

export default function WorldsPage({ content }: { content: ContentIndex }) {
  const plan = useJourney(content);
  const states = plan ? worldStates(content.curriculum, content.lessons, { completed: plan.unlocked, passed: plan.passed }) : null;
  const here = states ? currentWorld(states) : null;

  return (
    <Screen top={<PageHeader title={t("worlds.title")} subtitle={t("worlds.intro")} back="/apprendre" backLabel={t("nav.learn")} />}>
      {!states ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" rounded="card" />
          ))}
        </div>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="worlds">
          {states.map((state, i) => (
            <WorldRow key={state.world.id} state={state} stagger={i} current={state.world.id === here?.id} />
          ))}
        </ol>
      )}
    </Screen>
  );
}

function WorldRow({ state, stagger, current }: { state: WorldState; stagger: number; current: boolean }) {
  const { world, unlocked, complete, lessonsPassed, lessonsTotal } = state;
  const name = l(world.title);
  return (
    <Card
      as="li"
      // Le monde où l'on en est porte l'écran ; les terminés restent visibles, les fermés discrets.
      tone={current ? "feature" : complete ? "notice" : unlocked ? "plain" : "quiet"}
      stagger={stagger}
      data-testid="world"
      data-world={world.id}
      data-state={complete ? "complete" : unlocked ? "open" : "locked"}
      className="relative flex items-center gap-4"
    >
      <ProgressRing
        value={lessonsPassed}
        max={Math.max(1, lessonsTotal)}
        size={60}
        tone={complete ? "ngoc" : "nghe"}
        label={t("worlds.progress", { done: lessonsPassed, total: lessonsTotal })}
      >
        {complete ? (
          <Icon name="check" size={22} strokeWidth={3} className="text-ngoc" />
        ) : unlocked ? (
          <span className="font-serif text-lg">{world.number}</span>
        ) : (
          <Icon name="lock" size={20} className="text-phu-sa" />
        )}
      </ProgressRing>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm text-phu-sa">{t("worlds.number", { n: world.number })}</p>
        {unlocked ? (
          <Link to={`/mondes/${world.id}`} className="font-serif text-lg after:absolute after:inset-0 after:rounded-card">
            {name}
          </Link>
        ) : (
          <span className="font-serif text-lg text-phu-sa">{name}</span>
        )}
        <ProgressBar
          value={lessonsPassed}
          max={Math.max(1, lessonsTotal)}
          size="sm"
          tone={complete ? "ngoc" : "nghe"}
          label={t("worlds.progress", { done: lessonsPassed, total: lessonsTotal })}
        />
        <span className="flex flex-wrap items-center gap-2 text-sm text-phu-sa tabular-nums">
          <span>{t("worlds.progress", { done: lessonsPassed, total: lessonsTotal })}</span>
          {world.certificate && (
            <Chip tone={complete ? "ngoc" : "nghe"} icon="diploma">
              {t("worlds.certificate", { level: world.certificate })}
            </Chip>
          )}
        </span>
        {!unlocked && <span className="text-sm text-phu-sa">{t("worlds.locked")}</span>}
      </div>
    </Card>
  );
}

/** Un monde ouvert : ses unités, et le chemin de ses leçons. */
export function WorldPage({ content }: { content: ContentIndex }) {
  const { worldId = "" } = useParams();
  const plan = useJourney(content);
  const states = plan ? worldStates(content.curriculum, content.lessons, { completed: plan.unlocked, passed: plan.passed }) : null;
  const state = states?.find((s) => s.world.id === worldId) ?? null;

  if (!plan || !states) {
    return (
      <Screen top={<PageHeader title={t("worlds.title")} back="/mondes" backLabel={t("worlds.title")} />}>
        <Skeleton className="h-64 w-full" rounded="card" />
      </Screen>
    );
  }
  // Monde inconnu ou fermé : on renvoie à la carte plutôt que d'afficher un chemin interdit.
  if (!state || !state.unlocked) {
    return (
      <Screen top={<PageHeader title={t("worlds.title")} back="/mondes" backLabel={t("worlds.title")} />}>
        <Card tone="quiet" className="my-auto flex items-center gap-3" data-testid="world-locked">
          <Icon name="lock" size={22} className="text-phu-sa" />
          <p className="text-phu-sa">{t("worlds.locked")}</p>
        </Card>
      </Screen>
    );
  }

  const { world, complete, lessonsPassed, lessonsTotal } = state;
  const units = content.curriculum.units.filter((u) => world.units.includes(u.id));

  return (
    <Screen
      top={
        <PageHeader
          title={l(world.title)}
          subtitle={t("worlds.number", { n: world.number })}
          back="/mondes"
          backLabel={t("worlds.title")}
          actions={complete ? <Chip tone="ngoc" icon="check">{t("worlds.complete")}</Chip> : undefined}
        />
      }
    >
      <div className="flex flex-col gap-2 pb-4">
        <ProgressBar
          value={lessonsPassed}
          max={Math.max(1, lessonsTotal)}
          tone={complete ? "ngoc" : "nghe"}
          label={t("worlds.progress", { done: lessonsPassed, total: lessonsTotal })}
        />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-phu-sa tabular-nums">
          <span>{t("worlds.progress", { done: lessonsPassed, total: lessonsTotal })}</span>
          <span>{plural("worlds.units", "worlds.units.plural", units.length)}</span>
        </p>
        {world.certificate && (
          <Link to="/examens" className="flex min-h-11 items-center gap-2 font-semibold text-ngoc" data-testid="world-exam">
            <Icon name="diploma" size={18} />
            {t("worlds.exam", { level: world.certificate })}
          </Link>
        )}
      </div>

      <SectionTitle tone="banner" icon="boat" className="mb-3">{t("hub.path")}</SectionTitle>
      <RiverPath
        content={content}
        completed={plan.completed}
        passed={plan.passed}
        unlocked={plan.open}
        current={plan.next?.id ?? null}
        unitIds={world.units}
      />
    </Screen>
  );
}
