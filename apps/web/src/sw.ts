import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { RangeRequestsPlugin } from "workbox-range-requests";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";

/**
 * Service worker (injectManifest, spec §8.1, §5.8).
 * Même comportement de cache qu'avant la Phase 2 (generateSW) :
 *   - app shell + bundle.json des packs en précache ;
 *   - JSON de contenu en stale-while-revalidate ;
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

// registerType "autoUpdate" : la nouvelle version prend la main tout de suite.
void sw.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
// Écrit tel quel : workbox-build cherche la chaîne « self.__WB_MANIFEST » pour injecter le précache.
precacheAndRoute(self.__WB_MANIFEST);
// Les navigations vers l'API (démarrage OAuth, redirections du serveur) ne sont jamais servies par l'app.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

registerRoute(
  ({ url }) => url.pathname.startsWith("/content/") && url.pathname.endsWith(".json"),
  new StaleWhileRevalidate({ cacheName: "content-v1" }),
);

registerRoute(
  ({ url }) => /^\/content\/.+\.(opus|m4a)$/.test(url.pathname),
  new CacheFirst({
    cacheName: "audio-v1",
    plugins: plugins(
      new ExpirationPlugin({ maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 90, purgeOnQuotaError: true }),
      new RangeRequestsPlugin(),
    ),
  }),
);

registerRoute(
  ({ url }) => /^\/content\/.+\.(webp|png|svg)$/.test(url.pathname),
  new CacheFirst({ cacheName: "images-v1", plugins: plugins(new ExpirationPlugin({ maxEntries: 500, purgeOnQuotaError: true })) }),
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
