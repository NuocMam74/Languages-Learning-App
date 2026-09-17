import { Component, type ReactNode } from "react";
import { useRouteError, type RouteObject } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { t } from "../i18n/index.ts";

/**
 * Chunk périmé après un déploiement (« Failed to fetch dynamically imported module », « Importing a module
 * script failed ») : un rechargement automatique, une seule fois par minute (garde en sessionStorage),
 * sinon un écran « Recharger » plutôt que l'erreur brute du routeur.
 */

const RELOAD_KEY = "parlo.chunkReloadAt";
const GUARD_MS = 60_000;

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(text);
}

/** Recharge la page si aucun rechargement de secours n'a eu lieu récemment. true = rechargement lancé. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Échec de préchargement signalé par Vite : rechargement de secours (une fois). */
export function installChunkRecovery(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnce()) event.preventDefault();
  });
}

function RecoveryScreen({ chunk }: { chunk: boolean }) {
  return (
    <Screen
      action={
        <div className="flex flex-col gap-2">
          <Button onClick={() => window.location.reload()}>{t("mobile.chunk.reload")}</Button>
          <Button variant="quiet" onClick={() => window.location.assign("/")}>{t("mobile.chunk.home")}</Button>
        </div>
      }
    >
      <div className="flex flex-1 flex-col justify-center gap-4" role="alert" data-testid="chunk-error" data-chunk={chunk || undefined}>
        <h1 className="font-serif text-2xl">{chunk ? t("mobile.chunk.title") : t("error.retry")}</h1>
        <p className="text-lg text-phu-sa">{t("mobile.chunk.body")}</p>
      </div>
    </Screen>
  );
}

/** Élément d'erreur des routes : chunk périmé → rechargement unique, sinon écran de secours. */
export function RouteError() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  if (chunk && reloadOnce()) return null;
  return <RecoveryScreen chunk={chunk} />;
}

/** Ajoute l'élément d'erreur de secours à chaque route qui n'en a pas. */
export function withRecovery(routes: RouteObject[]): RouteObject[] {
  return routes.map((route) => (route.errorElement || route.ErrorBoundary ? route : { ...route, errorElement: <RouteError /> }));
}

/** Frontière pour un widget chargé à la demande (carte du hub…) : en cas de chunk manquant, il disparaît. */
export class OptionalChunk extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
