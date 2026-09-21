import { isMemoEmpty, type ContentIndex, type LessonId, type MemoEntry, type MemoSheet, type Unit } from "@parlo/core";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Vi } from "../components/ui.tsx";
import { Card, EmptyState, Icon, PageHeader, SectionTitle, Skeleton, staggerStyle, type IconName } from "../design/index.ts";
import { l, plural, t, type MessageKey } from "../i18n/index.ts";
import { Screen } from "../components/ui.tsx";
import { progressState } from "../learner.ts";
import { buildMemoSheet, canSharePdf, downloadMemo, downloadUnitMemos } from "./download.ts";

/**
 * Les fiches mémoire, hors du bilan (contrat phase23 §4) : la liste de ce qu'on a terminé, et une
 * fiche lue à l'écran.
 *
 * Pourquoi un écran, alors que la fiche est faite pour être un PDF : parce qu'on ne télécharge pas
 * un fichier pour vérifier ce qu'il contient. La page montre la fiche telle qu'elle sera imprimée,
 * et le bouton est là si elle convient.
 *
 * Seuls les niveaux **terminés** ont leur fiche : une fiche d'un niveau jamais joué donnerait les
 * réponses de ses exercices.
 */

/* --------------------------------------------------------------- La liste */

interface UnitRow {
  unit: Unit;
  lessons: { id: LessonId; title: string }[];
}

