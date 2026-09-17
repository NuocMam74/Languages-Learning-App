import { use, type ReactNode } from "react";
import { ensureMessages, messagesReady } from "../i18n/index.ts";

/**
 * Squelettes légers (audit mobile P1 #6) : affichés au lieu d'un écran vide pendant le démarrage,
 * le chargement d'un écran à la demande ou d'une unité de contenu. Aucune donnée, aucun texte.
 */

const bar = "rounded-full bg-phu-sa/10 motion-safe:animate-pulse";

export function ScreenSkeleton({ label = "Parlo" }: { label?: string }) {
  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-5 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] md:max-w-[720px]"
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="skeleton"
    >
      <div className={`h-8 w-2/5 ${bar}`} />
      <div className={`h-4 w-3/5 ${bar}`} />
      <div className={`mt-4 h-20 w-full rounded-2xl ${bar}`} />
      <div className={`h-3 w-full ${bar}`} />
      <div className={`h-3 w-4/5 ${bar}`} />
      <div className="mt-6 flex flex-col items-center gap-10">
        <div className={`size-20 ${bar}`} />
        <div className={`size-14 ${bar}`} />
        <div className={`size-14 ${bar}`} />
      </div>
    </div>
  );
}

/** Bloc d'exercice en cours de chargement (famille d'exercice chargée à la demande). */
export function ExerciseSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4" role="status" aria-busy="true" data-testid="exercise-skeleton">
      <div className={`h-5 w-1/2 ${bar}`} />
      <div className={`mx-auto my-6 size-24 ${bar}`} />
      <div className={`h-16 w-full rounded-2xl ${bar}`} />
      <div className={`h-16 w-full rounded-2xl ${bar}`} />
    </div>
  );
}

let allMessages: Promise<void> | null = null;

/** Suspend le rendu tant que toutes les chaînes d'interface ne sont pas chargées (jamais de clé brute). */
export function WithMessages({ children }: { children: ReactNode }) {
  if (!messagesReady("all")) {
    allMessages ??= ensureMessages("all").finally(() => {
      allMessages = null;
    });
    use(allMessages);
  }
  return children;
}
