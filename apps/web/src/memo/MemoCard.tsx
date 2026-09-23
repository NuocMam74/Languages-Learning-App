import { isMemoEmpty, memoEssentials, type ContentIndex, type LessonId, type MemoSheet } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Vi } from "../components/ui.tsx";
import { Card, Icon } from "../design/index.ts";
import { l, t } from "../i18n/index.ts";
import { buildMemoSheet, canSharePdf, downloadMemo } from "./download.ts";

/**
 * La fiche mémoire au bilan d'un niveau (contrat phase23 §4).
 *
 * Placée là parce que c'est **le seul moment où l'on sait ce qu'on vient d'apprendre** : une
 * heure plus tard, la fiche est une page de plus à aller chercher. Le bouton fabrique le PDF sur
 * l'appareil — donc hors ligne, donc en mode invité.
 *
 * Rien ne s'affiche si le niveau n'a rien à retenir : une carte « ta fiche » vide serait pire que
 * pas de carte du tout.
 */
export function MemoCard({ content, lessonId }: { content: ContentIndex; lessonId: LessonId }) {
  const [sheet, setSheet] = useState<MemoSheet | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    let live = true;
    void buildMemoSheet(content, lessonId)
      .then((next) => live && setSheet(next && !isMemoEmpty(next) ? next : null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [content, lessonId]);

  if (!sheet) return null;

  const run = async (mode: "download" | "share") => {
    setState("busy");
    try {
      await downloadMemo(content, lessonId, mode);
      setState("done");
    } catch {
      setState("error");
    }
  };

  const whole = content.lessons.get(lessonId)?.kind === "unit_test";
  const essentials = memoEssentials(content, sheet);

  return (
    <Card tone="notice" as="section" className="flex flex-col gap-3" data-testid="memo-card" data-scope={whole ? "unit" : "lesson"}>
      <p className="flex items-center gap-2 font-semibold">
        <Icon name="notebook" size={20} className="text-nghe-ecrit" />
        {t(whole ? "memo.recap.unitTitle" : "memo.recap.title")}
      </p>
      <p className="text-sm text-phu-sa">{t(whole ? "memo.recap.unitBody" : "memo.recap.body")}</p>

      {/* Le pense-bête lui-même, à relire avant de fermer l'écran (contrat phase26 §5) : un
          bouton de téléchargement seul ne faisait rien retenir. */}
      <div className="flex flex-col gap-3" data-testid="memo-essentials">
        {essentials.words.length > 0 && (
          <div>
            <p className="pb-1 text-sm font-semibold">{t("memo.essentials.words")}</p>
            <ul className="flex flex-col gap-1">
              {essentials.words.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Vi className="font-semibold">{entry.vi}</Vi>
                  <span className="text-sm text-phu-sa">{l(entry.gloss)}</span>
                </li>
              ))}
            </ul>
            {essentials.moreWords > 0 && <p className="pt-1 text-sm text-phu-sa">{t("memo.essentials.more", { n: essentials.moreWords })}</p>}
          </div>
        )}
        {essentials.rules.length > 0 && (
          <div>
            <p className="pb-1 text-sm font-semibold">{t("memo.essentials.rules")}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {essentials.rules.map((rule) => (
                <li key={rule.fr}>{l(rule)}</li>
              ))}
            </ul>
          </div>
        )}
        {essentials.pitfalls.length > 0 && (
          <div>
            <p className="pb-1 text-sm font-semibold">{t("memo.section.pitfalls")}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {essentials.pitfalls.map((pitfall) => (
                <li key={pitfall.vi}>{t("memo.pitfall.line", { south: pitfall.vi, north: pitfall.north })}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button
          type="button"
          onClick={() => void run("download")}
          disabled={state === "busy"}
          data-testid="memo-download"
          className="flex min-h-12 items-center gap-2 rounded-card border-2 border-ngoc bg-surface px-5 font-semibold text-ngoc transition-transform disabled:border-line-strong disabled:text-phu-sa motion-safe:active:scale-[.98]"
        >
          <Icon name="download" size={20} />
          {t(state === "busy" ? "memo.downloading" : "memo.download")}
        </button>
        {/* Le partage est un **second** geste, offert là où le système en a un : le premier bouton
            télécharge, toujours (contrat phase23 §4). */}
        {canSharePdf() && (
          <button
            type="button"
            onClick={() => void run("share")}
            disabled={state === "busy"}
            data-testid="memo-share"
            className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc disabled:text-phu-sa"
          >
            <Icon name="share" size={18} />
            {t("memo.share")}
          </button>
        )}
        <Link to={`/fiches/${encodeURIComponent(lessonId)}`} className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc">
          {t("memo.recap.open")}
          <Icon name="chevronRight" size={18} />
        </Link>
      </div>
      {/* Ligne d'état toujours présente : le message d'arrivée ne pousse pas la carte (CLS). */}
      <p className="min-h-[1.3125rem] text-sm" role="status">
        {state === "done" && <span className="text-ngoc">{t("memo.downloaded")}</span>}
        {state === "error" && <span className="text-son-mai">{t("memo.error")}</span>}
        {state === "idle" && <span className="text-phu-sa">{t("memo.offline")}</span>}
      </p>
    </Card>
  );
}
