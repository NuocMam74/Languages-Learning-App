import type { Briefing, Concept, ContentIndex, Lesson, StepType } from "@parlo/core";
import { useState } from "react";
import { playConcept, ttsAllowed } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { Card, Chip, Icon, IconButton, ProgressBar, SectionTitle } from "../design/index.ts";
import { l, plural, t, toneLabel, type MessageKey } from "../i18n/index.ts";
import { FORMAT_TITLE } from "./format-names.ts";

/**
 * Fiche de préparation (contrat phase16 §2) : **on ne lance pas un exercice sur ce qu'on n'a pas vu.**
 *
 * Elle remplace la fiche de découverte (contrat phase10 §1), qui ne montrait que les mots
 * *introduits* par la leçon. Le manque était mesurable : les exercices puisent aussi dans les
 * leçons d'avant, et parfois dans des formes que rien n'a jamais présentées — 55 leçons du corpus
 * sur 194 faisaient assembler une phrase avec un jeton inconnu. On arrivait sur « relie ces mots »
 * sans connaître les mots, ni l'ordre dans lequel ils se rangent.
 *
 * La fiche couvre désormais tout ce que la leçon exige, en volets :
 *   - **les mots neufs**, comme avant : forme, sens, audio, ton, exemple ;
 *   - **ce qu'on réutilise** : les mots plus anciens que les exercices vont faire produire ;
 *   - **les phrases modèles** : quand un mot de la phrase cible échappe au corpus, on montre la
 *     phrase entière, traduite — la remettre dans l'ordre reste le travail ;
 *   - **les fiches conseils** de l'unité : comment une phrase se construit, à qui on dit anh ;
 *   - **les consignes** des formats d'exercice jamais rencontrés.
 *
 * Et c'est une **porte** : le bouton ne s'ouvre qu'une fois tous les volets dépliés. Le compteur
 * le dit en clair (« 3 sur 5 vus »). Déplier un volet, c'est aussi ce qui donne envie de lire —
 * une liste entièrement ouverte se saute d'un coup de pouce, une liste à ouvrir se parcourt.
 *
 * Elle n'est toujours pas un exercice : rien n'est noté, rien n'entre dans le SRS, rien n'est
 * envoyé. Le seul bouton mène aux exercices.
 */

/** Consigne d'un format, montrée la première fois qu'on le rencontre. */
const FORMAT_HINT: Partial<Record<StepType, MessageKey>> = {
  build_sentence: "brief.format.build_sentence",
  match_pairs: "brief.format.match_pairs",
  fill_gap: "brief.format.fill_gap",
  listen_transcribe: "brief.format.listen_transcribe",
  translate_to_vi: "brief.format.translate_to_vi",
  translate_to_fr: "brief.format.translate_to_fr",
  speak_repeat: "brief.format.speak_repeat",
  speak_answer: "brief.format.speak_answer",
  speak_roleplay: "brief.format.speak_roleplay",
  dialogue_choice: "brief.format.dialogue_choice",
  tone_produce: "brief.format.tone_produce",
  game: "brief.format.game",
};


