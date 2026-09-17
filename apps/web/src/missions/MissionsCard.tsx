import type { ContentIndex } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, Chip, Icon, ProgressBar } from "../design/index.ts";
import { t } from "../i18n/index.ts";
import { missionGroups, type MissionGroup, type MissionView } from "../rewards/store.ts";
import { missionLabel } from "./MissionsPage.tsx";

/**
 * Carte « missions » de l'accueil (contrat phase9 §3). Elle montre **une** mission : celle qui
 * mérite un geste maintenant — une mission finie à réclamer, sinon la plus avancée du jour.
 *
 * Elle reste sous le défi de la semaine dans la hiérarchie de l'écran (contrat §3) : une ligne
 * dense, pas une deuxième carte héroïque.
 */

/** La mission à mettre en avant : réclamable d'abord, puis la plus proche du but. */
export function pickHighlight(groups: readonly MissionGroup[]): { view: MissionView; group: MissionGroup } | null {
  const rows = groups.flatMap((group) => group.missions.map((view) => ({ view, group })));
  const claimable = rows.filter(({ view }) => view.done && view.claimedAt === null);
  if (claimable.length > 0) return claimable[0] ?? null;
  const open = rows.filter(({ view }) => view.claimedAt === null && !view.done);
  if (open.length === 0) return null;
  // La plus avancée en proportion : celle dont on est le plus près.
  return open.reduce((best, row) => (row.view.progress / row.view.mission.target > best.view.progress / best.view.mission.target ? row : best));
}

export default function MissionsCard({ content }: { content: ContentIndex }) {
  const [groups, setGroups] = useState<MissionGroup[] | null>(null);

  useEffect(() => {
    let live = true;
    void missionGroups(content.pack).then((next) => live && setGroups(next));
    return () => {
      live = false;
    };
  }, [content.pack]);

  if (groups === null) return null;
  const highlight = pickHighlight(groups);
  if (!highlight) return null;
  const { view } = highlight;
  const claimable = view.done && view.claimedAt === null;
  const claimableCount = groups.reduce((sum, group) => sum + group.missions.filter((m) => m.done && m.claimedAt === null).length, 0);

  return (
    <Card as="section" tone={claimable ? "notice" : "plain"} data-testid="dashboard-missions" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm text-phu-sa">{t("missions.title")}</h3>
          <p className="font-medium">{missionLabel(view.mission)}</p>
        </div>
        {claimable && <Chip tone="nghe" icon="star">{t("missions.claimable", { n: claimableCount })}</Chip>}
      </div>
      {!claimable && (
        <ProgressBar
          value={view.progress}
          max={view.mission.target}
          size="sm"
          label={t("missions.progress", { done: view.progress, total: view.mission.target })}
        />
      )}
      <Link to="/missions" className="flex min-h-11 items-center gap-1.5 font-semibold text-ngoc" data-testid="dashboard-missions-link">
        <Icon name="target" size={18} />
        {claimable ? t("missions.claim") : t("missions.open")}
      </Link>
    </Card>
  );
}
