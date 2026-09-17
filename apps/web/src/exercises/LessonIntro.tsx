import type { Concept, ContentIndex, Lesson } from "@parlo/core";
import { playConcept, ttsAllowed } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { Button, Screen, Vi } from "../components/ui.tsx";
import { Card, Chip, Icon, SectionTitle } from "../design/index.ts";
import { l, plural, t, toneLabel } from "../i18n/index.ts";

/**
 * Fiche de découverte (contrat phase10 §1) : **on présente avant de faire pratiquer**.
 *
 * Elle ouvre le bloc « Nouveau » d'une séance, une seule fois, et montre d'un coup d'œil ce que la
 * leçon introduit : le mot en serif (c'est l'objet visuel, spec §13), son sens, son audio, son ton,
 * et une phrase d'exemple. On peut réécouter dans l'ordre qu'on veut — c'est le but d'une liste
 * plutôt que d'un défilé d'écrans.
 *
 * Elle n'est pas un exercice : rien n'est noté, rien n'entre dans le SRS, rien n'est envoyé. Le
 * seul bouton mène aux exercices.
 */
export function LessonIntro({ content, lesson, conceptIds, onStart }: {
  content: ContentIndex;
  lesson: Lesson | undefined;
  conceptIds: readonly string[];
  onStart: () => void;
}) {
  const concepts = conceptIds.flatMap((id): Concept[] => {
    const concept = content.concepts.get(id);
    return concept ? [concept] : [];
  });
  // Les notes de prononciation sont regroupées en bas : répétées sous chaque mot, elles noieraient
  // la liste. Une note identique (même ton) ne s'affiche qu'une fois.
  const notes = [...new Set(concepts.flatMap((c) => (c.note ? [l(c.note)] : [])))];

  return (
    <Screen
      action={
        <Button onClick={onStart} data-testid="intro-start">
          {t("intro.start")}
        </Button>
      }
    >
      <div className="flex flex-1 flex-col gap-5 pt-2" data-testid="lesson-intro" data-concepts={concepts.length}>
        <header>
          <p className="text-sm text-phu-sa">{t("intro.eyebrow")}</p>
          <h1 className="font-serif text-2xl leading-tight">{lesson ? l(lesson.title) : t("intro.title")}</h1>
          {lesson && <p className="pt-1 text-lg text-phu-sa text-balance">{l(lesson.goal)}</p>}
          <p className="flex items-center gap-3 pt-2 text-sm text-phu-sa">
            <span className="flex items-center gap-1.5">
              <Icon name="cards" size={15} />
              {plural("intro.words", "intro.words.plural", concepts.length)}
            </span>
            {lesson && lesson.estimatedMinutes > 0 && (
              <span className="flex items-center gap-1.5">
                <Icon name="clock" size={15} />
                {t("dashboard.minutes", { n: lesson.estimatedMinutes })}
              </span>
            )}
          </p>
        </header>

        <Card tone="raised" as="ul" className="flex flex-col gap-0 py-1">
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
                {concept.northernEquivalent && (
                  <p className="pt-1 text-sm text-phu-sa">{t("intro.northern", { word: concept.northernEquivalent })}</p>
                )}
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
        </Card>

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

        <p className="text-sm text-phu-sa">{t("intro.hint")}</p>
      </div>
    </Screen>
  );
}
