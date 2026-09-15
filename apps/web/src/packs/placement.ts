import type { PlacementSpec } from "@parlo/core";

/**
 * Mini-test de placement : fichier facultatif d'un pack (content/<pack>/placement.json).
 * Découvert au build (aucune liste de packs dans le code) ; un pack sans placement
 * passe directement de l'onboarding à sa première leçon.
 */
const loaders = import.meta.glob<PlacementSpec>("../../../../content/*/placement.json", { import: "default" });

function keyFor(pack: string): string | undefined {
  return Object.keys(loaders).find((k) => k.endsWith(`/content/${pack}/placement.json`));
}

export function hasPlacement(pack: string): boolean {
  return keyFor(pack) !== undefined;
}

export async function loadPlacement(pack: string): Promise<PlacementSpec | null> {
  const key = keyFor(pack);
  const load = key ? loaders[key] : undefined;
  return load ? load() : null;
}
