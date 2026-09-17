/**
 * Worker de service de la PWA (Cloudflare Workers Static Assets, scénario A du README).
 *
 * Il ne fait que trois choses que le service de fichiers statiques ne fait pas de façon garantie :
 *
 *  1. `/api/*` répond un **404 franc avec un corps JSON**. Sans ça, un déploiement sans API
 *     laisserait `POST /api/auth/refresh` tomber dans le repli monopage et recevoir `index.html`
 *     en 200 : `refreshSession` (apps/web/src/api.ts) échouerait à le lire en JSON et conclurait
 *     « réseau injoignable » — l'app s'afficherait hors ligne en permanence au lieu de rester
 *     tranquillement en mode invité.
 *
 *  2. Le **repli monopage** : `/missions`, `/atelier`, `/recompenses`… sont de vraies URL, ouvertes
 *     directement ou rechargées. Elles doivent rendre `index.html`.
 *
 *  3. `sw.js` est servi en `Cache-Control: no-cache`, sans quoi une version périmée du service
 *     worker pourrait s'installer durablement.
 *
 * `not_found_handling` reste à `"none"` dans wrangler.jsonc, exprès : le repli est écrit ici, en
 * clair, plutôt que de dépendre de l'ordre de priorité entre la couche d'assets et ce Worker.
 */

const API_UNAVAILABLE = { detail: "api_unavailable" };

/**
 * Le service worker doit être **revalidé à chaque fois** : c'est lui qui annonce les mises à jour
 * (registerType "prompt", src/sw.ts). Mis en cache, l'app resterait sur une version périmée. Il
 * passe donc par ici (`run_worker_first` dans wrangler.jsonc) pour que l'en-tête soit garanti,
 * sans dépendre du support de `_headers`.
 */
async function serviceWorker(request, env) {
  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(asset.body, { status: asset.status, headers });
}

export default {
  /**
   * Appelé pour `/sw.js` (via `run_worker_first`) et pour tout chemin **sans** fichier statique
   * correspondant. Le reste — `/`, `/assets/*`, `/content/*` — est servi directement par la couche
   * d'assets, sans passer ici.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/sw.js") return serviceWorker(request, env);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return Response.json(API_UNAVAILABLE, { status: 404 });
    }

    // Un POST ou un PUT sur une URL inconnue n'est pas une navigation : rendre l'app n'aurait
    // aucun sens, et masquerait une erreur.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Not found", { status: 404 });
    }

    // La racine, et **pas** `/index.html` : la couche d'assets redirige `/index.html` vers `/`, et
    // reprendre le corps (vide) de cette redirection en le forçant en 200 rendait une page blanche,
    // sans `Content-Type`, avec un `Location` parasite — donc refusée par le `nosniff` de `_headers`.
    const index = await env.ASSETS.fetch(new Request(new URL("/", url.origin), request));
    // Servi tel quel, avec ses en-têtes, mais en 200 : c'est l'application qui répond, pas une erreur.
    return new Response(index.body, { status: 200, headers: index.headers });
  },
};
