import { contentMedia, type ContentIndex } from "@parlo/core";
import { mediaUrl } from "../content.ts";

/**
 * Lecture enchaînée des tours d'un dialogue (`listen_gist`, `dialogue_choice`).
 *
 * `audio.ts` ne sait jouer qu'un fichier et rend la main dès le démarrage : ici on attend la **fin**
 * de chaque tour pour lancer le suivant. Jamais de synthèse vocale (contrat phase6 §1 : on ne fait
 * pas écouter un dialogue en voix de synthèse) ; un fichier absent de l'index est sauté, la
 * transcription prend le relais.
 */

let current: HTMLAudioElement | null = null;
let token = 0;

function playOne(url: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    current = audio;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener("error", done, { once: true });
    audio.play().catch(done);
  });
}

/** Arrête la lecture en cours (démontage, nouvelle écoute). */
export function stopDialogue(): void {
  token++;
  current?.pause();
  current = null;
}

/**
 * Joue les tours dans l'ordre. `onTurn` reçoit l'index du tour joué (-1 à la fin).
 * Résout quand tout est joué, ou tout de suite si la lecture a été interrompue.
 */
export async function playDialogue(
  content: ContentIndex,
  turns: readonly { audio?: string | null }[],
  onTurn: (index: number) => void,
): Promise<void> {
  stopDialogue();
  const mine = token;
  const media = contentMedia(content);
  for (const [index, turn] of turns.entries()) {
    if (mine !== token) return;
    const path = turn.audio ?? null;
    if (!path || (media !== null && !media.has(path))) continue;
    onTurn(index);
    await playOne(mediaUrl(content, path));
  }
  if (mine === token) onTurn(-1);
}
