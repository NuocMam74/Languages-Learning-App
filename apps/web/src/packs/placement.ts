import { placementPlan, playablePlacement, type ContentIndex, type PlacementPlan, type PlacementSpec } from "@parlo/core";
import { cachedPackFiles, packFiles } from "../content.ts";
import { playableOptions } from "../media.ts";

/**
 * Mini-test de placement : fichier facultatif d'un pack (content/<pack>/placement.json), livré dans
 * le bundle (contrat phase5 §6). Proposé seulement s'il reste au moins 6 items jouables (items de
 * ton sans audio natif retirés, contrat phase5 §1) ; sinon passé automatiquement.
 */

export function hasPlacement(pack: string): boolean {
  return Boolean(cachedPackFiles(pack)?.placement);
}

export async function loadPlacement(pack: string): Promise<PlacementSpec | null> {
  return (cachedPackFiles(pack) ?? (await packFiles(pack)))?.placement ?? null;
}

/** Placement jouable du pack chargé, ou null (pas de fichier, pas assez d'items jouables). */
/** Le test tel qu'il se passera : à l'écoute, ou à l'écrit faute de voix natives (contrat phase26 §6). */
export function placementPlanFor(content: ContentIndex): PlacementPlan | null {
  const spec = cachedPackFiles(content.pack.code)?.placement;
  return spec ? placementPlan(content, spec, playableOptions(content)) : null;
}

export function playablePlacementFor(content: ContentIndex): PlacementSpec | null {
  const spec = cachedPackFiles(content.pack.code)?.placement;
  return spec ? playablePlacement(content, spec, playableOptions(content)) : null;
}
