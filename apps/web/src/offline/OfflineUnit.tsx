import { type ContentIndex, type UnitId } from "@parlo/core";
import { useEffect, useState } from "react";
import { offlineKey } from "../db.ts";
import { getLocale, l, t } from "../i18n/index.ts";
import { useOnline } from "../use-online.ts";
import { downloadUnit, removeOfflineUnit, unitSize, useOffline } from "./downloads.ts";
import { formatBytes } from "./lru.ts";

export type OfflineUnitState = "none" | "downloading" | "ready" | "stale" | "error";

/** Action « Rendre disponible hors ligne (≈ 2,4 Mo) » d'une unité : taille, progression, état, retrait (spec §8.1). */
export function OfflineUnit({ content, unitId, current = false, protect = [], showTitle = false }: {
  content: ContentIndex;
  unitId: UnitId;
  /** Unité en cours : jamais purgée par le quota. */
  current?: boolean;
  protect?: readonly UnitId[];
  showTitle?: boolean;
}) {
  const code = content.pack.code;
  const key = offlineKey(code, unitId);
  const row = useOffline((s) => s.rows[key]);
  const progress = useOffline((s) => s.progress[key]);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const size = unitSize(content, unitId);

  useEffect(() => {
    void useOffline.getState().refresh(code);
  }, [code]);

  if (size === null) return null;
  const locale = getLocale();
  const state: OfflineUnitState = row?.status === "downloading" || progress
    ? "downloading"
    : row?.status === "error"
      ? "error"
      : row?.status === "ready"
        ? row.version === content.pack.version ? "ready" : "stale"
        : "none";
  // Sans réseau, rien à télécharger : seul l'état « disponible » reste utile.
  if (!online && state !== "ready" && state !== "downloading") return null;
  const unit = content.curriculum.units.find((u) => u.id === unitId);

  const download = () => {
    setBusy(true);
    void downloadUnit(code, content.pack.version, unitId, { protect: [...protect, ...(current ? [unitId] : [])] })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-1" data-testid="offline-unit" data-unit={unitId} data-state={state}>
      {showTitle && unit && (
        <p className="font-medium">
          {l(unit.title)}
          {current && <span className="ml-2 text-sm font-normal text-phu-sa">· {t("offline.unit.current")}</span>}
        </p>
      )}
      {state === "downloading" ? (
        <div className="flex flex-col gap-1" aria-live="polite">
          <p className="text-sm text-phu-sa">{t("offline.unit.downloading", { done: progress?.done ?? 0, total: progress?.total ?? 1 })}</p>
          <div className="h-2 overflow-hidden rounded-full bg-phu-sa/10" role="progressbar" aria-valuemin={0} aria-valuemax={progress?.total ?? 1} aria-valuenow={progress?.done ?? 0}>
            <div className="h-full rounded-full bg-ngoc transition-[width]" style={{ width: `${((progress?.done ?? 0) / Math.max(1, progress?.total ?? 1)) * 100}%` }} />
          </div>
        </div>
      ) : state === "ready" ? (
        <p className="flex flex-wrap items-center gap-x-4 text-sm">
          <span className="text-ngoc">
            <svg viewBox="0 0 24 24" className="mr-1 inline size-4 align-[-2px]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            {t("offline.unit.ready", { size: formatBytes(row?.bytes || size, locale) })}
          </span>
          <button type="button" className="min-h-11 font-semibold text-ngoc" disabled={busy} onClick={() => void removeOfflineUnit(code, unitId)}>
            {t("offline.unit.remove")}
          </button>
        </p>
      ) : (
        <button type="button" className="min-h-11 self-start text-left text-sm font-semibold text-ngoc" disabled={busy} onClick={download}>
          {state === "error" ? t("offline.unit.retry") : state === "stale" ? t("offline.unit.update") : t("offline.unit.download", { size: formatBytes(size, locale) })}
        </button>
      )}
    </div>
  );
}
