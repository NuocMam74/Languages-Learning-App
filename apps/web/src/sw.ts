import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { RangeRequestsPlugin } from "workbox-range-requests";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { AUDIO_CACHE, AUDIO_PATH, CONTENT_CACHE, IMAGE_CACHE, IMAGE_PATH, LATEST_PATH, UNIT_PATH } from "./offline/cache-names.ts";

/**
 * Service worker (injectManifest, spec §8.1, §5.8).
 *   - app shell + core.json des packs en précache ;
 *   - latest.json réseau d'abord ; unités (versionnées) cache d'abord ; autre JSON de contenu en stale-while-revalidate ;
 *   - audio en CacheFirst avec quota LRU et requêtes partielles ;
 *   - images en CacheFirst.
 * En plus : notifications push (rappel quotidien) et clic → ouverture de l'app.
 */

// Types minimaux du contexte service worker (le projet compile avec la lib DOM).
interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface PushEventLike extends ExtendableEventLike {
  data: { json(): unknown; text(): string } | null;
}
interface NotificationEventLike extends ExtendableEventLike {
  notification: Notification & { data?: unknown };
}
interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}
interface SwScope {
  registration: ServiceWorkerRegistration;
  clients: { matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<readonly WindowClientLike[]>; openWindow(url: string): Promise<unknown> };
  location: Location;
  skipWaiting(): Promise<void>;
  addEventListener(type: "push", listener: (event: PushEventLike) => void): void;
  addEventListener(type: "notificationclick", listener: (event: NotificationEventLike) => void): void;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

declare global {
  interface Window {
    __WB_MANIFEST: (string | { url: string; revision: string | null })[];
  }
}

const sw = self as unknown as SwScope;

// Les classes de plugins Workbox ne satisfont pas exactOptionalPropertyTypes : conversion explicite.
type Plugins = NonNullable<NonNullable<ConstructorParameters<typeof CacheFirst>[0]>["plugins"]>;
const plugins = (...list: object[]): Plugins => list as Plugins;

// registerType "prompt" : une nouvelle version attend (« Nouvelle version disponible — Mettre à jour »)
// et ne prend la main que sur demande de la page (jamais de rechargement au milieu d'une séance).
// Première installation : aucune version en attente, activation et contrôle immédiats.
sw.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void sw.skipWaiting();
});
clientsClaim();

cleanupOutdatedCaches();
// Écrit tel quel : workbox-build cherche la chaîne « self.__WB_MANIFEST » pour injecter le précache.
precacheAndRoute(self.__WB_MANIFEST);
// Les navigations vers l'API (démarrage OAuth, redirections du serveur) ne sont jamais servies par l'app.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

// --- Contenu (audit mobile P1 #6, spec §8.1) ----------------------------------------
// core.json du build : précaché ci-dessus. Manifeste : réseau d'abord (une nouvelle version doit se voir).
registerRoute(({ url }) => LATEST_PATH.test(url.pathname), new NetworkFirst({ cacheName: CONTENT_CACHE, networkTimeoutSeconds: 3 }));
// Fichiers d'unité versionnés, donc immuables : cache d'abord (la page les garde aussi dans IndexedDB).
registerRoute(({ url }) => UNIT_PATH.test(url.pathname), new CacheFirst({ cacheName: CONTENT_CACHE }));
// Autre JSON de contenu (core d'une version publiée après le build, courbes F0, ancien bundle.json).
registerRoute(
  ({ url }) => url.pathname.startsWith("/content/") && url.pathname.endsWith(".json"),
  new StaleWhileRevalidate({ cacheName: CONTENT_CACHE }),
);

// Médias : la page y range aussi les unités « Disponible hors ligne » (src/offline/downloads.ts, quota et purge LRU
// gérés par la page) ; pas de purge globale sur erreur de quota, qui effacerait ces téléchargements explicites.
registerRoute(
  ({ url }) => AUDIO_PATH.test(url.pathname),
  new CacheFirst({
    cacheName: AUDIO_CACHE,
    plugins: plugins(
      new ExpirationPlugin({ maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 90 }),
      new RangeRequestsPlugin(),
    ),
  }),
);

registerRoute(
  ({ url }) => IMAGE_PATH.test(url.pathname),
  new CacheFirst({ cacheName: IMAGE_CACHE, plugins: plugins(new ExpirationPlugin({ maxEntries: 500 })) }),
);

// --- Push -------------------------------------------------------------------------

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

sw.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() as PushPayload | undefined) ?? {};
  } catch {
    payload = { body: event.data?.text() ?? "" };
  }
  event.waitUntil(
    sw.registration.showNotification(payload.title ?? "Parlo", {
      body: payload.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag ?? "parlo-daily",
      data: { url: payload.url ?? "/" },
    }),
  );
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const target = new URL(data?.url ?? "/", sw.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === sw.location.origin);
      if (existing) {
        await existing.focus();
        if (existing.url !== target) await existing.navigate?.(target);
        return;
      }
      await sw.clients.openWindow(target);
    })(),
  );
});
