import type { GameResult } from "@parlo/core";
import { ApiError, NetworkError } from "../api.ts";
import { getKv, setKv } from "../db.ts";
import { postExpressScore, type ExpressScoreInput, type ExpressScoreResult } from "./social-api.ts";

/**
 * Défi express (spec §5.2, contrat phase3 §3) : 60 s de Chợ nổi, score = justes × 10
 * + bonus de vitesse (déjà le calcul de `choNoiPoints` : 10 + jusqu'à 5 par juste).
 * En ligne, le score part aussitôt ; hors ligne il attend dans une file locale.
 */

export const EXPRESS_DURATION_MS = 60_000;
const QUEUE_KEY = "express.queue";
const BEST_KEY = "express.best";
const MAX_QUEUE = 20;

/** Score du contrat : justes × 10 + bonus de vitesse (∑ des bonus de 0 à 5). */
export function expressScore(result: GameResult): number {
  return Math.max(result.correct * 10, Math.round(result.points));
}

export function expressInput(result: GameResult, localDate: string): ExpressScoreInput {
  return { game: "cho_noi", score: expressScore(result), correct: result.correct, total: result.total, localDate };
}

export const getExpressLocalBest = () => getKv<number>(BEST_KEY, 0);

/** Garde le meilleur score local ; renvoie le nouveau meilleur. */
export async function saveExpressLocalBest(score: number): Promise<number> {
  const best = Math.max(await getExpressLocalBest(), score);
  await setKv(BEST_KEY, best);
  return best;
}

export const getExpressQueue = () => getKv<ExpressScoreInput[]>(QUEUE_KEY, []);

async function enqueue(input: ExpressScoreInput): Promise<void> {
  const queue = await getExpressQueue();
  await setKv(QUEUE_KEY, [...queue, input].slice(-MAX_QUEUE));
}

export type ExpressSubmit = { status: "posted"; result: ExpressScoreResult } | { status: "queued" } | { status: "guest" } | { status: "error" };

/** Envoie le score ; réseau absent → file locale. Compte absent → rien (score local seulement). */
export async function submitExpressScore(input: ExpressScoreInput, { signedIn, online }: { signedIn: boolean; online: boolean }): Promise<ExpressSubmit> {
  if (!signedIn) return { status: "guest" };
  if (!online) {
    await enqueue(input);
    return { status: "queued" };
  }
  try {
    return { status: "posted", result: await postExpressScore(input) };
  } catch (error) {
    if (error instanceof NetworkError || (error instanceof ApiError && (error.status >= 500 || error.status === 401))) {
      await enqueue(input);
      return { status: "queued" };
    }
    return { status: "error" };
  }
}

let flushing: Promise<number> | null = null;

/** Envoie la file dans l'ordre ; s'arrête au premier échec réseau. Renvoie le nombre envoyé. */
export function flushExpressQueue(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      let queue = await getExpressQueue();
      while (queue.length > 0) {
        const [head, ...rest] = queue as [ExpressScoreInput, ...ExpressScoreInput[]];
        try {
          await postExpressScore(head);
        } catch (error) {
          // Refus définitif (4xx hors 401) : on retire ce score ; sinon on réessaiera plus tard.
          if (!(error instanceof ApiError) || error.status === 401 || error.status >= 500) break;
        }
        sent++;
        queue = rest;
        await setKv(QUEUE_KEY, queue);
      }
    } finally {
      flushing = null;
    }
    return sent;
  })();
  return flushing;
}

/** File d'attente globale : vidée au retour du réseau (branchée au démarrage de l'app). */
export function startExpressQueue(isSignedIn: () => boolean): () => void {
  const run = () => {
    if (navigator.onLine && isSignedIn()) void flushExpressQueue().catch(() => undefined);
  };
  window.addEventListener("online", run);
  const first = window.setTimeout(run, 3_000);
  return () => {
    window.removeEventListener("online", run);
    window.clearTimeout(first);
  };
}