export function MemoListPage({ content }: { content: ContentIndex }) {
  const [rows, setRows] = useState<UnitRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void progressState(content).then((progress) => {
      if (!live) return;
      // `core.json` suffit : titres et découpage en unités y sont. Aucune unité n'est téléchargée
      // pour afficher la liste — elles ne le seront qu'à l'ouverture d'une fiche.
      const done = progress.completed;
      setRows(
        content.curriculum.units
          .map((unit) => ({
            unit,
            lessons: unit.lessons
              .filter((id) => done.has(id))
              .map((id) => ({ id, title: l(content.lessons.get(id)?.title ?? { fr: id }) })),
          }))
          .filter((row) => row.lessons.length > 0),
      );
    });
    return () => {
      live = false;
    };
  }, [content]);

  const total = (rows ?? []).reduce((sum, row) => sum + row.lessons.length, 0);

  return (
    <Screen top={<PageHeader title={t("memo.title")} subtitle={t("memo.subtitle")} back="/reviser" backLabel={t("common.back")} />}>
      {rows === null ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" rounded="card" />
          <Skeleton className="h-24 w-full" rounded="card" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center">
          <EmptyState art="page" title={t("memo.list.empty")} body={t("memo.offline")} />
        </div>
      ) : (
        <>
          <p className="pb-4 text-phu-sa">{plural("memo.list.count.one", "memo.list.count", total)}</p>
          <ul className="flex flex-col gap-4" data-testid="memo-units">
            {rows.map((row, i) => (
              <li key={row.unit.id} style={staggerStyle(i)} className="motion-safe:parlo-enter">
                <SectionTitle tone="strong" icon="boat" className="pb-2">{l(row.unit.title)}</SectionTitle>
                <Card className="flex flex-col">
                  {row.lessons.map((lesson) => (
                    <Link
                      key={lesson.id}
                      to={`/fiches/${encodeURIComponent(lesson.id)}`}
                      data-testid="memo-entry"
                      data-lesson={lesson.id}
                      className="flex min-h-12 items-center gap-3 border-t border-line first:border-t-0"
                    >
                      <Icon name="notebook" size={18} className="shrink-0 text-phu-sa" />
                      <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                      <Icon name="chevronRight" size={18} className="shrink-0 text-phu-sa" />
                    </Link>
                  ))}
                  {/* Le thème entier en un PDF : la forme qu'on imprime avant un voyage. */}
                  {row.lessons.length > 1 && (
                    <button
                      type="button"
                      data-testid="memo-download-unit"
                      disabled={busy === row.unit.id}
                      onClick={() => {
                        setBusy(row.unit.id);
                        void downloadUnitMemos(content, row.unit.id, row.lessons.map((lesson) => lesson.id))
                          .catch(() => undefined)
                          .finally(() => setBusy(null));
                      }}
                      className="flex min-h-12 items-center gap-3 border-t border-line font-semibold text-ngoc disabled:text-phu-sa"
                    >
                      <Icon name="download" size={18} />
                      <span className="min-w-0 flex-1 text-left">{t(busy === row.unit.id ? "memo.downloading" : "memo.list.downloadUnit")}</span>
                    </button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  );
}

/* ---------------------------------------------------------------- La fiche */

export function MemoSheetPage({ content }: { content: ContentIndex }) {
  const { lessonId } = useParams();
  const id = (lessonId ? decodeURIComponent(lessonId) : "") as LessonId;
  const [sheet, setSheet] = useState<MemoSheet | null | "missing">(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    let live = true;
    void buildMemoSheet(content, id)
      .then((next) => live && setSheet(next && !isMemoEmpty(next) ? next : "missing"))
      .catch(() => live && setSheet("missing"));
    return () => {
      live = false;
    };
  }, [content, id]);

  if (sheet === "missing") {
    return (
      <Screen top={<PageHeader title={t("memo.title")} back="/fiches" backLabel={t("common.back")} />}>
        <div className="flex flex-1 flex-col justify-center">
          <EmptyState art="page" title={t("memo.list.empty")} />
        </div>
      </Screen>
    );
  }

  const run = async (mode: "download" | "share") => {
    setState("busy");
    try {
      await downloadMemo(content, id, mode);
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <Screen
      top={<PageHeader title={sheet ? l(sheet.title) : t("memo.title")} subtitle={sheet ? l(sheet.unitTitle) : undefined} back="/fiches" backLabel={t("common.back")} />}
      action={
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => void run("download")}
            disabled={!sheet || state === "busy"}
            data-testid="memo-download"
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-card bg-ngoc px-6 text-lg font-semibold text-nuoc shadow-card transition-transform disabled:bg-phu-sa/20 disabled:text-phu-sa disabled:shadow-none motion-safe:active:scale-[.98]"
          >
            <Icon name="download" size={22} />
            {t(state === "busy" ? "memo.downloading" : "memo.download")}
          </button>
          {/* Partager : un geste en plus, jamais à la place du téléchargement (contrat phase23 §4). */}
          {canSharePdf() && (
            <button
              type="button"
              onClick={() => void run("share")}
              disabled={!sheet || state === "busy"}
              data-testid="memo-share"
              className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc disabled:text-phu-sa"
            >
              <Icon name="share" size={18} />
              {t("memo.share")}
            </button>
          )}
        </div>
      }
    >
      {sheet === null ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-20 w-full" rounded="card" />
          <Skeleton className="h-40 w-full" rounded="card" />
        </div>
      ) : (
        <article className="flex flex-col gap-5" data-testid="memo-sheet" data-lesson={id}>
          <Card tone="feature" as="section">
            <h2 className="text-sm font-semibold text-phu-sa">{t("memo.section.goal")}</h2>
            <p className="pt-1 text-lg">{l(sheet.goal)}</p>
          </Card>

          <Entries label="memo.section.words" icon="cards" entries={sheet.words} />
          <Entries label="memo.section.structures" icon="grammar" entries={sheet.structures} />
          <Entries label="memo.section.sounds" icon="sound" entries={sheet.sounds} />

          {sheet.phrases.length > 0 && (
            <Section label="memo.section.phrases" icon="dialogue">
              <ul className="flex flex-col gap-3">
                {sheet.phrases.map((phrase) => (
                  <li key={phrase.vi} className="border-b border-line pb-2 last:border-b-0 last:pb-0">
                    <Vi size="lg">{phrase.vi}</Vi>
                    <p className="text-sm text-phu-sa">{l(phrase.translation)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {sheet.tips.length > 0 && (
            <Section label="memo.section.tips" icon="star">
              <ul className="flex flex-col gap-2">
                {sheet.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-nghe" aria-hidden />
                    <span className="min-w-0">{l(tip)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {sheet.pitfalls.length > 0 && (
            <Section label="memo.section.pitfalls" icon="alert">
              <ul className="flex flex-col gap-2">
                {sheet.pitfalls.map((pitfall) => (
                  <li key={pitfall.vi} className="flex flex-col">
                    <span>{t("memo.pitfall.line", { south: pitfall.vi, north: pitfall.north })}</span>
                    <span className="text-sm text-phu-sa">{l(pitfall.gloss)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {sheet.culture.length > 0 && (
            <Section label="memo.section.culture" icon="lantern">
              <ul className="flex flex-col gap-3">
                {sheet.culture.map((card) => (
                  <li key={l(card.title)}>
                    <p className="font-semibold">{l(card.title)}</p>
                    {card.vi && <Vi size="lg">{card.vi}</Vi>}
                    <p className="text-sm text-phu-sa">{l(card.body)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {sheet.dialogues.map((dialogue) => (
            <Section key={l(dialogue.title)} label="memo.section.dialogues" icon="dialogue">
              <p className="pb-2 font-semibold">{l(dialogue.title)}</p>
              <ul className="flex flex-col gap-2.5">
                {dialogue.turns.map((turn, i) => (
                  <li key={i}>
                    <p className="text-sm font-semibold text-ngoc">{turn.speaker}</p>
                    <Vi size="lg">{turn.vi}</Vi>
                    <p className="text-sm text-phu-sa">{l(turn.translation)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          ))}

          <p className="min-h-[1.3125rem] text-sm" role="status">
            {state === "done" && <span className="text-ngoc">{t("memo.downloaded")}</span>}
            {state === "error" && <span className="text-son-mai">{t("memo.error")}</span>}
            {state !== "done" && state !== "error" && <span className="text-phu-sa">{t("memo.offline")}</span>}
          </p>
        </article>
      )}
    </Screen>
  );
}

function Section({ label, icon, children }: { label: MessageKey; icon: IconName; children: ReactNode }) {
  return (
    <section>
      <SectionTitle tone="strong" icon={icon} className="pb-2">{t(label)}</SectionTitle>
      <Card>{children}</Card>
    </section>
  );
}

function Entries({ label, icon, entries }: { label: MessageKey; icon: IconName; entries: readonly MemoEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Section label={label} icon={icon}>
      <ul className="flex flex-col gap-3.5">
        {entries.map((entry) => (
          <li key={entry.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0" data-testid="memo-entry-word">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <Vi size="2xl">{entry.vi}</Vi>
              <span className="text-right text-phu-sa">{l(entry.gloss)}</span>
            </div>
            {(entry.ipaSouth || entry.register) && (
              <p className="text-sm text-phu-sa">
                {[entry.ipaSouth, entry.register ? t(`memo.register.${entry.register}` as MessageKey) : null].filter(Boolean).join(" · ")}
              </p>
            )}
            {entry.note && <p className="text-sm text-phu-sa">{l(entry.note)}</p>}
            {entry.examples.map((example) => (
              <p key={example.vi} className="mt-1 border-l-2 border-nghe pl-3">
                <Vi size="lg">{example.vi}</Vi>
                <span className="block text-sm text-phu-sa">{l(example.translation)}</span>
              </p>
            ))}
          </li>
        ))}
      </ul>
    </Section>
  );
}