export function LessonBriefing({ content, lesson, briefing, onStart, onQuit, onGuideRead }: {
  content: ContentIndex;
  lesson: Lesson | undefined;
  briefing: Briefing;
  onStart: () => void;
  /** Quitter : même geste et même place que pendant la séance. Sans lui, une PWA installée n'a
      aucun bouton retour et l'écran devient un cul-de-sac. */
  onQuit: () => void;
  /** Une fiche conseil dépliée compte comme lue : l'échelle de révision le sait (contrat §4). */
  onGuideRead: (guideId: string) => void;
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const open = (key: string) => {
    setOpened((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
    if (key.startsWith("guide:")) onGuideRead(key.slice("guide:".length));
  };

  const concepts = (ids: readonly string[]): Concept[] =>
    ids.flatMap((id) => {
      const concept = content.concepts.get(id);
      return concept ? [concept] : [];
    });
  const discover = concepts(briefing.discover);
  const recall = concepts(briefing.recall);

  // Un volet par bloc à consulter. Les fiches et les consignes comptent une par une : elles se
  // lisent séparément, et sauter la seule qui explique « comment construire une phrase » serait
  // exactement le trou qu'on est en train de boucher.
  const panels: { key: string; title: string; count?: string; body: () => React.ReactNode }[] = [];
  if (discover.length > 0) {
    panels.push({
      key: "discover",
      title: t("brief.panel.discover"),
      count: plural("intro.words", "intro.words.plural", discover.length),
      body: () => <WordList content={content} concepts={discover} />,
    });
  }
  if (recall.length > 0) {
    panels.push({
      key: "recall",
      title: t("brief.panel.recall"),
      count: plural("intro.words", "intro.words.plural", recall.length),
      body: () => (
        <>
          <p className="px-5 pb-1 text-sm text-phu-sa">{t("brief.panel.recall.hint")}</p>
          <WordList content={content} concepts={recall} />
        </>
      ),
    });
  }
  if (briefing.models.length > 0) {
    panels.push({
      key: "models",
      title: t("brief.panel.models"),
      count: plural("brief.count.sentences", "brief.count.sentences.plural", briefing.models.length),
      body: () => (
        <ul className="flex flex-col gap-3 px-5 pb-4">
          {briefing.models.map((model) => (
            <li key={model.vi} data-testid="brief-model">
              <Vi size="lg" className="break-words">{model.vi}</Vi>
              <p className="text-phu-sa">{l(model.translation)}</p>
            </li>
          ))}
        </ul>
      ),
    });
  }
  for (const guideId of briefing.guides) {
    const guide = content.guides.get(guideId);
    if (!guide) continue;
    panels.push({
      key: `guide:${guideId}`,
      title: l(guide.title),
      body: () => <GuideDigest content={content} guideId={guideId} />,
    });
  }
  for (const format of briefing.formats) {
    const title = FORMAT_TITLE[format];
    const hint = FORMAT_HINT[format];
    if (!title || !hint) continue;
    panels.push({
      key: `format:${format}`,
      title: t(title),
      body: () => (
        <p className="px-5 pb-4 text-balance" data-testid="brief-format">
          {t(hint)}
        </p>
      ),
    });
  }

  const seen = panels.filter((panel) => opened.has(panel.key)).length;
  const ready = seen >= panels.length;

  // Les notes de prononciation sont regroupées en bas : répétées sous chaque mot, elles noieraient
  // la liste. Une note identique (même ton) ne s'affiche qu'une fois.
  const notes = [...new Set([...discover, ...recall].flatMap((c) => (c.note ? [l(c.note)] : [])))];

  return (
    <Screen
      action={
        <div className="flex flex-col gap-2">
          {!ready && (
            <p className="text-center text-sm text-phu-sa" data-testid="brief-remaining" aria-live="polite">
              {t("brief.remaining", { n: panels.length - seen })}
            </p>
          )}
          <Button onClick={onStart} disabled={!ready} data-testid="intro-start">
            {t("intro.start")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-1 flex-col gap-4 pt-2" data-testid="lesson-intro" data-concepts={discover.length} data-panels={panels.length} data-seen={seen}>
        <header>
          <IconButton icon="close" label={t("lesson.quit")} onClick={onQuit} className="-mt-1 -ml-2 mb-1" />
          <p className="text-sm text-phu-sa">{t("intro.eyebrow")}</p>
          <h1 className="font-serif text-2xl leading-tight">{lesson ? l(lesson.title) : t("intro.title")}</h1>
          {lesson && <p className="pt-1 text-lg text-phu-sa text-balance">{l(lesson.goal)}</p>}
          <p className="flex items-center gap-3 pt-2 text-sm text-phu-sa">
            <span className="flex items-center gap-1.5">
              <Icon name="cards" size={15} />
              {plural("brief.count.panels", "brief.count.panels.plural", panels.length)}
            </span>
            {lesson && lesson.estimatedMinutes > 0 && (
              <span className="flex items-center gap-1.5">
                <Icon name="clock" size={15} />
                {t("dashboard.minutes", { n: lesson.estimatedMinutes })}
              </span>
            )}
          </p>
          {/* La barre dit où l'on en est dans la préparation, pas dans la séance : elle ne bouge
              qu'en dépliant, et elle atteint le bout au moment exact où le bouton s'ouvre. */}
          <ProgressBar value={seen} max={Math.max(1, panels.length)} label={t("brief.progress", { i: seen, n: panels.length })} className="mt-3 h-2" />
        </header>

        <ul className="flex flex-col gap-2.5">
          {panels.map((panel, index) => (
            <Panel
              key={panel.key}
              title={panel.title}
              count={panel.count}
              open={opened.has(panel.key)}
              onOpen={() => open(panel.key)}
              stagger={index}
              testId={panel.key}
            >
              {panel.body()}
            </Panel>
          ))}
        </ul>

        {notes.length > 0 && (
          <section>
            <SectionTitle icon="info" className="mb-2">{t("intro.notes")}</SectionTitle>
            <Card tone="notice" as="ul" className="flex flex-col gap-2">
              {notes.map((note) => (
                <li key={note} className="text-sm">{note}</li>
              ))}
            </Card>
          </section>
        )}

        <p className="text-sm text-phu-sa">{t("brief.hint")}</p>
      </div>
    </Screen>
  );
}

/**
 * Un volet. Fermé, il annonce ce qu'il contient ; ouvert, il le montre et ne se referme plus —
 * on ne défait pas une consultation, et rien n'incite à recliquer pour « décompter ».
 */
function Panel({ title, count, open, onOpen, stagger, testId, children }: {
  title: string;
  count?: string | undefined;
  open: boolean;
  onOpen: () => void;
  stagger: number;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Card as="li" tone={open ? "raised" : "plain"} stagger={stagger} className="px-0 py-0 overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        data-testid={`brief-panel-${testId}`}
        data-open={open}
        className="flex min-h-16 w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${open ? "bg-ngoc text-nuoc" : "bg-ngoc-sang text-ngoc"}`}>
          <Icon name={open ? "check" : "chevronRight"} size={18} />
        </span>
        <span className="min-w-0 flex-1 font-medium">{title}</span>
        {count && <Chip tone="neutral">{count}</Chip>}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </Card>
  );
}

function WordList({ content, concepts }: { content: ContentIndex; concepts: readonly Concept[] }) {
  return (
    <ul className="flex flex-col gap-0 px-5">
      {concepts.map((concept, index) => (
        <li
          key={concept.id}
          className="flex items-start gap-3 border-b border-line py-3 last:border-b-0"
          data-testid="intro-word"
          data-concept={concept.id}
        >
          <div className="min-w-0 flex-1">
            <Vi size="2xl" className="break-words">{concept.vi}</Vi>
            <p className="text-phu-sa">{l(concept.gloss)}</p>
            {concept.examples?.[0] && (
              <p className="pt-1.5 text-sm">
                <span lang="vi" data-target-text="" className="font-serif">{concept.examples[0].vi}</span>
                <span className="block text-phu-sa">{concept.examples[0].fr}</span>
              </p>
            )}
            {concept.northernEquivalent && <p className="pt-1 text-sm text-phu-sa">{t("intro.northern", { word: concept.northernEquivalent })}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {/* Pas de lecture automatique ici : une liste qui parlerait toute seule jouerait
                tous ses mots en même temps. C'est l'apprenant qui déclenche, mot par mot.
                Pas de bouton « lent » non plus : deux boutons par ligne écrasent la liste sur
                un téléphone, et le lent reste disponible dans les exercices et dans Réviser. */}
            <AudioButton play={(speed) => playConcept(content, concept, { speed, allowTts: ttsAllowed(false) })} autoPlay={false} large={false} withSlow={false} />
            {concept.tone && <Chip tone="nghe">{toneLabel([concept.tone])}</Chip>}
          </div>
          <span className="sr-only">{t("intro.position", { i: index + 1, n: concepts.length })}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Ce qu'on retient d'une fiche conseil avant une leçon : son résumé, ses exemples, ses pièges.
 * Pas la fiche entière — on est en train de préparer une séance de cinq minutes, pas de lire un
 * chapitre. Le lien vers la fiche complète reste, pour qui veut tout.
 */
function GuideDigest({ content, guideId }: { content: ContentIndex; guideId: string }) {
  const guide = content.guides.get(guideId);
  if (!guide) return null;
  const examples = guide.sections.flatMap((section) => section.examples ?? []).slice(0, 3);
  return (
    <div className="flex flex-col gap-3 px-5 pb-4" data-testid="brief-guide" data-guide={guideId}>
      <p className="text-balance">{l(guide.summary)}</p>
      {examples.length > 0 && (
        <ul className="flex flex-col gap-2">
          {examples.map((example) => (
            <li key={example.vi}>
              <Vi size="lg" className="break-words">{example.vi}</Vi>
              <span className="block text-sm text-phu-sa">{example.fr}</span>
            </li>
          ))}
        </ul>
      )}
      {guide.pitfalls && guide.pitfalls.length > 0 && (
        <Card tone="notice" as="ul" className="flex flex-col gap-1.5">
          {guide.pitfalls.slice(0, 2).map((pitfall) => (
            <li key={l(pitfall)} className="text-sm">{l(pitfall)}</li>
          ))}
        </Card>
      )}
      {/* Une fiche entière au milieu d'une séance couperait la séance. On la garde à portée, hors
          du chemin : c'est le rayon « Conseils » qui la sert en entier. */}
      <a href={`/reviser/conseils/${guide.id}`} className="text-sm font-medium text-ngoc underline-offset-4 hover:underline">
        {t("brief.guide.readAll")}
      </a>
    </div>
  );
}
