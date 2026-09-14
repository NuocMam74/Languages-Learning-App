import { buildExercise, evaluate, type ContentIndex, type Evaluation, type Exercise, type ExerciseResponse, type LessonId } from "@parlo/core";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { PlaybackSource } from "../audio.ts";
import { AudioButton } from "../components/AudioButton.tsx";
import { ExerciseView } from "../components/exercises.tsx";
import { InstallHint } from "../components/InstallHint.tsx";
import { RiverPath } from "../components/RiverPath.tsx";
import { Button } from "../components/ui.tsx";
import { ChoNoi } from "../games/ChoNoi.tsx";
import { gamePool } from "../games/GamesPage.tsx";

/**
 * Pages de démonstration (spec §16) — DÉVELOPPEMENT UNIQUEMENT.
 * Chaque composant d'exercice rendu seul, avec du vrai contenu du pack,
 * et le résultat de l'évaluation après réponse. Textes non traduits (outil interne).
 */

interface DemoEntry {
  id: string;
  title: string;
  origin: string;
  render: () => ReactNode;
}

const EXERCISE_TYPES: Exercise["type"][] = [
  "culture_card", "listen_pick_image", "listen_pick_text", "tone_identify", "tone_minimal_pair",
  "spot_the_south", "build_sentence", "speak_repeat", "game",
];

function exerciseEntries(content: ContentIndex): { entries: DemoEntry[]; missing: string[] } {
  const found = new Map<string, DemoEntry>();
  const lessonIds = content.curriculum.units.flatMap((u) => u.lessons);
  const ordered = [...new Set([...lessonIds, ...content.lessons.keys()])];
  for (const lessonId of ordered) {
    const lesson = content.lessons.get(lessonId);
    if (!lesson) continue;
    lesson.steps.forEach((step, stepIndex) => {
      if (found.has(step.type)) return;
      let exercise: Exercise;
      try {
        exercise = buildExercise(content, lesson, stepIndex, "demo");
      } catch (error) {
        found.set(step.type, { id: step.type, title: step.type, origin: `${lesson.id} #${stepIndex}`, render: () => <pre className="text-son-mai">{String(error)}</pre> });
        return;
      }
      found.set(step.type, {
        id: step.type,
        title: exercise.type === "unsupported" ? `${step.type} (unsupported)` : step.type,
        origin: `${lesson.id} · étape ${stepIndex}`,
        render: () => <ExerciseDemo content={content} exercise={exercise} />,
      });
    });
  }
  return { entries: [...found.values()], missing: EXERCISE_TYPES.filter((type) => !found.has(type)) };
}

export default function DemoPage({ content }: { content: ContentIndex }) {
  const { component } = useParams();
  const { entries, missing } = useMemo(() => exerciseEntries(content), [content]);

  const components: DemoEntry[] = [
    { id: "cho_noi", title: "Chợ nổi (jeu libre, 5 manches)", origin: "games/ChoNoi.tsx", render: () => <ChoNoiDemo content={content} /> },
    { id: "audio-button", title: "AudioButton", origin: "components/AudioButton.tsx", render: () => <AudioButtonDemo /> },
    { id: "river-path", title: "RiverPath", origin: "components/RiverPath.tsx", render: () => <RiverPathDemo content={content} /> },
    { id: "install-hint", title: "InstallHint", origin: "components/InstallHint.tsx", render: () => <InstallHintDemo /> },
  ];
  const all = [...entries, ...components];
  const selected = component ? all.find((e) => e.id === component) : undefined;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-4 md:max-w-[720px]">
      <header className="flex items-baseline justify-between gap-4 pb-4">
        <Link to="/demo" className="font-serif text-2xl">Démo des composants</Link>
        <span className="text-sm text-son-mai">DEV</span>
      </header>

      {!component && (
        <nav className="flex flex-col gap-6">
          <DemoList title="Exercices (ExerciseView, contenu réel du pack)" items={entries} />
          {missing.length > 0 && <p className="text-sm text-phu-sa">Sans exemple dans le pack : {missing.join(", ")}</p>}
          <DemoList title="Jeux et composants" items={components} />
        </nav>
      )}

      {component && !selected && <p className="text-son-mai">Composant inconnu : {component}</p>}
      {selected && (
        <section className="flex flex-1 flex-col">
          <p className="pb-4 text-sm text-phu-sa">{selected.title} — {selected.origin}</p>
          <div className="flex flex-1 flex-col">{selected.render()}</div>
        </section>
      )}
    </div>
  );
}

