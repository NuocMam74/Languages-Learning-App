import { type ContentIndex, type UnitId } from "@parlo/core";
import { useEffect, useState } from "react";
import { loadPack } from "../content.ts";
import { Chip, EmptyState, Icon, ProgressBar, Skeleton } from "../design/index.ts";
import { getLocale, t } from "../i18n/index.ts";
import { offlineQuotaBytes, storageEstimate, useOffline } from "./downloads.ts";
import { formatBytes } from "./lru.ts";
import { OfflineUnit } from "./OfflineUnit.tsx";
import { likelyUnits } from "./prefetch.ts";

/**
 * Réglages → Hors ligne (spec §8.1) : espace utilisé, stockage persistant, quota, unités à
 * télécharger ou retirer.
 *
 * L'espace occupé se lit d'abord comme une barre, pas comme une phrase : c'est la seule donnée
 * de l'écran qu'on veut jauger d'un coup d'œil (contrat phase8 §1).
 */
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

  if (!content?.split) {
    return (
      // Le pack découpé arrive d'IndexedDB : des barres en creux, jamais une ligne « Chargement… » nue.
      <div className="flex flex-col gap-3" aria-busy="true">
        <span className="sr-only">{t("offline.loading")}</span>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-11 w-full" rounded="card" />
        <Skeleton className="h-11 w-full" rounded="card" />
      </div>
    );
  }
  const locale = getLocale();
  const ready = Object.values(rows).filter((r) => r.code === content.pack.code && r.status === "ready");
  const units = content.curriculum.units.filter((u) => u.status === "available" && content.split?.units.has(u.id));

  return (
    <div className="flex flex-col gap-4" data-testid="offline-settings">
      <p className="flex items-start gap-3 text-sm text-phu-sa">
        <Icon name="offline" size={20} className="mt-0.5 shrink-0 text-ngoc" />
        <span className="min-w-0 flex-1">{t("offline.intro")}</span>
      </p>

      <div className="flex flex-col gap-2 rounded-card bg-surface-2 px-4 py-3">
        {estimate && estimate.quota > 0 && (
          <>
            <ProgressBar
              value={Math.min(estimate.usage, estimate.quota)}
              max={estimate.quota}
              size="sm"
              tone={estimate.usage / estimate.quota > 0.9 ? "son-mai" : "ngoc"}
              label={t("offline.storage.usage", { usage: formatBytes(estimate.usage, locale), quota: formatBytes(estimate.quota, locale) })}
            />
            <p className="text-sm" data-testid="storage-estimate">{t("offline.storage.usage", { usage: formatBytes(estimate.usage, locale), quota: formatBytes(estimate.quota, locale) })}</p>
          </>
        )}
        {estimate && <p className="text-sm text-phu-sa">{t(estimate.persisted ? "offline.storage.persisted" : "offline.storage.notPersisted")}</p>}
        <p className="text-sm text-phu-sa">{t("offline.quota", { size: formatBytes(offlineQuotaBytes(), locale) })}</p>
        {ready.length > 0 && (
          <p className="flex items-center gap-2 text-sm font-medium" data-testid="offline-total">
            <Icon name="cloud" size={16} className="text-ngoc" />
            {t("offline.total", { n: ready.length, size: formatBytes(ready.reduce((s, r) => s + r.bytes, 0), locale) })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-phu-sa">
          <Icon name="book" size={16} className="text-ngoc" />
          {t("offline.units")}
          <Chip tone="neutral">{units.length}</Chip>
        </h3>
        {units.length === 0 ? (
          <EmptyState art="boat" compact title={t("offline.units.empty")} />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {units.map((unit) => (
              <li key={unit.id} className="py-2.5">
                <OfflineUnit content={content} unitId={unit.id} current={unit.id === current} protect={current ? [current] : []} showTitle />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
