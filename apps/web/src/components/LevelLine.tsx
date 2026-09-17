import { levelForXp, levelName, type Pack } from "@parlo/core";
import { ProgressBar } from "../design/index.ts";
import { l, t } from "../i18n/index.ts";

/** Niveau de profil 1–50 et nom de tranche du pack (contrat phase5 §3). */
export function levelLabel(pack: Pick<Pack, "levelNames">, xp: number): { value: number; name: string | null; xpIntoLevel: number; xpForNext: number } {
  const level = levelForXp(xp);
  const name = levelName(pack.levelNames, level.value);
  return { ...level, name: name ? l(name) : null };
}

export function LevelLine({ pack, xp }: { pack: Pick<Pack, "levelNames">; xp: number }) {
  const level = levelLabel(pack, xp);
  return (
    <div data-testid="level" data-level={level.value}>
      <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-sm">
        <span className="font-semibold">
          {t("journey.level.label", { n: level.value })}
          {level.name && <span className="font-normal text-phu-sa"> · {level.name}</span>}
        </span>
        <span className="text-phu-sa">
          {level.xpForNext > 0 ? t("journey.level.progress", { done: level.xpIntoLevel, total: level.xpForNext, next: level.value + 1 }) : t("journey.level.max")}
        </span>
      </div>
      {/* Curcuma : la progression de niveau est une récompense, pas un chargement (contrat phase8 §1). */}
      <ProgressBar
        value={level.xpForNext > 0 ? level.xpIntoLevel : 1}
        max={Math.max(1, level.xpForNext)}
        size="sm"
        tone="nghe"
        label={t("journey.level.label", { n: level.value })}
      />
    </div>
  );
}
