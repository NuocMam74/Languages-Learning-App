import { conceptNeedsWork, nextRung, studyPath, studyProgress, type ContentIndex, type PartOfSpeech, type Rung, type RungId } from "@parlo/core";
import { useMemo } from "react";
import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { Card, Chip, Icon, ProgressBar, SectionTitle, type IconName } from "../design/index.ts";
import { l, t, type MessageKey } from "../i18n/index.ts";
import type { LibraryData } from "./data.ts";
import { useGuidesRead } from "./guides-read.ts";
import { POS_LABEL } from "./Index.tsx";
import { RUNG_LABEL } from "./ReviewHome.tsx";
import { enter, LibraryHeader } from "./ui.tsx";

/**
 * « Par où commencer » (contrat phase16 §4) : l'ordre de travail de la bibliothèque.
 *
 * Constat à l'usage : huit rayons de même poids et douze catégories grammaticales, et rien qui
 * dise par quoi débuter. Cet écran répond à la seule question qu'on se pose en ouvrant
 * « Réviser » — *qu'est-ce que je travaille maintenant ?* — avec une échelle qui va du plus simple
 * au plus difficile, et un barreau désigné.
 *
 * Il ne verrouille rien. Tous les rayons restent ouverts, comme avant : la bibliothèque ne demande
 * rien en échange (contrat phase8 §2). Il **recommande**, il n'interdit pas. Un barreau plus haut
 * que le sien se clique et s'ouvre ; il est seulement posé plus bas dans la page, et sans accent.
 *
 * Chaque barreau se déplie en étapes concrètes — une catégorie, une fiche — qui mènent aux écrans
 * qui existent déjà. Aucun nouveau type de contenu, aucune nouvelle liste : un chemin à travers ce
 * qu'il y a.
 */

const RUNG_WHY: Record<RungId, MessageKey> = {
  due: "study.why.due",
  hard: "study.why.hard",
  words: "study.why.words",
  pronouns: "study.why.pronouns",
  grammar: "study.why.grammar",
  glue: "study.why.glue",
  speaking: "study.why.speaking",
};

const RUNG_ICON: Record<RungId, IconName> = {
  due: "refresh",
  hard: "flame",
  words: "cards",
  pronouns: "user",
  grammar: "grammar",
  glue: "bowl",
  speaking: "dialogue",
};

/** Catégories d'un barreau lexical, dans l'ordre où on les travaille. */
const RUNG_POS: Partial<Record<RungId, readonly PartOfSpeech[]>> = {
  words: ["noun", "verb", "adjective", "adverb"],
  pronouns: ["pronoun"],
  glue: ["classifier", "particle", "question", "numeral", "preposition", "conjunction"],
  speaking: ["phrase"],
};

/** Une étape concrète dans un barreau : où aller, et combien il y a à y faire. */
interface Step {
  to: string;
  label: string;
  todo: number;
  total: number;
}

export function StudyPath({ content, data }: { content: ContentIndex; data: LibraryData }) {
  const read = useGuidesRead((s) => s.read);
  const path = useMemo(
    () => studyPath(content, { seen: data.concepts.map((c) => c.conceptId), cards: data.cards, readGuides: read, now: data.now }),
    [content, data.concepts, data.cards, data.now, read],
  );
  const current = nextRung(path);
  const { done, started } = studyProgress(path);

  return (
    <Screen top={<LibraryHeader title={t("study.title")} subtitle={t("study.intro")} />}>
      <Card tone={current ? "feature" : "quiet"} data-testid="study-next">
        <p className="text-sm text-phu-sa">{current ? t("study.next.eyebrow") : t("study.next.doneEyebrow")}</p>
        <p className="pt-0.5 text-lg font-medium text-balance">{current ? t(RUNG_LABEL[current.id]) : t("study.next.done")}</p>
        <p className="pt-1 text-sm text-phu-sa text-balance">{current ? t(RUNG_WHY[current.id]) : t("study.next.doneBody")}</p>
        {started > 0 && (
          <ProgressBar value={done} max={started} label={t("study.progress", { i: done, n: started })} className="mt-3 h-2" />
        )}
      </Card>

      <SectionTitle tone="banner" icon="chart" className="mt-6 mb-3">
        {t("study.ladder")}
      </SectionTitle>

      <ol className="flex flex-col gap-2.5" data-testid="study-ladder">
        {path.map((rung, index) => (
          <RungCard
            key={rung.id}
            content={content}
            data={data}
            rung={rung}
            index={index}
            current={current?.id === rung.id}
            readGuides={read}
          />
        ))}
      </ol>

      <Card tone="quiet" className="mt-4 flex items-start gap-2.5">
        <Icon name="info" size={18} className="mt-0.5 shrink-0 text-phu-sa" />
        {/* Les tons ne se révisent pas dans une liste : ils s'entendent. On le dit, plutôt que de
            faire semblant qu'un rayon de vocabulaire les travaille. */}
        <p className="text-sm text-phu-sa">{t("study.tones")}</p>
      </Card>
    </Screen>
  );
}

