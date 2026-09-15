import type { Concept, ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Screen, Vi } from "../components/ui.tsx";
import { getKv, setKv } from "../db.ts";
import { l, t } from "../i18n/index.ts";
import { completedLessons } from "../learner.ts";
import { KaraokeExercise } from "./KaraokeExercise.tsx";
import { loadReference } from "./reference.ts";

/**
 * Karaoké tonal seul (onglet Jeux, /jeux/karaoke_tonal) : phrases des leçons terminées qui ont
 * une courbe de voix native ; à défaut, toutes celles du pack qui en ont une.
 */

const BEST_KEY = "karaoke.best";
const MAX_CANDIDATES = 40;

interface Candidate {
  concept: Concept;
  pitchRef: string | null;
}

/** Concepts dont le contenu déclare une courbe (champ `pitch`, `pitchRef` d'étape, tone_produce), dans l'ordre du parcours. */
export function karaokeCandidates(content: ContentIndex, completed: ReadonlySet<string>): { known: Candidate[]; all: Candidate[] } {
  const seen = new Map<string, Candidate>();
  const known = new Set<string>();
  const lessonIds = content.curriculum.units.flatMap((u) => u.lessons);
  for (const lessonId of [...new Set([...lessonIds, ...content.lessons.keys()])]) {
    const lesson = content.lessons.get(lessonId);
    if (!lesson) continue;
    for (const step of lesson.steps) {
      if (step.type !== "speak_repeat" && step.type !== "tone_produce") continue;
      const concept = content.concepts.get(step.concept);
      if (!concept) continue;
      const pitchRef = step.type === "speak_repeat" ? (step.pitchRef ?? concept.pitch ?? null) : (concept.pitch ?? null);
      if (!pitchRef && step.type === "speak_repeat") continue;
      if (!seen.has(concept.id)) seen.set(concept.id, { concept, pitchRef });
      if (completed.has(lesson.id)) known.add(concept.id);
    }
  }
  for (const concept of content.concepts.values()) if (concept.pitch && !seen.has(concept.id)) seen.set(concept.id, { concept, pitchRef: concept.pitch });
  const all = [...seen.values()].slice(0, MAX_CANDIDATES);
  return { known: all.filter((c) => known.has(c.concept.id)), all };
}

export default function KaraokePage({ content }: { content: ContentIndex }) {
  const [pool, setPool] = useState<{ items: Candidate[]; fromKnown: boolean } | null>(null);
  const [bests, setBests] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState<Candidate | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [completed, stored] = await Promise.all([completedLessons(), getKv<Record<string, number>>(BEST_KEY, {})]);
      const { known, all } = karaokeCandidates(content, completed);
      const available = async (list: Candidate[]) => {
        const refs = await Promise.all(list.map((c) => loadReference(content, c.concept, c.pitchRef)));
        return list.filter((_, i) => refs[i] !== null);
      };
      const knownOk = await available(known);
      const items = knownOk.length > 0 ? knownOk : await available(all);
      if (alive) {
        setBests(stored);
        setPool({ items, fromKnown: knownOk.length > 0 });
      }
    })();
    return () => {
      alive = false;
    };
  }, [content]);

  const back = (
    <Link to="/jeux" className="-ml-2 flex min-h-11 items-center gap-1 self-start px-2 text-ngoc" onClick={(e) => { if (current) { e.preventDefault(); setCurrent(null); } }}>
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {current ? t("karaoke.game.pick") : t("games.back")}
    </Link>
  );

  if (current) {
    const record = bests[current.concept.id];
    const onSubmit = (score: number | null) => {
      if (score !== null && score > (record ?? -1)) {
        const next = { ...bests, [current.concept.id]: score };
        setBests(next);
        void setKv(BEST_KEY, next);
      }
      setCurrent(null);
    };
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]">
        {back}
        <main className="flex flex-1 flex-col pt-2">
          <KaraokeExercise
            key={current.concept.id}
            content={content}
            concept={current.concept}
            pitchRef={current.pitchRef}
            mode="repeat"
            sessionId={null}
            onSubmit={onSubmit}
            prompt={t("karaoke.game.title")}
            continueLabel={t("karaoke.game.next")}
            extra={record !== undefined ? <p className="text-sm font-semibold text-ngoc">{t("karaoke.game.bestFor", { n: record })}</p> : null}
          />
        </main>
      </div>
    );
  }

  return (
    <Screen top={back}>
      <h1 className="font-serif text-2xl">{t("karaoke.game.title")}</h1>
      <p className="pb-6 text-phu-sa">{t("karaoke.game.tagline")}</p>
      {!pool ? (
        <p className="text-phu-sa">{t("games.loading")}</p>
      ) : pool.items.length === 0 ? (
        <p className="text-lg text-phu-sa">{t("karaoke.game.none")}</p>
      ) : (
        <section>
          <h2 className="pb-2 text-phu-sa">{pool.fromKnown ? t("karaoke.game.poolKnown") : t("karaoke.game.poolAll")}</h2>
          <ul className="flex flex-col" data-testid="karaoke-list">
            {pool.items.map((c) => (
              <li key={c.concept.id} className="border-t border-phu-sa/10">
                <button type="button" onClick={() => setCurrent(c)} className="flex min-h-16 w-full items-baseline justify-between gap-4 py-3 text-left">
                  <Vi size="2xl">{c.concept.vi}</Vi>
                  <span className="flex flex-col items-end text-right text-sm text-phu-sa">
                    <span>{l(c.concept.gloss)}</span>
                    {bests[c.concept.id] !== undefined && <span className="font-semibold text-ngoc">{t("karaoke.game.bestFor", { n: bests[c.concept.id]! })}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  );
}