function DemoList({ title, items }: { title: string; items: DemoEntry[] }) {
  return (
    <div>
      <h2 className="pb-2 font-semibold">{title}</h2>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="border-t border-phu-sa/10">
            <Link to={`/demo/${item.id}`} className="flex min-h-12 items-baseline justify-between gap-4 py-2 text-ngoc">
              <span>{item.title}</span>
              <span className="text-right text-sm text-phu-sa">{item.origin}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExerciseDemo({ content, exercise }: { content: ContentIndex; exercise: Exercise }) {
  const [run, setRun] = useState(0);
  const [outcome, setOutcome] = useState<{ response: ExerciseResponse; evaluation: Evaluation } | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-1 flex-col rounded-2xl border-2 border-dashed border-phu-sa/20 px-4 pt-4">
        <ExerciseView
          key={run}
          exercise={exercise}
          content={content}
          locked={outcome !== null}
          onAnswer={(response) => setOutcome({ response, evaluation: evaluate(exercise, response) })}
        />
      </div>
      {outcome && (
        <div className="flex flex-col gap-2">
          <pre className="overflow-x-auto rounded-xl bg-muc p-3 text-sm text-nuoc" data-testid="demo-evaluation">
            {JSON.stringify(outcome, null, 2)}
          </pre>
          <Button variant="quiet" onClick={() => { setOutcome(null); setRun((r) => r + 1); }}>Réinitialiser</Button>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-phu-sa">Exercice construit (JSON)</summary>
        <pre className="overflow-x-auto">{JSON.stringify(exercise, null, 2)}</pre>
      </details>
    </div>
  );
}

function ChoNoiDemo({ content }: { content: ContentIndex }) {
  const pool = useMemo(() => gamePool(content, new Set()), [content]);
  const options = useMemo(() => ({ rounds: 5 }), []);
  const [last, setLast] = useState<string>("");
  return (
    <div className="flex flex-1 flex-col gap-3">
      <ChoNoi
        content={content}
        concepts={pool.concepts}
        seed="demo"
        options={options}
        onSkip={() => setLast(JSON.stringify({ kind: "skip" }))}
        onFinish={(result) => setLast(JSON.stringify(result))}
        resultActions={(_, replay) => <Button onClick={replay}>Rejouer</Button>}
      />
      {last && <pre className="rounded-xl bg-muc p-3 text-sm text-nuoc">{last}</pre>}
    </div>
  );
}

function fakePlay(result: PlaybackSource) {
  return () => new Promise<PlaybackSource>((resolve) => setTimeout(() => resolve(result), 150));
}

function AudioButtonDemo() {
  return (
    <div className="flex flex-col gap-8">
      <Variant label="Grand, avec lent — audio natif">
        <AudioButton play={fakePlay("native")} autoPlay={false} />
      </Variant>
      <Variant label="Petit, sans lent — voix de synthèse (marqueur)">
        <AudioButton play={fakePlay("tts")} autoPlay={false} large={false} withSlow={false} />
      </Variant>
      <Variant label="Audio manquant (marqueur)">
        <AudioButton play={fakePlay("missing")} autoPlay={false} large={false} />
      </Variant>
    </div>
  );
}

function RiverPathDemo({ content }: { content: ContentIndex }) {
  const lessons: LessonId[] = content.curriculum.units.flatMap((u) => (u.status === "available" ? u.lessons : []));
  const states: { label: string; completed: Set<LessonId>; current: LessonId | null }[] = [
    { label: "Début : rien de terminé", completed: new Set(), current: lessons[0] ?? null },
    { label: "Première leçon terminée", completed: new Set(lessons.slice(0, 1)), current: lessons[1] ?? null },
    { label: "Tout terminé", completed: new Set(lessons), current: null },
  ];
  return (
    <div className="flex flex-col gap-10">
      {states.map((s) => (
        <Variant key={s.label} label={s.label}>
          <RiverPath content={content} completed={s.completed} current={s.current} />
        </Variant>
      ))}
    </div>
  );
}

const INSTALL_DISMISS_KEY = "parlo.installHint.dismissed";

function InstallHintDemo() {
  const [mount, setMount] = useState(0);
  const simulatePrompt = () => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: () => Promise.resolve() });
    window.dispatchEvent(event);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-phu-sa">
        États : masqué (ni invite ni iOS, ou refusé), Android (après beforeinstallprompt), iOS (émulation d'un iPhone dans les outils du navigateur).
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="min-h-11 rounded-xl border-2 border-ngoc/30 px-3 text-ngoc" onClick={simulatePrompt}>Simuler beforeinstallprompt</button>
        <button
          type="button"
          className="min-h-11 rounded-xl border-2 border-ngoc/30 px-3 text-ngoc"
          onClick={() => { localStorage.removeItem(INSTALL_DISMISS_KEY); setMount((m) => m + 1); }}
        >
          Oublier « Plus tard »
        </button>
      </div>
      <Variant label="InstallHint">
        <InstallHint key={mount} />
      </Variant>
    </div>
  );
}

function Variant({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-phu-sa">{label}</p>
      <div className="rounded-2xl border-2 border-dashed border-phu-sa/20 p-4">{children}</div>
    </div>
  );
}