function RungCard({ content, data, rung, index, current, readGuides }: {
  content: ContentIndex;
  data: LibraryData;
  rung: Rung;
  index: number;
  current: boolean;
  readGuides: ReadonlySet<string>;
}) {
  const steps = useMemo(() => rungSteps(content, data, rung, readGuides), [content, data, rung, readGuides]);

  return (
    <Card
      as="li"
      tone={current ? "raised" : rung.state === "empty" ? "quiet" : "plain"}
      data-testid={`study-rung-${rung.id}`}
      data-state={rung.state}
      {...enter(index)}
    >
      <div className="flex items-center gap-3">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full ${
            rung.state === "done" ? "bg-ngoc text-nuoc" : rung.state === "empty" ? "bg-surface-quiet text-phu-sa" : "bg-ngoc-sang text-ngoc"
          }`}
        >
          <Icon name={rung.state === "done" ? "check" : RUNG_ICON[rung.id]} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t(RUNG_LABEL[rung.id])}</p>
          <p className="text-sm text-phu-sa text-balance">{t(RUNG_WHY[rung.id])}</p>
        </div>
        {rung.state === "todo" && <Chip tone={current ? "solid" : "neutral"}>{t("study.todo", { n: rung.todo })}</Chip>}
      </div>

      {/* Un barreau que rien n'a encore ouvert annonce sa taille, sans rien montrer : la
          bibliothèque ne divulgâche pas le cursus (contrat phase8 §2). */}
      {rung.state === "empty" ? (
        <p className="pt-3 text-sm text-phu-sa">
          {rung.toCome > 0 ? t("study.locked", { n: rung.toCome }) : t("study.lockedGuides")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 pt-3">
          {steps.map((step) => (
            <li key={step.to + step.label}>
              <Link
                to={step.to}
                data-testid="study-step"
                className="-mx-2 flex min-h-11 items-center gap-2 rounded-field px-2 hover:bg-ngoc-sang/40"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{step.label}</span>
                <span className="shrink-0 text-sm text-phu-sa">
                  {step.todo > 0 ? t("study.step.todo", { i: step.todo, n: step.total }) : t("study.step.done")}
                </span>
                <Icon name="chevronRight" size={16} className="shrink-0 text-phu-sa" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Les étapes d'un barreau, dans l'ordre. Les urgences n'en ont qu'une (on y va, c'est tout) ; les
 * barreaux lexicaux se déplient par catégorie — c'est la granularité à laquelle on révise
 * réellement, « tous les classificateurs » et non « les 380 mots que j'ai vus ».
 */
function rungSteps(content: ContentIndex, data: LibraryData, rung: Rung, readGuides: ReadonlySet<string>): Step[] {
  if (rung.id === "due") return [{ to: "/revision", label: t("study.step.review"), todo: rung.todo, total: rung.todo }];
  if (rung.id === "hard") {
    return [{ to: "/reviser/vocabulaire?etat=hard", label: t("study.step.hard"), todo: rung.todo, total: rung.todo }];
  }

  const steps: Step[] = [];
  // Même règle que le barreau (`conceptNeedsWork`) : les deux comptes doivent s'additionner, sinon
  // un barreau « 3 à revoir » n'affiche que des étapes « solides ».
  const cardOf = new Map(data.cards.map((c) => [c.conceptId, c]));
  for (const pos of RUNG_POS[rung.id] ?? []) {
    const ids = rung.conceptIds.filter((id) => content.concepts.get(id)?.pos === pos);
    if (ids.length === 0) continue;
    steps.push({
      to: `/reviser/vocabulaire?categorie=${pos}`,
      label: t(POS_LABEL[pos]),
      todo: ids.filter((id) => conceptNeedsWork(cardOf.get(id), data.now)).length,
      total: ids.length,
    });
  }
  for (const guideId of rung.guideIds) {
    const guide = content.guides.get(guideId);
    if (!guide) continue;
    steps.push({ to: `/reviser/conseils/${guideId}`, label: l(guide.title), todo: readGuides.has(guideId) ? 0 : 1, total: 1 });
  }
  return steps;
}
