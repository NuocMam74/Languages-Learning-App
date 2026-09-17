import { type ContentIndex, type UnitId } from "@parlo/core";
import { useEffect, useState } from "react";
import { loadPack } from "../content.ts";
import { getLocale, t } from "../i18n/index.ts";
import { offlineQuotaBytes, storageEstimate, useOffline } from "./downloads.ts";
import { formatBytes } from "./lru.ts";
import { OfflineUnit } from "./OfflineUnit.tsx";
import { likelyUnits } from "./prefetch.ts";

/** Réglages → Hors ligne (spec §8.1) : espace utilisé, stockage persistant, quota, unités à télécharger ou retirer. */
export function OfflineSettings() {
  const [content, setContent] = useState<ContentIndex | null>(null);
  const [current, setCurrent] = useState<UnitId | null>(null);
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const rows = useOffline((s) => s.rows);

  useEffect(() => {
    let live = true;
    void loadPack()
      .then(async (index) => {
        if (!live) return;
        setContent(index);
        setCurrent((await likelyUnits(index).catch(() => null))?.current ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    void storageEstimate().then(setEstimate);
  }, [rows]);

  if (!content?.split) return <p className="text-sm text-phu-sa">{t("offline.loading")}</p>;
  const locale = getLocale();
  const ready = Object.values(rows).filter((r) => r.code === content.pack.code && r.status === "ready");
  const units = content.curriculum.units.filter((u) => u.status === "available" && content.split?.units.has(u.id));

  return (
    <div className="flex flex-col gap-3" data-testid="offline-settings">
      <p className="text-sm text-phu-sa">{t("offline.intro")}</p>
      {estimate && estimate.quota > 0 && (
        <p className="text-sm" data-testid="storage-estimate">{t("offline.storage.usage", { usage: formatBytes(estimate.usage, locale), quota: formatBytes(estimate.quota, locale) })}</p>
      )}
      {estimate && <p className="text-sm text-phu-sa">{t(estimate.persisted ? "offline.storage.persisted" : "offline.storage.notPersisted")}</p>}
      <p className="text-sm text-phu-sa">{t("offline.quota", { size: formatBytes(offlineQuotaBytes(), locale) })}</p>
      {ready.length > 0 && (
        <p className="text-sm font-medium" data-testid="offline-total">{t("offline.total", { n: ready.length, size: formatBytes(ready.reduce((s, r) => s + r.bytes, 0), locale) })}</p>
      )}
      <h3 className="mt-2 text-sm font-semibold text-phu-sa">{t("offline.units")}</h3>
      <ul className="flex flex-col divide-y divide-phu-sa/10">
        {units.map((unit) => (
          <li key={unit.id} className="py-2">
            <OfflineUnit content={content} unitId={unit.id} current={unit.id === current} protect={current ? [current] : []} showTitle />
          </li>
        ))}
      </ul>
    </div>
  );
}
