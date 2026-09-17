/**
 * Caches partagés par le service worker (src/sw.ts) et le téléchargement hors ligne des unités
 * (spec §8.1) : un média mis en cache par la page est servi tel quel par le service worker.
 * Module sans dépendance (importé par le service worker).
 */

export const CONTENT_CACHE = "content-v1";
export const AUDIO_CACHE = "audio-v1";
export const IMAGE_CACHE = "images-v1";

/** Fichiers d'unité (versionnés, donc immuables). */
export const UNIT_PATH = /^\/content\/[^/]+\/v\d+\/units\/[^/]+\.json$/;
/** Manifeste : jamais servi depuis le cache si le réseau répond. */
export const LATEST_PATH = /^\/content\/[^/]+\/latest\.json$/;
export const AUDIO_PATH = /^\/content\/.+\.(opus|m4a)$/;
export const IMAGE_PATH = /^\/content\/.+\.(webp|png|svg)$/;

/** Cache d'un média selon son extension (courbes F0 `.json` : cache du contenu). */
export function cacheForPath(path: string): string {
  if (/\.(opus|m4a)$/i.test(path)) return AUDIO_CACHE;
  if (/\.(webp|png|svg)$/i.test(path)) return IMAGE_CACHE;
  return CONTENT_CACHE;
}
