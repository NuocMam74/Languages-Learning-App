import type { ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { Screen, Vi } from "../components/ui.tsx";
import { Chip, EmptyState, PageHeader, SectionTitle, Skeleton, staggerStyle } from "../design/index.ts";
import { getKv, setKv } from "../db.ts";
import { GameBack } from "../games/GameShell.tsx";
import { l, t } from "../i18n/index.ts";
import { completedLessons } from "../learner.ts";
import { KaraokeExercise } from "./KaraokeExercise.tsx";
import { karaokeCandidates, type Candidate } from "./candidates.ts";
import { loadReference } from "./reference.ts";

export { karaokeCandidates };

/**
 * Karaoké tonal seul (onglet Jeux, /jeux/karaoke_tonal) : phrases des leçons terminées qui ont
 * une courbe de voix native ; à défaut, toutes celles du pack qui en ont une.
 *
 * La liste des phrases est **une seule surface à lignes séparées**, pas une pile de cartes
 * identiques (interdit du contrat §1) : le choix se lit d'un coup d'œil, le mot vietnamien reste
 * l'objet visuel.
 */

const BEST_KEY = "karaoke.best";

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
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] md:max-w-[720px]">
        {/* Ici le retour annule le choix de la phrase : il reste à la même place, mais ne quitte pas l'écran. */}
        <GameBack to="/jeux" label={t("karaoke.game.pick")} onClick={(e) => { e.preventDefault(); setCurrent(null); }} />
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
            extra={record !== undefined ? <Chip tone="nghe" icon="star" className="self-start">{t("karaoke.game.bestFor", { n: record })}</Chip> : null}
          />
        </main>
      </div>
    );
  }

  return (
    <Screen top={<PageHeader title={t("karaoke.game.title")} subtitle={t("karaoke.game.tagline")} back="/jeux" backLabel={t("games.back")} />}>
      {!pool ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t("games.loading")}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" rounded="card" />
          ))}
        </div>
      ) : pool.items.length === 0 ? (
        <EmptyState art="page" title={t("karaoke.game.none")} />
      ) : (
        <section className="flex flex-col gap-3">
          <SectionTitle icon="mic">{pool.fromKnown ? t("karaoke.game.poolKnown") : t("karaoke.game.poolAll")}</SectionTitle>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card" data-testid="karaoke-list">
            {pool.items.map((c, i) => {
              const record = bests[c.concept.id];
              return (
                // Entrée en cascade sur les six premières lignes seulement (contrat §1).
                <li key={c.concept.id} className={i < 6 ? "motion-safe:parlo-enter" : ""} style={i < 6 ? staggerStyle(i) : undefined}>
                  <button
                    type="button"
                    onClick={() => setCurrent(c)}
                    className="flex min-h-16 w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <Vi size="2xl" className="min-w-0">{c.concept.vi}</Vi>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-right text-sm text-phu-sa">
                      <span>{l(c.concept.gloss)}</span>
                      {record !== undefined && <Chip tone="nghe" icon="star">{t("karaoke.game.bestFor", { n: record })}</Chip>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Screen>
  );
}
